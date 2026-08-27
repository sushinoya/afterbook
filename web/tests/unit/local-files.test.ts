import { describe, expect, it } from "vitest";

import {
  type BrowserDirectoryEntry,
  type BrowserDirectoryHandle,
  type BrowserFileHandle,
  pickReadableDirectory,
  readOptionalFile,
  readRequiredFile,
  safeRelativePathSegments,
} from "../../src/infrastructure/file-system/local-files.js";

describe("local file access", () => {
  it("picks a read-only directory", async () => {
    let pickerOptions: unknown;
    const directory = fakeDirectory({ ".kobo": fakeDirectory({ "KoboReader.sqlite": bytes([1]) }) });

    const selected = await pickReadableDirectory({
      async showDirectoryPicker(options) {
        pickerOptions = options;
        return directory;
      },
    });

    expect(selected).toBe(directory);
    expect(pickerOptions).toEqual({ id: "afterbook-reader-source", mode: "read" });
  });

  it("reads required and optional files", async () => {
    const directory = fakeDirectory({
      ".kobo": fakeDirectory({
        "KoboReader.sqlite": bytes([1, 2, 3]),
      }),
    });

    await expect(readRequiredFile(directory, ".kobo/KoboReader.sqlite")).resolves.toMatchObject({
      path: ".kobo/KoboReader.sqlite",
      name: "KoboReader.sqlite",
    });
    await expect(readOptionalFile(directory, ".kobo/missing.sqlite")).resolves.toBeNull();
  });

  it("rejects escaped paths", () => {
    expect(() => safeRelativePathSegments("../KoboReader.sqlite")).toThrow(/inside/);
    expect(() => safeRelativePathSegments("/.kobo/KoboReader.sqlite")).toThrow(/relative/);
    expect(() => safeRelativePathSegments("C:\\KOBOeReader\\.kobo")).toThrow(/relative/);
  });
});

type FakeEntry = FakeDirectoryHandle | FakeFileHandle;
type FakeDirectoryEntries = Record<string, Uint8Array | FakeEntry>;

class FakeDirectoryHandle implements BrowserDirectoryHandle {
  readonly kind = "directory";
  readonly name: string;
  private readonly children: Record<string, FakeEntry>;

  constructor(entries: FakeDirectoryEntries, name = "") {
    this.name = name;
    this.children = normalizeEntries(entries);
  }

  async queryPermission() {
    return "granted" as PermissionState;
  }

  async requestPermission() {
    return "granted" as PermissionState;
  }

  async getDirectoryHandle(name: string) {
    const child = this.children[name];
    if (!child || child.kind !== "directory") {
      throw notFound();
    }
    return child;
  }

  async getFileHandle(name: string) {
    const child = this.children[name];
    if (!child || child.kind !== "file") {
      throw notFound();
    }
    return child;
  }

  async *entries(): AsyncIterable<[string, BrowserDirectoryEntry]> {
    for (const [name, child] of Object.entries(this.children)) {
      yield [name, child];
    }
  }
}

class FakeFileHandle implements BrowserFileHandle {
  readonly kind = "file";

  constructor(
    readonly name: string,
    private readonly data: Uint8Array,
  ) {}

  async getFile() {
    return new File([arrayBufferFor(this.data)], this.name);
  }
}

function fakeDirectory(entries: FakeDirectoryEntries, name?: string) {
  return new FakeDirectoryHandle(entries, name);
}

function normalizeEntries(entries: FakeDirectoryEntries): Record<string, FakeEntry> {
  return Object.fromEntries(
    Object.entries(entries).map(([name, entry]) => [
      name,
      entry instanceof FakeDirectoryHandle || entry instanceof FakeFileHandle
        ? entry
        : new FakeFileHandle(name, entry),
    ]),
  );
}

function bytes(values: number[]) {
  return new Uint8Array(values);
}

function arrayBufferFor(bytesValue: Uint8Array) {
  const copy = new Uint8Array(bytesValue.byteLength);
  copy.set(bytesValue);
  return copy.buffer;
}

function notFound() {
  return Object.assign(new Error("not found"), { name: "NotFoundError" });
}
