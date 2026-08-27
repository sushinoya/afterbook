import assert from "node:assert/strict";
import test from "node:test";

import {
  createWorkerController,
  safeRelativePath,
  stageFiles,
  type PyodideFS,
} from "../src/pyodide-worker.js";
import type { KoboFile } from "../src/kobo-files.js";
import { createAfterbookClient } from "../src/worker-client.js";

test("stageFiles writes database sidecars into the Kobo root and clears stale files", () => {
  const FS = new FakeFS();
  FS.mkdirTree("/kobo");
  FS.mkdirTree("/kobo/old");
  FS.writeFile("/kobo/old/stale", bytes([9]));

  stageFiles(
    FS,
    [
      koboFile(".kobo/KoboReader.sqlite", [1]),
      koboFile(".kobo/KoboReader.sqlite-wal", [2]),
      koboFile(".kobo/KoboReader.sqlite-shm", [3]),
    ],
    "/kobo",
    { clear: true },
  );

  assert.deepEqual([...FS.readFile("/kobo/.kobo/KoboReader.sqlite")], [1]);
  assert.deepEqual([...FS.readFile("/kobo/.kobo/KoboReader.sqlite-wal")], [2]);
  assert.deepEqual([...FS.readFile("/kobo/.kobo/KoboReader.sqlite-shm")], [3]);
  assert.equal(FS.analyzePath("/kobo/old/stale").exists, false);
});

test("safeRelativePath rejects paths outside the staged Kobo root", () => {
  assert.equal(safeRelativePath(".kobo/KoboReader.sqlite"), ".kobo/KoboReader.sqlite");
  assert.throws(() => safeRelativePath("/tmp/KoboReader.sqlite"), /relative/);
  assert.throws(() => safeRelativePath("../KoboReader.sqlite"), /escapes/);
  assert.throws(() => safeRelativePath("C:\\KOBOeReader\\.kobo"), /relative/);
});

test("createWorkerController lists books and exports EPUB bytes through fake Pyodide", async () => {
  const pyodide = fakePyodide();
  const controller = createWorkerController({ pyodide });

  const listed = await controller.handle({
    type: "loadSnapshot",
    payload: { files: [koboFile(".kobo/KoboReader.sqlite", [1])] },
  });

  assert.deepEqual(listed.books, [{ source_id: "book-id", title: "Book" }]);
  assert.deepEqual([...pyodide.FS.readFile("/kobo/.kobo/KoboReader.sqlite")], [1]);

  const exported = await controller.handle({
    type: "exportBook",
    payload: {
      bookId: "book-id",
      coverFile: koboFile(".kobo-images/1/2/book - N3_FULL.parsed", [7, 8]),
    },
  });

  assert.equal(exported.filename, "Book - My Clippings.epub");
  assert.deepEqual([...exported.data], [80, 75, 3, 4]);
  assert.deepEqual([...pyodide.FS.readFile("/kobo/.kobo-images/1/2/book - N3_FULL.parsed")], [
    7,
    8,
  ]);
  assert.equal(pyodide.globals.get("_afterbook_book_id"), "book-id");
});

test("createWorkerController retries initialization after a load failure", async () => {
  const pyodide = fakePyodide();
  let attempts = 0;
  const controller = createWorkerController({
    async loadPyodideRuntime() {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("cdn unavailable");
      }
      return pyodide;
    },
    async loadAfterbookPackage() {},
  });

  await assert.rejects(
    () => controller.handle({ type: "loadSnapshot", payload: { files: [] } }),
    /cdn unavailable/,
  );
  const listed = await controller.handle({ type: "loadSnapshot", payload: { files: [] } });

  assert.equal(attempts, 2);
  assert.deepEqual(listed.books, [{ source_id: "book-id", title: "Book" }]);
});

test("createAfterbookClient resolves responses and transfers bytes", async () => {
  const worker = new FakeWorker();
  const client = createAfterbookClient({ worker });
  const file = koboFile(".kobo/KoboReader.sqlite", [1, 2]);
  const promise = client.loadSnapshot([file]);

  const message = worker.messages[0];
  const transfer = worker.transfers[0];
  assert.ok(message);
  assert.ok(transfer);
  assert.equal(message.type, "loadSnapshot");
  assert.equal(transfer.length, 1);
  worker.reply({ id: message.id, type: "success", payload: { books: [] } });

  assert.deepEqual(await promise, { books: [] });
});

test("createAfterbookClient rejects worker errors", async () => {
  const worker = new FakeWorker();
  const client = createAfterbookClient({ worker });
  const promise = client.exportBook("book-id", null);
  const message = worker.messages[0];
  assert.ok(message);

  worker.reply({
    id: message.id,
    type: "error",
    error: { name: "Error", message: "boom" },
  });

  await assert.rejects(promise, /boom/);
});

test("createAfterbookClient rejects pending requests when the worker crashes", async () => {
  const worker = new FakeWorker();
  const client = createAfterbookClient({ worker });
  const promise = client.loadSnapshot([koboFile(".kobo/KoboReader.sqlite", [1])]);

  worker.emit("error", { message: "worker exploded", filename: "worker.js", lineno: 10 });

  await assert.rejects(promise, /worker exploded/);
  await assert.rejects(() => client.exportBook("book-id", null), /not available/);
});

