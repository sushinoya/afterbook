import assert from "node:assert/strict";
import test from "node:test";

import {
  findCachedCover,
  readKoboSnapshot,
  safeRelativePathSegments,
  selectKoboDirectory,
  validateKoboDirectory,
  type DirectoryPickerScope,
  type KoboDirectoryHandle,
  type KoboFileHandle,
} from "../src/kobo-files.js";

test("selectKoboDirectory requests read-only access", async () => {
  let options: { id: string; mode: "read" } | undefined;
  const directory = fakeDirectory({ ".kobo": fakeDirectory({ "KoboReader.sqlite": bytes([1]) }) });
  const scope: DirectoryPickerScope = {
    async showDirectoryPicker(requestedOptions) {
      options = requestedOptions;
      return directory;
    },
  };

  assert.equal(await selectKoboDirectory(scope), directory);
  assert.deepEqual(options, { id: "afterbook-kobo", mode: "read" });
});

test("validateKoboDirectory requires the Kobo database", async () => {
  await assert.rejects(
    () => validateKoboDirectory(fakeDirectory({ ".kobo": fakeDirectory({}) })),
    { name: "NotFoundError" },
  );
});

test("validateKoboDirectory fails when read access cannot be requested", async () => {
  const directory = fakeDirectory(
    { ".kobo": fakeDirectory({ "KoboReader.sqlite": bytes([1]) }) },
    { permission: "prompt", requestPermission: null },
  );

  await assert.rejects(() => validateKoboDirectory(directory), {
    name: "KoboDirectoryError",
    code: "permission-denied",
  });
});

test("readKoboSnapshot copies database and existing sidecars", async () => {
  const directory = fakeDirectory({
    ".kobo": fakeDirectory({
      "KoboReader.sqlite": bytes([1, 2, 3]),
      "KoboReader.sqlite-wal": bytes([4, 5]),
      "KoboReader.sqlite-shm": bytes([6]),
      "unrelated.sqlite": bytes([99]),
    }),
  });

  const snapshot = await readKoboSnapshot(directory);

  assert.deepEqual(
    snapshot.map((file) => file.path),
    [".kobo/KoboReader.sqlite", ".kobo/KoboReader.sqlite-wal", ".kobo/KoboReader.sqlite-shm"],
  );
  assert.deepEqual([...snapshot[0]!.bytes], [1, 2, 3]);
  assert.deepEqual([...snapshot[1]!.bytes], [4, 5]);
  assert.deepEqual([...snapshot[2]!.bytes], [6]);
  assert.equal(directory.writeRequested, false);
});

test("findCachedCover prefers priority candidates", async () => {
  const locator = {
    directory: ".kobo-images/1/2",
    priority_candidates: [
      ".kobo-images/1/2/book - N3_FULL.parsed",
      ".kobo-images/1/2/book - N3_LIBRARY_GRID.parsed",
    ],
    fallback_prefix: "book - ",
    parsed_suffix: ".parsed",
  };
  const directory = fakeDirectory({
    ".kobo-images": fakeDirectory({
      1: fakeDirectory({
        2: fakeDirectory({
          "book - N3_LIBRARY_GRID.parsed": bytes([7, 8]),
          "book - UNKNOWN.parsed": bytes([1, 2, 3, 4]),
        }),
      }),
    }),
  });

  const cover = await findCachedCover(directory, locator);

  assert.ok(cover);
  assert.equal(cover.path, ".kobo-images/1/2/book - N3_LIBRARY_GRID.parsed");
  assert.deepEqual([...cover.bytes], [7, 8]);
});

test("findCachedCover falls back to the largest parsed variant", async () => {
  const locator = {
    directory: ".kobo-images/1/2",
    priority_candidates: [".kobo-images/1/2/book - N3_FULL.parsed"],
    fallback_prefix: "book - ",
    parsed_suffix: ".parsed",
  };
  const directory = fakeDirectory({
    ".kobo-images": fakeDirectory({
      1: fakeDirectory({
        2: fakeDirectory({
          "book - SMALL.parsed": bytes([1]),
          "book - LARGE.parsed": bytes([1, 2, 3]),
          "other - LARGE.parsed": bytes([1, 2, 3, 4]),
        }),
      }),
    }),
  });

  const cover = await findCachedCover(directory, locator);

  assert.ok(cover);
  assert.equal(cover.path, ".kobo-images/1/2/book - LARGE.parsed");
  assert.deepEqual([...cover.bytes], [1, 2, 3]);
});

