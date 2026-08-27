import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { DIRECTORY_PICKER_OPTIONS } from "../../src/infrastructure/file-system/local-files.js";
import { WORKER_REQUESTS } from "../../src/infrastructure/worker/protocol.js";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PYTHON = resolvePython();

interface BrowserFixtureBook {
  cover: {
    priority_candidates: string[];
  };
}

interface BrowserFixture {
  files: Record<string, string>;
  books: BrowserFixtureBook[];
  export: {
    filename: string;
  };
}

type PickerOptions = { id: string; mode: "read" };
type ReadPermissionDescriptor = { mode: "read" };

type LoggedWorkerMessage =
  | { type: typeof WORKER_REQUESTS.catalogAnnotations; paths: string[] }
  | {
      type: typeof WORKER_REQUESTS.generateAnnotationEpub;
      bookId: string;
      coverPath: string | null;
    };

interface AfterbookEvents {
  pickerOptions: PickerOptions | null;
  workerMessages: LoggedWorkerMessage[];
}

interface WorkerRequestLogPayload {
  files?: Array<{ path: string }>;
  bookId?: string;
  coverFile?: { path?: string } | null;
}

interface WorkerRequestLogMessage {
  type?: string;
  payload?: WorkerRequestLogPayload;
}

interface BrowserHarness {
  fixture: BrowserFixture;
  workerRequests: typeof WORKER_REQUESTS;
}

declare global {
  interface Window {
    __afterbookEvents: AfterbookEvents;
    showDirectoryPicker?: (options: PickerOptions) => Promise<unknown>;
  }
}

test("selects a Kobo directory, displays books, and downloads a valid EPUB", async ({ page }) => {
  const fixture = buildFixture();
  const firstBook = fixture.books[0];
  const firstCoverPath = firstBook?.cover.priority_candidates[0];
  assert.ok(firstCoverPath);
  test.setTimeout(120_000);
  await page.addInitScript(installFakeKoboDirectory, {
    fixture,
    workerRequests: WORKER_REQUESTS,
  } satisfies BrowserHarness);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "AfterBook." })).toBeVisible();
  await page.getByRole("button", { name: "Get started" }).click();
  await expect(page.getByRole("heading", { name: "Connect your e-reader" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Annotated books" })).toBeHidden();

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Choose your e-reader" })).toBeVisible();
  await page.getByRole("button", { name: "Connect Reader" }).click();

  const fixtureBook = page.getByRole("button", { name: "Open Browser Fixture" });
  await expect(fixtureBook).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole("heading", { name: "Annotated books" })).toBeVisible();
  await expect(page.locator('[aria-label="Browser Fixture cover"], img[alt="Browser Fixture cover"]')).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText("1 title ready.")).toBeVisible({ timeout: 60_000 });

  await fixtureBook.click();
  const dialog = page.getByRole("dialog", { name: "Browser Fixture" });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  await expect(dialog.locator('.open-book-reader[data-flip-engine="page-flip"]')).toBeVisible();
  await expect(dialog.getByText(/Page 1 of \d+/)).toBeVisible();
  await dialog.getByRole("button", { name: "Next page" }).click();
  await expect(dialog.getByText("A browser-tested highlight.")).toBeVisible();
  await expect(dialog.getByText("A browser-tested note.")).toBeVisible();

  await dialog.getByRole("button", { name: "Close book" }).click();
  await expect(dialog).toBeHidden();

  await fixtureBook.click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(8, 8);
  await expect(dialog).toBeHidden();

  await fixtureBook.click();
  await expect(dialog).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export EPUB" }).click();
  const download = await downloadPromise;

  assert.equal(download.suggestedFilename(), fixture.export.filename);
  const downloadPath = await download.path();
  assert.ok(downloadPath);
  assertValidEpub(downloadPath);

  const events = await page.evaluate<AfterbookEvents>(() => window.__afterbookEvents);
  assert.deepEqual(events.pickerOptions, DIRECTORY_PICKER_OPTIONS);
  const loadMessage = events.workerMessages[0];
  assert.ok(loadMessage);
  assert.equal(loadMessage.type, WORKER_REQUESTS.catalogAnnotations);
  assert.deepEqual(loadMessage.paths, [
    ".kobo/KoboReader.sqlite",
    ".kobo/KoboReader.sqlite-wal",
    ".kobo/KoboReader.sqlite-shm",
  ]);
  const exportMessage = events.workerMessages.find(
    (message) => message.type === WORKER_REQUESTS.generateAnnotationEpub,
  );
  assert.ok(exportMessage);
  assert.equal(exportMessage.type, WORKER_REQUESTS.generateAnnotationEpub);
  assert.equal(exportMessage.bookId, "browser-fixture-book");
  assert.equal(exportMessage.coverPath, firstCoverPath);
});

