import assert from "node:assert/strict";
import test from "node:test";

import {
  findCachedCover,
  readKoboSnapshot,
  safeRelativePathSegments,
  selectKoboDirectory,
  validateKoboDirectory,
} from "../kobo-files.js";

test("selectKoboDirectory requests read-only access", async () => {
  let options;
  const directory = fakeDirectory({ ".kobo": fakeDirectory({ "KoboReader.sqlite": bytes([1]) }) });
  const scope = {
    showDirectoryPicker(requestedOptions) {
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
  assert.deepEqual([...snapshot[0].bytes], [1, 2, 3]);
  assert.deepEqual([...snapshot[1].bytes], [4, 5]);
  assert.deepEqual([...snapshot[2].bytes], [6]);
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

  assert.equal(cover.path, ".kobo-images/1/2/book - SAFE.parsed");
});

test("safeRelativePathSegments rejects escaped paths", () => {
  assert.throws(() => safeRelativePathSegments("../KoboReader.sqlite"), /escapes/);
  assert.throws(() => safeRelativePathSegments("/.kobo/KoboReader.sqlite"), /relative/);
  assert.throws(() => safeRelativePathSegments("C:\\KOBOeReader\\.kobo"), /relative/);
});

function bytes(values) {
  return new Uint8Array(values);
}

function fakeDirectory(entries, options = {}) {
  const normalizedEntries = normalizeEntries(entries);
  const handle = {
    kind: "directory",
    name: options.name || "",
    writeRequested: false,
    async queryPermission(descriptor) {
      assert.deepEqual(descriptor, { mode: "read" });
      return options.permission || "granted";
    },
    requestPermission:
      options.requestPermission === null
        ? undefined
        : async (descriptor) => {
            assert.deepEqual(descriptor, { mode: "read" });
            return options.permission || "granted";
          },
    async getDirectoryHandle(name, requestOptions) {
      assert.equal(requestOptions, undefined);
      const child = normalizedEntries[name];
      if (!child || child.kind !== "directory") {
        throw notFound();
      }
      return child;
    },
    async getFileHandle(name, requestOptions) {
      assert.equal(requestOptions, undefined);
      const child = normalizedEntries[name];
      if (!child || child.kind !== "file") {
        throw notFound();
      }
      return child;
    },
    async *entries() {
      for (const [name, child] of Object.entries(normalizedEntries)) {
        yield [name, child];
      }
    },
  };
  return handle;
}

function fakeFile(name, data) {
  return {
    kind: "file",
    name,
    async getFile() {
      return new File([data], name);
    },
  };
}

function normalizeEntries(entries) {
  return Object.fromEntries(
    Object.entries(entries).map(([name, value]) => [
      name,
      value?.kind ? value : fakeFile(name, value),
    ]),
  );
}

function notFound() {
  return Object.assign(new Error("not found"), { name: "NotFoundError" });
}