test("createAfterbookClient rejects synchronous postMessage failures", async () => {
  const worker = new FakeWorker();
  worker.postMessageError = new Error("detached buffer");
  const client = createAfterbookClient({ worker });

  await assert.rejects(
    () => client.loadSnapshot([koboFile(".kobo/KoboReader.sqlite", [1])]),
    /detached buffer/,
  );
});

function bytes(values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function koboFile(path: string, values: number[]): KoboFile {
  return {
    path,
    name: path.split("/").pop() || path,
    bytes: bytes(values),
  };
}

function fakePyodide() {
  const FS = new FakeFS();
  const globals = new Map<string, unknown>();
  return {
    FS,
    globals: {
      set(key: string, value: unknown) {
        globals.set(key, value);
      },
      get(key: string) {
        return globals.get(key);
      },
    },
    runPython(code: string) {
      if (code.includes("list_kobo_books")) {
        return JSON.stringify([{ source_id: "book-id", title: "Book" }]);
      }
      if (code.includes("generate_kobo_epub")) {
        globals.set("_afterbook_export_filename", "Book - My Clippings.epub");
        globals.set("_afterbook_export_data", bytes([80, 75, 3, 4]));
        return null;
      }
      return null;
    },
    unpackArchive() {},
  };
}

interface FakeWorkerMessage {
  id: number;
  type: string;
  payload: unknown;
}

class FakeWorker {
  messageListeners: Set<(event: MessageEvent) => void>;
  errorListeners: Set<(event: ErrorEvent) => void>;
  messageErrorListeners: Set<() => void>;
  messages: FakeWorkerMessage[];
  transfers: Transferable[][];
  postMessageError: Error | null;

  constructor() {
    this.messageListeners = new Set();
    this.errorListeners = new Set();
    this.messageErrorListeners = new Set();
    this.messages = [];
    this.transfers = [];
    this.postMessageError = null;
  }

  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  addEventListener(type: "messageerror", listener: () => void): void;
  addEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: MessageEvent) => void) | ((event: ErrorEvent) => void) | (() => void),
  ): void {
    if (type === "message") {
      this.messageListeners.add(listener as (event: MessageEvent) => void);
      return;
    }
    if (type === "error") {
      this.errorListeners.add(listener as (event: ErrorEvent) => void);
      return;
    }
    this.messageErrorListeners.add(listener as () => void);
  }

  postMessage(message: FakeWorkerMessage, transfer: Transferable[] = []) {
    if (this.postMessageError) {
      throw this.postMessageError;
    }
    this.messages.push(message);
    this.transfers.push(transfer);
  }

  reply(data: unknown) {
    for (const listener of this.messageListeners) {
      listener({ data } as MessageEvent);
    }
  }

  emit(type: "error", event: { message?: string; filename?: string; lineno?: number }): void;
  emit(type: "messageerror", event?: undefined): void;
  emit(type: "error" | "messageerror", event?: { message?: string; filename?: string; lineno?: number }) {
    if (type === "messageerror") {
      for (const listener of this.messageErrorListeners) {
        listener();
      }
      return;
    }
    for (const listener of this.errorListeners) {
      listener(event as ErrorEvent);
    }
  }

  terminate() {}
}

type FakeFSEntry = { type: "dir" } | { type: "file"; data: Uint8Array };

class FakeFS implements PyodideFS {
  entries: Map<string, FakeFSEntry>;

  constructor() {
    this.entries = new Map([["/", { type: "dir" }]]);
  }

  analyzePath(path: string): { exists: boolean } {
    return { exists: this.entries.has(path) };
  }

  mkdirTree(path: string): void {
    const segments = path.split("/").filter(Boolean);
    let current = "";
    for (const segment of segments) {
      current += `/${segment}`;
      this.mkdir(current);
    }
  }

  mkdir(path: string): void {
    if (!this.entries.has(path)) {
      this.entries.set(path, { type: "dir" });
    }
  }

  writeFile(path: string, bytesValue: Uint8Array): void {
    this.mkdirTree(parentPath(path));
    this.entries.set(path, { type: "file", data: new Uint8Array(bytesValue) });
  }

  readFile(path: string): Uint8Array {
    const entry = this.entries.get(path);
    if (!entry || entry.type !== "file") {
      throw new Error(`missing file ${path}`);
    }
    return entry.data;
  }

  stat(path: string): { mode: number } {
    const entry = this.entries.get(path);
    if (!entry) {
      throw new Error(`missing entry ${path}`);
    }
    return { mode: entry.type === "dir" ? 0o040000 : 0o100000 };
  }

  isDir(mode: number): boolean {
    return (mode & 0o040000) === 0o040000;
  }

  readdir(path: string): string[] {
    const prefix = path === "/" ? "/" : `${path}/`;
    const names = new Set([".", ".."]);
    for (const entryPath of this.entries.keys()) {
      if (!entryPath.startsWith(prefix) || entryPath === path) {
        continue;
      }
      const remainder = entryPath.slice(prefix.length);
      if (remainder && !remainder.includes("/")) {
        names.add(remainder);
      }
    }
    return [...names];
  }

  unlink(path: string): void {
    this.entries.delete(path);
  }

  rmdir(path: string): void {
    this.entries.delete(path);
  }
}

function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index > 0 ? path.slice(0, index) : "/";
}