test("renders the EPUB preview as an open book across landscape screens", async ({ page }) => {
  const fixture = buildFixture();
  test.setTimeout(120_000);
  await page.addInitScript(installFakeKoboDirectory, {
    fixture,
    workerRequests: WORKER_REQUESTS,
  } satisfies BrowserHarness);

  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1024, height: 576 },
    { width: 720, height: 405 },
  ]) {
    await page.setViewportSize(viewport);
    const dialog = await openFixtureBook(page);
    const initialMetrics = await bookShapeMetrics(page);
    assertBookShape(initialMetrics, viewport);

    const fontSizeBefore = await visibleReaderFontSize(dialog);
    await setReaderTextSizeToLarge(page, dialog);
    await expect
      .poll(() => visibleReaderFontSize(dialog), {
        message: "font size slider should resize book text",
      })
      .toBeGreaterThan(fontSizeBefore);

    await dragTopRightPageCorner(page, dialog);
    await expect(dialog.getByText("A browser-tested highlight.")).toBeVisible();
    await expect(dialog.getByText("A browser-tested note.")).toBeVisible();
    await expect(dialog.locator('.open-book-reader[data-flip-state="read"]')).toBeVisible({
      timeout: 3_000,
    });

    const turnedMetrics = await bookShapeMetrics(page);
    assertBookShape(turnedMetrics, viewport);
    assert.ok(
      Math.abs(turnedMetrics.shell.top - initialMetrics.shell.top) <= 1,
      "book shell should not jump vertically while turning pages",
    );
  }
});

test("explains when the File System Access API is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: undefined,
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("status")).toHaveText("No reader connected.");
  await page.getByRole("button", { name: "Connect Reader" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Chrome or Edge on desktop is required for local reader access.",
  );
});

