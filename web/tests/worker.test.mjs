import assert from "node:assert/strict";
import test from "node:test";

import { createWorkerController, safeRelativePath, stageFiles } from "../pyodide-worker.js";
import { createAfterbookClient } from "../worker-client.js";

test("stageFiles writes database sidecars into the Kobo root and clears stale files", () => {
  const FS = new FakeFS();
  FS.mkdirTree("/kobo");
  FS.mkdirTree("/kobo/old");
  FS.writeFile("/kobo/old/stale", bytes([9]));

  stageFiles(
    FS,
    [
      { path: ".kobo/KoboReader.sqlite", bytes: bytes([1]) },
      { path: ".kobo/KoboReader.sqlite-wal", bytes: bytes([2]) },
      { path: ".kobo/KoboReader.sqlite-shm", bytes: bytes([3]) },
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
    payload: { files: [{ path: ".kobo/KoboReader.sqlite", bytes: bytes([1]) }] },
  });

  assert.deepEqual(listed.books, [{ source_id: "book-id", title: "Book" }]);
  assert.deepEqual([...pyodide.FS.readFile("/kobo/.kobo/KoboReader.sqlite")], [1]);

  const exported = await controller.handle({
    type: "exportBook",
    payload: {
      bookId: "book-id",
      coverFile: { path: ".kobo-images/1/2/book - N3_FULL.parsed", bytes: bytes([7, 8]) },
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
  const file = { path: ".kobo/KoboReader.sqlite", bytes: bytes([1, 2]) };
  const promise = client.loadSnapshot([file]);

  assert.equal(worker.messages[0].type, "loadSnapshot");
  assert.equal(worker.transfers[0].length, 1);
  worker.reply({ id: worker.messages[0].id, type: "success", payload: { books: [] } });

  assert.deepEqual(await promise, { books: [] });
});

test("createAfterbookClient rejects worker errors", async () => {
  const worker = new FakeWorker();
  const client = createAfterbookClient({ worker });
  const promise = client.exportBook("book-id", null);

  worker.reply({
    id: worker.messages[0].id,
    type: "error",
    error: { name: "Error", message: "boom" },
  });

  await assert.rejects(promise, /boom/);
});

test("createAfterbookClient rejects pending requests when the worker crashes", async () => {
  const worker = new FakeWorker();
  const client = createAfterbookClient({ worker });
  const promise = client.loadSnapshot([{ path: ".kobo/KoboReader.sqlite", bytes: bytes([1]) }]);

  worker.emit("error", { message: "worker exploded", filename: "worker.js", lineno: 10 });

  await assert.rejects(promise, /worker exploded/);
  await assert.rejects(() => client.exportBook("book-id", null), /not available/);
});

test("createAfterbookClient rejects synchronous postMessage failures", async () => {
  const worker = new FakeWorker();
  worker.postMessageError = new Error("detached buffer");
  const client = createAfterbookClient({ worker });

  await assert.rejects(
    () => client.loadSnapshot([{ path: ".kobo/KoboReader.sqlite", bytes: bytes([1]) }]),
    /detached buffer/,
  );
});

function bytes(values) {
  return new Uint8Array(values);
}

function fakePyodide() {
  const FS = new FakeFS();
  const globals = new Map();
  return {
    FS,
    globals: {
      set(key, value) {
        globals.set(key, value);
      },
      get(key) {
        return globals.get(key);
      },
    },
    runPython(code) {
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
  };
}

class FakeWorker {
  constructor() {
    this.listeners = new Map();
    this.messages = [];
    this.transfers = [];
    this.postMessageError = null;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type).add(listener);
  }

  postMessage(message, transfer) {
    if (this.postMessageError) {
      throw this.postMessageError;
    }
    this.messages.push(message);
    this.transfers.push(transfer);
  }

  reply(data) {
    this.emit("message", { data });
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) || []) {
      listener(event);
    }
  }

  terminate() {}
}

class FakeFS {
  constructor() {
    this.entries = new Map([["/", { type: "dir" }]]);
  }

  analyzePath(path) {
    return { exists: this.entries.has(path) };
  }

  mkdirTree(path) {
    const segments = path.split("/").filter(Boolean);
    let current = "";
    for (const segment of segments) {
      current += `/${segment}`;
      this.mkdir(current);
    }
  }

  mkdir(path) {
    if (!this.entries.has(path)) {
      this.entries.set(path, { type: "dir" });
    }
  }

  writeFile(path, bytesValue) {
    this.mkdirTree(parentPath(path));
    this.entries.set(path, { type: "file", data: new Uint8Array(bytesValue) });
  }

  readFile(path) {
    const entry = this.entries.get(path);
    if (!entry || entry.type !== "file") {
      throw new Error(`missing file ${path}`);
    }
    return entry.data;
  }

  stat(path) {
    const entry = this.entries.get(path);
    if (!entry) {
      throw new Error(`missing entry ${path}`);
    }
    return { mode: entry.type === "dir" ? 0o040000 : 0o100000 };
  }

  isDir(mode) {
    return (mode & 0o040000) === 0o040000;
  }

  readdir(path) {
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

  unlink(path) {
    this.entries.delete(path);
  }

  rmdir(path) {
    this.entries.delete(path);
  }
}

function parentPath(path) {
  const index = path.lastIndexOf("/");
  return index > 0 ? path.slice(0, index) : "/";
}
