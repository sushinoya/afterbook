import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PYTHON = resolvePython();

test("selects a Kobo directory, displays books, and downloads a valid EPUB", async ({ page }) => {
  const fixture = buildFixture();
  test.setTimeout(120_000);
  await page.addInitScript(installFakeKoboDirectory, fixture);

  await page.goto("/");
  await expect(page.getByText(/All Kobo reading data stays local/)).toBeVisible();

  await page.getByRole("button", { name: "Connect Kobo" }).click();

  await expect(page.getByRole("cell", { name: "Browser Fixture - Test Author" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByAltText("Browser Fixture cover")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("1 book found.")).toBeVisible({ timeout: 60_000 });

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Create clipping book" }).click();
  const download = await downloadPromise;

  assert.equal(download.suggestedFilename(), fixture.export.filename);
  assertValidEpub(await download.path());

  const events = await page.evaluate(() => window.__afterbookEvents);
  assert.deepEqual(events.pickerOptions, { id: "afterbook-kobo", mode: "read" });
  assert.equal(events.workerMessages[0].type, "loadSnapshot");
  assert.deepEqual(events.workerMessages[0].paths, [
    ".kobo/KoboReader.sqlite",
    ".kobo/KoboReader.sqlite-wal",
    ".kobo/KoboReader.sqlite-shm",
  ]);
  assert.equal(events.workerMessages[1].type, "exportBook");
  assert.equal(events.workerMessages[1].bookId, "browser-fixture-book");
  assert.equal(events.workerMessages[1].coverPath, fixture.books[0].cover.priority_candidates[0]);
});

test("explains when the File System Access API is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: undefined,
    });
  });

  await page.goto("/");

  await expect(page.getByRole("status")).toHaveText(
    "Chrome or Edge on desktop is required to connect to a Kobo drive.",
  );
});

test("handles denied read permission", async ({ page }) => {
  await page.addInitScript(() => {
    window.showDirectoryPicker = async () => ({
      async queryPermission() {
        return "prompt";
      },
      async requestPermission(descriptor) {
        if (descriptor.mode !== "read") {
          throw new Error("Afterbook requested writable access");
        }
        return "denied";
      },
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Connect Kobo" }).click();

  await expect(page.getByRole("status")).toHaveText(
    "Afterbook can only continue after you grant read access to the Kobo drive.",
  );
});

test("handles a selected folder without the Kobo database", async ({ page }) => {
  await page.addInitScript(() => {
    window.showDirectoryPicker = async () => ({
      async queryPermission() {
        return "granted";
      },
      async getDirectoryHandle() {
        throw new DOMException("Missing directory", "NotFoundError");
      },
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Connect Kobo" }).click();

  await expect(page.getByRole("status")).toHaveText(
    "That folder does not contain .kobo/KoboReader.sqlite. Choose KOBOeReader.",
  );
});

function buildFixture() {
  return JSON.parse(
    execFileSync(PYTHON, ["tests/fixture_builder.py"], {
      cwd: WEB_ROOT,
      encoding: "utf8",
    }),
  );
}

function resolvePython() {
  const candidates = [
    process.env.AFTERBOOK_PYTHON,
    process.env.PYTHON,
    path.join(process.env.HOME || "", ".pyenv/shims/python3"),
    "python3",
    "python",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate.includes("/") && !existsSync(candidate)) {
      continue;
    }
    try {
      execFileSync(candidate, ["-c", "from typing import TypeAlias"], {
        cwd: WEB_ROOT,
        stdio: "ignore",
      });
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error("Afterbook browser tests require Python 3.10 or newer.");
}

function assertValidEpub(downloadPath) {
  const output = execFileSync(
    PYTHON,
    [
      "-c",
      `
import sys
import zipfile
path = sys.argv[1]
with zipfile.ZipFile(path) as epub:
    assert epub.read("mimetype") == b"application/epub+zip"
    names = set(epub.namelist())
    assert "OEBPS/archive/annotations.json" in names
    assert "OEBPS/cover.png" in names
    chapter = epub.read("OEBPS/chapter-1.xhtml").decode()
    assert "A browser-tested highlight." in chapter
    archive = epub.read("OEBPS/archive/annotations.json").decode()
    assert "A browser-tested note." in archive
print("valid")
`,
      downloadPath,
    ],
    { encoding: "utf8" },
  );
  assert.equal(output.trim(), "valid");
}

function installFakeKoboDirectory(fixture) {
  class FakeFileHandle {
    constructor(name, bytes) {
      this.kind = "file";
      this.name = name;
      this.bytes = bytes;
    }

    async getFile() {
      return new File([this.bytes], this.name);
    }
  }

  class FakeDirectoryHandle {
    constructor(name) {
      this.kind = "directory";
      this.name = name;
      this.children = new Map();
    }

    async queryPermission(descriptor) {
      if (descriptor.mode !== "read") {
        throw new Error("Afterbook requested writable access");
      }
      return "granted";
    }

    async requestPermission(descriptor) {
      if (descriptor.mode !== "read") {
        throw new Error("Afterbook requested writable access");
      }
      return "granted";
    }

    async getDirectoryHandle(name) {
      const child = this.children.get(name);
      if (!child || child.kind !== "directory") {
        throw new DOMException("Missing directory", "NotFoundError");
      }
      return child;
    }

    async getFileHandle(name) {
      const child = this.children.get(name);
      if (!child || child.kind !== "file") {
        throw new DOMException("Missing file", "NotFoundError");
      }
      return child;
    }

    async *entries() {
      for (const [name, child] of this.children) {
        yield [name, child];
      }
    }

    addFile(filePath, bytes) {
      const segments = filePath.split("/");
      let directory = this;
      for (const segment of segments.slice(0, -1)) {
        let child = directory.children.get(segment);
        if (!child) {
          child = new FakeDirectoryHandle(segment);
          directory.children.set(segment, child);
        }
        directory = child;
      }
      directory.children.set(segments.at(-1), new FakeFileHandle(segments.at(-1), bytes));
    }
  }

  const files = new Map(
    Object.entries(fixture.files).map(([filePath, encoded]) => [filePath, decodeBase64(encoded)]),
  );
  const root = new FakeDirectoryHandle("KOBOeReader");
  for (const [filePath, bytes] of files) {
    root.addFile(filePath, bytes);
  }

  window.__afterbookEvents = { pickerOptions: null, workerMessages: [] };
  window.showDirectoryPicker = async (options) => {
    window.__afterbookEvents.pickerOptions = options;
    return root;
  };
  const NativeWorker = window.Worker;
  window.Worker = class LoggedWorker {
    constructor(url, options) {
      this.worker = new NativeWorker(url, options);
    }

    addEventListener(...args) {
      return this.worker.addEventListener(...args);
    }

    removeEventListener(...args) {
      return this.worker.removeEventListener(...args);
    }

    postMessage(message, transfer) {
      const payload = message.payload || {};
      if (message.type === "loadSnapshot") {
        window.__afterbookEvents.workerMessages.push({
          type: message.type,
          paths: payload.files.map((file) => file.path),
        });
      }
      if (message.type === "exportBook") {
        window.__afterbookEvents.workerMessages.push({
          type: message.type,
          bookId: payload.bookId,
          coverPath: payload.coverFile?.path || null,
        });
      }
      return this.worker.postMessage(message, transfer);
    }

    terminate() {
      return this.worker.terminate();
    }
  };

  function decodeBase64(encoded) {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }
}
