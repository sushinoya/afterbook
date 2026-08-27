import { describe, expect, it } from "vitest";

import {
  createPyodideWorkerController,
  safeRelativePath,
  stageFiles,
} from "../../src/infrastructure/worker/pyodide.worker.js";
import { WORKER_REQUESTS } from "../../src/infrastructure/worker/protocol.js";
import { KOBO_READER_ID } from "../../src/infrastructure/readers/kobo/types.js";

describe("Pyodide worker controller", () => {
  it("stages reader files under the worker root", () => {
    const FS = new FakeFS();
    FS.mkdirTree("/reader-source");
    FS.writeFile("/reader-source/stale", bytes([9]));

    stageFiles(
      FS,
      [
        { path: ".kobo/KoboReader.sqlite", name: "KoboReader.sqlite", bytes: bytes([1]) },
        { path: ".kobo/KoboReader.sqlite-wal", name: "KoboReader.sqlite-wal", bytes: bytes([2]) },
      ],
      { clear: true },
    );

    expect([...FS.readFile("/reader-source/.kobo/KoboReader.sqlite")]).toEqual([1]);
    expect([...FS.readFile("/reader-source/.kobo/KoboReader.sqlite-wal")]).toEqual([2]);
    expect(FS.analyzePath("/reader-source/stale").exists).toBe(false);
  });

  it("rejects paths outside the staged reader root", () => {
    expect(safeRelativePath(".kobo/KoboReader.sqlite")).toBe(".kobo/KoboReader.sqlite");
    expect(() => safeRelativePath("/tmp/KoboReader.sqlite")).toThrow(/relative/);
    expect(() => safeRelativePath("../KoboReader.sqlite")).toThrow(/inside/);
  });

  it("catalogs books and generates EPUB bytes with fake Pyodide", async () => {
    const pyodide = fakePyodide();
    const controller = createPyodideWorkerController({ pyodide });

    const listed = await controller.handle({
      id: 1,
      type: WORKER_REQUESTS.catalogAnnotations,
      payload: {
        readerId: KOBO_READER_ID,
        files: [{ path: ".kobo/KoboReader.sqlite", name: "KoboReader.sqlite", bytes: bytes([1]) }],
      },
    });

    expect(listed).toEqual({ books: [{ source_id: "book-id", title: "Book" }] });

    const annotations = await controller.handle({
      id: 2,
      type: WORKER_REQUESTS.listBookAnnotations,
      payload: {
        readerId: KOBO_READER_ID,
        bookId: "book-id",
      },
    });

    expect(annotations).toEqual({
      annotations: [{ source_id: "annotation-id", text: "Highlighted text" }],
    });
    expect(pyodide.globals.get("_afterbook_book_id")).toBe("book-id");

    const exported = await controller.handle({
      id: 3,
      type: WORKER_REQUESTS.generateAnnotationEpub,
      payload: {
        readerId: KOBO_READER_ID,
        bookId: "book-id",
        coverFile: null,
      },
    });

    expect(exported).toMatchObject({
      filename: "Book - My Clippings.epub",
      data: new Uint8Array([80, 75, 3, 4]),
    });
    expect(pyodide.globals.get("_afterbook_book_id")).toBe("book-id");
  });
});

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
      if (code.includes("list_kobo_book_annotations")) {
        return JSON.stringify([{ source_id: "annotation-id", text: "Highlighted text" }]);
      }
      if (code.includes("generate_kobo_epub")) {
        globals.set("_afterbook_export_filename", "Book - My Clippings.epub");
        globals.set("_afterbook_export_data", bytes([80, 75, 3, 4]));
      }
      return null;
    },
    unpackArchive() {},
  };
}

type FakeFSEntry = { type: "dir" } | { type: "file"; data: Uint8Array };

class FakeFS {
  private readonly entries = new Map<string, FakeFSEntry>([["/", { type: "dir" }]]);

  analyzePath(path: string) {
    return { exists: this.entries.has(path) };
  }

  mkdirTree(path: string) {
    const segments = path.split("/").filter(Boolean);
    let current = "";
    for (const segment of segments) {
      current += `/${segment}`;
      this.mkdir(current);
    }
  }

  mkdir(path: string) {
    if (!this.entries.has(path)) {
      this.entries.set(path, { type: "dir" });
    }
  }

  writeFile(path: string, bytesValue: Uint8Array) {
    this.mkdirTree(parentPath(path));
    this.entries.set(path, { type: "file", data: new Uint8Array(bytesValue) });
  }

  readFile(path: string) {
    const entry = this.entries.get(path);
    if (!entry || entry.type !== "file") {
      throw new Error(`missing file ${path}`);
    }
    return entry.data;
  }

  stat(path: string) {
    const entry = this.entries.get(path);
    if (!entry) {
      throw new Error(`missing entry ${path}`);
    }
    return { mode: entry.type === "dir" ? 0o040000 : 0o100000 };
  }

  isDir(mode: number) {
    return (mode & 0o040000) === 0o040000;
  }

  readdir(path: string) {
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

  unlink(path: string) {
    this.entries.delete(path);
  }

  rmdir(path: string) {
    this.entries.delete(path);
  }
}

function bytes(values: number[]) {
  return new Uint8Array(values);
}

function parentPath(path: string) {
  const index = path.lastIndexOf("/");
  return index > 0 ? path.slice(0, index) : "/";
}