test("handles denied read permission", async ({ page }) => {
  await page.addInitScript(() => {
    window.showDirectoryPicker = async () => ({
      async queryPermission() {
        return "prompt";
      },
      async requestPermission(descriptor: ReadPermissionDescriptor) {
        if (descriptor.mode !== "read") {
          throw new Error("Afterbook requested writable access");
        }
        return "denied";
      },
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Connect Reader" }).click();

  await expect(page.getByRole("status")).toHaveText("Afterbook needs read access to continue.");
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
  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Connect Reader" }).click();

  await expect(page.getByRole("status")).toHaveText("Selected source is not a supported reader.");
});

async function openFixtureBook(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Connect Reader" }).click();
  const fixtureBook = page.getByRole("button", { name: "Open Browser Fixture" });
  await fixtureBook.waitFor({ state: "visible", timeout: 60_000 });
  await fixtureBook.click();
  const dialog = page.getByRole("dialog", { name: "Browser Fixture" });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  await expect(dialog.locator(".flip-book-page.--simple").first()).toBeVisible({
    timeout: 60_000,
  });
  return dialog;
}

async function bookShapeMetrics(page: Page) {
  return page.locator(".open-book-reader").evaluate((reader) => {
    const shell = reader.querySelector(".page-flip-shell");
    const book = reader.querySelector(".page-flip-book");
    const wrapper = reader.querySelector(".stf__wrapper");
    if (!shell || !book || !wrapper) {
      throw new Error("Expected page-flip book DOM to be mounted.");
    }
    const shellRect = shell.getBoundingClientRect();
    const shellStyle = getComputedStyle(shell);
    const visiblePages = Array.from(reader.querySelectorAll(".flip-book-page"))
      .filter((pageElement) => {
        const rect = pageElement.getBoundingClientRect();
        const style = getComputedStyle(pageElement);
        return rect.width > 0 && rect.height > 0 && style.display !== "none";
      })
      .map((pageElement) => {
        const rect = pageElement.getBoundingClientRect();
        const style = getComputedStyle(pageElement);
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          borderTopLeftRadius: style.borderTopLeftRadius,
          borderTopRightRadius: style.borderTopRightRadius,
          boxShadow: style.boxShadow,
          overflowY: style.overflowY,
        };
      });
    const spreadLeft = Math.min(...visiblePages.map((pageMetrics) => pageMetrics.left));
    const spreadRight = Math.max(...visiblePages.map((pageMetrics) => pageMetrics.right));
    const spreadHeight = Math.max(...visiblePages.map((pageMetrics) => pageMetrics.height));

    return {
      documentScrollWidth: document.documentElement.scrollWidth,
      engine: reader.getAttribute("data-flip-engine"),
      shell: {
        top: shellRect.top,
        width: shellRect.width,
        height: shellRect.height,
        filter: shellStyle.filter,
      },
      spread: {
        width: spreadRight - spreadLeft,
        height: spreadHeight,
      },
      isLandscape: wrapper.classList.contains("--landscape"),
      pages: visiblePages,
    };
  });
}

function assertBookShape(
  metrics: Awaited<ReturnType<typeof bookShapeMetrics>>,
  viewport: { width: number; height: number },
) {
  assert.ok(
    metrics.documentScrollWidth <= viewport.width + 1,
    "modal must not create horizontal overflow",
  );
  assert.equal(metrics.engine, "page-flip", "reader should be backed by the page-flip engine");
  assert.equal(metrics.isLandscape, true, "book should stay in two-page landscape mode");
  assert.ok(metrics.spread.width > metrics.spread.height * 1.28, "spread should read as an open book");
  assert.notEqual(metrics.shell.filter, "none", "book should cast a drop shadow");
  assert.ok(metrics.pages.length >= 2, "spread should expose two visible pages");

  for (const pageMetrics of metrics.pages) {
    assert.ok(pageMetrics.height > pageMetrics.width, "each page should be portrait-shaped");
    assert.equal(pageMetrics.overflowY, "hidden", "pages should not show vertical scrollbars");
    assert.notEqual(pageMetrics.boxShadow, "none", "pages should have inset/depth shadow");
    assert.notEqual(pageMetrics.borderTopLeftRadius, "0px", "pages should have rounded corners");
    assert.notEqual(pageMetrics.borderTopRightRadius, "0px", "pages should have rounded corners");
  }
}

async function visibleReaderFontSize(dialog: Locator) {
  return dialog.locator(".flip-book-page.--simple .epub-page-content").first().evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).fontSize),
  );
}

async function setReaderTextSizeToLarge(page: Page, dialog: Locator) {
  const slider = dialog.getByLabel("Reader text size");
  const box = await slider.boundingBox();
  assert.ok(box, "expected visible text-size slider");
  await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
}

async function dragTopRightPageCorner(page: Page, dialog: Locator) {
  const rightPage = dialog.locator(".flip-book-page.--right.--simple").first();
  const box = await rightPage.boundingBox();
  assert.ok(box, "expected a visible right-hand page to drag");
  const startX = box.x + box.width - 6;
  const startY = box.y + 6;
  const endX = box.x - box.width * 0.85;
  const endY = box.y + box.height * 0.2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 12 });
  await page.mouse.up();
}

function buildFixture(): BrowserFixture {
  return JSON.parse(
    execFileSync(PYTHON, ["tests/fixtures/kobo-reader-fixture.py"], {
      cwd: WEB_ROOT,
      encoding: "utf8",
    }),
  );
}