test("findCachedCover ignores unsafe fallback entry names", async () => {
  const locator = {
    directory: ".kobo-images/1/2",
    priority_candidates: [],
    fallback_prefix: "book - ",
    parsed_suffix: ".parsed",
  };
  const directory = fakeDirectory({
    ".kobo-images": fakeDirectory({
      1: fakeDirectory({
        2: fakeDirectory({
          "book - SAFE.parsed": bytes([1]),
          "book - BAD/name.parsed": bytes([1, 2, 3]),
        }),
      }),
    }),
  });

  const cover = await findCachedCover(directory, locator);

  assert.ok(cover);
  assert.equal(cover.path, ".kobo-images/1/2/book - SAFE.parsed");
});

test("safeRelativePathSegments rejects escaped paths", () => {
  assert.throws(() => safeRelativePathSegments("../KoboReader.sqlite"), /escapes/);
  assert.throws(() => safeRelativePathSegments("/.kobo/KoboReader.sqlite"), /relative/);
  assert.throws(() => safeRelativePathSegments("C:\\KOBOeReader\\.kobo"), /relative/);
});

function bytes(values: number[]): Uint8Array {
  return new Uint8Array(values);
}

type FakeEntry = FakeDirectoryHandle | FakeFileHandle;
type FakeEntryInput = Uint8Array | FakeEntry;
type FakeDirectoryEntries = Record<string, FakeEntryInput>;

interface FakeDirectoryOptions {
  name?: string;
  permission?: PermissionState;
  requestPermission?: null;
}

class FakeDirectoryHandle implements KoboDirectoryHandle {
  readonly kind = "directory";
  readonly name: string;
  readonly writeRequested = false;
  readonly normalizedEntries: Record<string, FakeEntry>;
  requestPermission?: KoboDirectoryHandle["requestPermission"];

  constructor(entries: FakeDirectoryEntries, private readonly options: FakeDirectoryOptions = {}) {
    this.name = options.name || "";
    this.normalizedEntries = normalizeEntries(entries);
    if (options.requestPermission !== null) {
      this.requestPermission = async (descriptor) => {
        assert.deepEqual(descriptor, { mode: "read" });
        return options.permission || "granted";
      };
    }
  }

  async queryPermission(descriptor: { mode: "read" }): Promise<PermissionState> {
    assert.deepEqual(descriptor, { mode: "read" });
    return this.options.permission || "granted";
  }

  async getDirectoryHandle(name: string, requestOptions?: unknown): Promise<KoboDirectoryHandle> {
    assert.equal(requestOptions, undefined);
    const child = this.normalizedEntries[name];
    if (!child || child.kind !== "directory") {
      throw notFound();
    }
    return child;
  }

  async getFileHandle(name: string, requestOptions?: unknown): Promise<KoboFileHandle> {
    assert.equal(requestOptions, undefined);
    const child = this.normalizedEntries[name];
    if (!child || child.kind !== "file") {
      throw notFound();
    }
    return child;
  }

  async *entries(): AsyncIterable<[string, FakeEntry]> {
    for (const [name, child] of Object.entries(this.normalizedEntries)) {
      yield [name, child];
    }
  }
}

class FakeFileHandle implements KoboFileHandle {
  readonly kind = "file";

  constructor(
    readonly name: string,
    private readonly data: Uint8Array,
  ) {}

  async getFile(): Promise<File> {
    return new File([arrayBufferFor(this.data)], this.name);
  }
}

function fakeDirectory(
  entries: FakeDirectoryEntries,
  options: FakeDirectoryOptions = {},
): FakeDirectoryHandle {
  return new FakeDirectoryHandle(entries, options);
}

function fakeFile(name: string, data: Uint8Array): FakeFileHandle {
  return new FakeFileHandle(name, data);
}

function normalizeEntries(entries: FakeDirectoryEntries): Record<string, FakeEntry> {
  return Object.fromEntries(
    Object.entries(entries).map(([name, value]) => [
      name,
      isFakeEntry(value) ? value : fakeFile(name, value),
    ]),
  );
}

function isFakeEntry(value: FakeEntryInput): value is FakeEntry {
  return value instanceof FakeDirectoryHandle || value instanceof FakeFileHandle;
}

function notFound(): Error {
  return Object.assign(new Error("not found"), { name: "NotFoundError" });
}

function arrayBufferFor(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