function resolvePython(): string {
  const candidates = [
    process.env.AFTERBOOK_PYTHON,
    process.env.PYTHON,
    path.join(process.env.HOME || "", ".pyenv/shims/python3"),
    "python3",
    "python",
  ].filter((candidate): candidate is string => Boolean(candidate));

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

function assertValidEpub(downloadPath: string) {
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

function installFakeKoboDirectory({ fixture, workerRequests }: BrowserHarness) {
  type FakeHandle = FakeFileHandle | FakeDirectoryHandle;

  class FakeFileHandle {
    readonly kind = "file";

    constructor(
      readonly name: string,
      private readonly bytes: Uint8Array,
    ) {}

    async getFile() {
      return new File([arrayBufferFor(this.bytes)], this.name);
    }
  }

  class FakeDirectoryHandle {
    readonly kind = "directory";
    readonly children = new Map<string, FakeHandle>();

    constructor(readonly name: string) {}

    async queryPermission(descriptor: ReadPermissionDescriptor) {
      if (descriptor.mode !== "read") {
        throw new Error("Afterbook requested writable access");
      }
      return "granted";
    }

    async requestPermission(descriptor: ReadPermissionDescriptor) {
      if (descriptor.mode !== "read") {
        throw new Error("Afterbook requested writable access");
      }
      return "granted";
    }

    async getDirectoryHandle(name: string) {
      const child = this.children.get(name);
      if (!child || child.kind !== "directory") {
        throw new DOMException("Missing directory", "NotFoundError");
      }
      return child;
    }

    async getFileHandle(name: string) {
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

    addFile(filePath: string, bytes: Uint8Array) {
      const segments = filePath.split("/");
      let directory: FakeDirectoryHandle = this;
      for (const segment of segments.slice(0, -1)) {
        let child = directory.children.get(segment);
        if (child && child.kind !== "directory") {
          throw new Error(`Fixture path segment is not a directory: ${segment}`);
        }
        if (!child) {
          child = new FakeDirectoryHandle(segment);
          directory.children.set(segment, child);
        }
        directory = child;
      }
      const filename = segments.at(-1);
      if (!filename) {
        throw new Error("Fixture file path is empty.");
      }
      directory.children.set(filename, new FakeFileHandle(filename, bytes));
    }
  }

  const files = new Map<string, Uint8Array>(
    Object.entries(fixture.files).map(([filePath, encoded]) => [
      filePath,
      decodeBase64(encoded),
    ]),
  );
  const root = new FakeDirectoryHandle("KOBOeReader");
  for (const [filePath, bytes] of files) {
    root.addFile(filePath, bytes);
  }

  window.__afterbookEvents = { pickerOptions: null, workerMessages: [] };
  window.showDirectoryPicker = async (options: PickerOptions) => {
    window.__afterbookEvents.pickerOptions = options;
    return root;
  };
  const NativeWorker = window.Worker;
  class LoggedWorker {
    private readonly worker: Worker;

    constructor(url: string | URL, options?: WorkerOptions) {
      this.worker = new NativeWorker(url, options);
    }

    addEventListener(...args: Parameters<Worker["addEventListener"]>) {
      return this.worker.addEventListener(...args);
    }

    removeEventListener(...args: Parameters<Worker["removeEventListener"]>) {
      return this.worker.removeEventListener(...args);
    }

    postMessage(message: unknown, transfer?: Transferable[]) {
      const loggedMessage = message as WorkerRequestLogMessage;
      const payload = loggedMessage.payload || {};
      if (loggedMessage.type === workerRequests.catalogAnnotations && Array.isArray(payload.files)) {
        window.__afterbookEvents.workerMessages.push({
          type: workerRequests.catalogAnnotations,
          paths: payload.files.map((file) => file.path),
        });
      }
      if (loggedMessage.type === workerRequests.generateAnnotationEpub) {
        window.__afterbookEvents.workerMessages.push({
          type: workerRequests.generateAnnotationEpub,
          bookId: payload.bookId || "",
          coverPath: payload.coverFile?.path || null,
        });
      }
      if (transfer) {
        return this.worker.postMessage(message, transfer);
      }
      return this.worker.postMessage(message);
    }

    terminate() {
      return this.worker.terminate();
    }
  }
  window.Worker = LoggedWorker as unknown as typeof Worker;

  function decodeBase64(encoded: string): Uint8Array {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function arrayBufferFor(bytes: Uint8Array): ArrayBuffer {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
  }
}
