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
  await expect(dialog.locator('.open-book-reader[data-reader-engine="st-page-flip"]')).toBeVisible();
  await expect(dialog.getByText(/Pages 1-2 of \d+/)).toBeVisible();
  await dialog.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(dialog.locator('.open-book-reader[data-reader-state="read"][data-page-index="2"]')).toBeVisible({
    timeout: 3_000,
  });
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
    assert.deepEqual(initialMetrics.basePages, [1, 2], "initial spread should show pages 1 and 2");
    await assertCoverFillsPage(dialog);

    await hoverTopRightPageCorner(page, dialog);
    await expect(dialog.locator('.open-book-reader[data-reader-state="read"]')).toBeVisible();
    assert.equal(
      await dialog.locator(".turning-sheet").count(),
      0,
      "custom turning sheets must not come back",
    );
    assert.equal(
      await dialog.locator(".book-spread.incoming").count(),
      0,
      "custom spread transitions must not come back",
    );
    assert.equal(
      await dialog.locator(".page-turn-animation").count(),
      0,
      "custom page-turn overlays must not come back",
    );
    assert.equal(
      await dialog.locator(".stf__block").count(),
      1,
      "StPageFlip should own the book interaction surface",
    );

    const fontSizeBefore = await visibleReaderTypeMetrics(dialog);
    await setReaderTextSizeToLarge(page, dialog);
    await expect
      .poll(async () => {
        const after = await visibleReaderTypeMetrics(dialog);
        return after.body > fontSizeBefore.body && after.heading > fontSizeBefore.heading;
      }, {
        message: "font size slider should resize book text and headings",
      })
      .toBe(true);

    await pullTopRightPageCorner(page, dialog);
    const draggingForward = await pageFlipInteractionMetrics(dialog);
    assert.equal(draggingForward.state, "user_fold", "dragging should be handled by StPageFlip");
    assert.equal(draggingForward.hasStPageFlipBlock, true, "library render block should be mounted");
    assert.equal(draggingForward.hasLibraryShadow, true, "library should draw turn shadows while dragging");
    assert.equal(draggingForward.hasCustomFlipOverlay, false, "custom page-turn overlays must not render");
    assert.equal(draggingForward.hasCustomSpread, false, "custom spread transitions must not render");
    assert.deepEqual(
      draggingForward.restingPages,
      [1, 2],
      "dragging forward should keep the current resting pages stable",
    );
    assert.ok(
      draggingForward.durationMs <= 500,
      "page turn animation should feel responsive, not slow",
    );
    assert.ok(draggingForward.page3Content, "forward flip should include page 3 content");
    assert.equal(draggingForward.page3Content.contentTransform, "none", "page 3 content must not be directly transformed");
    assert.equal(draggingForward.page3Content.writingMode, "horizontal-tb", "page 3 text must remain horizontal");
    assert.ok(
      draggingForward.page3Content.box.height > draggingForward.page3Content.box.width,
      "page 3 content should remain portrait-oriented during the flip",
    );
    await page.mouse.up();
    await expect(dialog.getByText("A browser-tested highlight.")).toBeVisible();
    await expect(dialog.getByText("A browser-tested note.")).toBeVisible();
    await expect(dialog.locator('.open-book-reader[data-reader-state="read"][data-page-index="2"]')).toBeVisible({
      timeout: 3_000,
    });

    const turnedMetrics = await bookShapeMetrics(page);
    assertBookShape(turnedMetrics, viewport);
    assert.deepEqual(turnedMetrics.basePages, [3, 4], "next spread should settle on pages 3 and 4");
    assert.ok(
      Math.abs(turnedMetrics.stage.top - initialMetrics.stage.top) <= 1,
      "book stage should not jump vertically while turning pages",
    );

    await dialog.getByRole("button", { name: "Previous page", exact: true }).click();
    await expect(dialog.locator('.open-book-reader[data-reader-state="read"][data-page-index="0"]')).toBeVisible({
      timeout: 3_000,
    });
    const returnedMetrics = await bookShapeMetrics(page);
    assert.deepEqual(returnedMetrics.basePages, [1, 2], "previous button should return to pages 1 and 2");

    await dialog.getByRole("button", { name: "Next page", exact: true }).click();
    await expect(dialog.locator('.open-book-reader[data-reader-state="read"][data-page-index="2"]')).toBeVisible({
      timeout: 3_000,
    });
    await pullTopLeftPageCorner(page, dialog);
    const draggingBackward = await pageFlipInteractionMetrics(dialog);
    assert.equal(draggingBackward.state, "user_fold", "backward dragging should be handled by StPageFlip");
    assert.equal(draggingBackward.hasLibraryShadow, true, "library should draw turn shadows while dragging backward");
    assert.equal(draggingBackward.hasCustomFlipOverlay, false, "custom page-turn overlays must not render");
    assert.deepEqual(
      draggingBackward.restingPages,
      [3, 4],
      "dragging backward should keep the current resting pages stable",
    );
    await page.mouse.up();
    await expect(dialog.locator('.open-book-reader[data-reader-state="read"][data-page-index="0"]')).toBeVisible({
      timeout: 3_000,
    });
    const draggedBackMetrics = await bookShapeMetrics(page);
    assert.deepEqual(draggedBackMetrics.basePages, [1, 2], "backward corner drag should return to pages 1 and 2");
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
  await expect(dialog.locator('.reader-page[data-page-number="1"]').first()).toBeVisible({
    timeout: 60_000,
  });
  return dialog;
}

async function bookShapeMetrics(page: Page) {
  return page.locator(".open-book-reader").evaluate((reader) => {
    const stage = reader.querySelector(".book-stage");
    const flipBlock = reader.querySelector(".stf__block");
    if (!stage || !flipBlock) {
      throw new Error("Expected StPageFlip DOM to be mounted.");
    }
    const stageRect = stage.getBoundingClientRect();
    const stageStyle = getComputedStyle(stage);
    const contentPaddingBottom = (pageElement: Element) => {
      const content = pageElement.querySelector(".reader-page-content");
      return content ? Number.parseFloat(getComputedStyle(content).paddingBottom) : 0;
    };
    const pageNumberHeight = (pageElement: Element) => {
      const pageNumber = pageElement.querySelector(".book-page-number");
      return pageNumber ? pageNumber.getBoundingClientRect().height : 0;
    };
    const visiblePages = Array.from(reader.querySelectorAll(".reader-page.--simple"))
      .filter((pageElement) => {
        const rect = pageElement.getBoundingClientRect();
        return getComputedStyle(pageElement).display !== "none" && rect.width > 1 && rect.height > 1;
      })
      .map((pageElement) => {
        const rect = pageElement.getBoundingClientRect();
        const style = getComputedStyle(pageElement);
        return {
          pageNumber: Number(pageElement.getAttribute("data-page-number")),
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
          clientHeight: pageElement.clientHeight,
          contentPaddingBottom: contentPaddingBottom(pageElement),
          hasPageNumber: pageElement.querySelector(".book-page-number") !== null,
          kind: pageElement.getAttribute("data-kind"),
          pageNumberHeight: pageNumberHeight(pageElement),
          scrollHeight: pageElement.scrollHeight,
          borderTopLeftRadius: style.borderTopLeftRadius,
          borderTopRightRadius: style.borderTopRightRadius,
          boxShadow: style.boxShadow,
          overflowY: style.overflowY,
        };
      });

    return {
      documentScrollWidth: document.documentElement.scrollWidth,
      engine: reader.getAttribute("data-reader-engine"),
      basePages: visiblePages.map((pageMetrics) => pageMetrics.pageNumber),
      stage: {
        top: stageRect.top,
        bottom: stageRect.bottom,
        width: stageRect.width,
        height: stageRect.height,
        filter: stageStyle.filter,
      },
      spread: {
        width: stageRect.width,
        height: stageRect.height,
      },
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
  assert.equal(metrics.engine, "st-page-flip", "reader should use the StPageFlip engine");
  assert.ok(metrics.spread.width > metrics.spread.height * 1.28, "spread should read as an open book");
  assert.ok(metrics.spread.width < metrics.spread.height * 1.42, "spread proportions should stay book-like");
  assert.ok(metrics.stage.height > viewport.height * 0.52, "book should be large enough for the viewport");
  assert.ok(
    viewport.height - metrics.stage.bottom >= 18,
    "book stage should leave room for its drop shadow at the bottom",
  );
  assert.notEqual(metrics.stage.filter, "none", "book should cast a drop shadow");
  assert.equal(metrics.pages.length, 2, "spread should expose two resting pages");

  for (const pageMetrics of metrics.pages) {
    assert.ok(pageMetrics.height > pageMetrics.width, "each page should be portrait-shaped");
    assert.ok(pageMetrics.height < pageMetrics.width * 1.58, "page proportions should stay close to a book");
    assert.equal(pageMetrics.overflowY, "hidden", "pages should not show vertical scrollbars");
    assert.notEqual(pageMetrics.boxShadow, "none", "pages should have inset/depth shadow");
    assert.notEqual(pageMetrics.borderTopLeftRadius, "0px", "pages should have rounded corners");
    assert.notEqual(pageMetrics.borderTopRightRadius, "0px", "pages should have rounded corners");
    assert.ok(
      Number.parseFloat(pageMetrics.borderTopLeftRadius) <= 10,
      "page corners should not be over-rounded",
    );
    assert.ok(
      pageMetrics.scrollHeight <= pageMetrics.clientHeight + 1,
      "pages should not overflow vertically",
    );
    if (pageMetrics.kind === "cover") {
      assert.equal(pageMetrics.hasPageNumber, false, "cover pages should not render a folio");
    } else if (pageMetrics.hasPageNumber) {
      assert.ok(
        pageMetrics.contentPaddingBottom >= pageMetrics.pageNumberHeight + 18,
        "page content should reserve clear space above the folio",
      );
    }
  }
}

async function visibleReaderTypeMetrics(dialog: Locator) {
  return dialog.locator('.reader-page[data-kind="title"]').evaluate((element) => {
    const body = element.querySelector(".reader-page-content");
    const heading = element.querySelector(".reader-page-content h1");
    if (!body || !heading) {
      throw new Error("Expected title page body and heading.");
    }
    return {
      body: Number.parseFloat(getComputedStyle(body).fontSize),
      heading: Number.parseFloat(getComputedStyle(heading).fontSize),
    };
  });
}

async function setReaderTextSizeToLarge(page: Page, dialog: Locator) {
  const slider = dialog.getByLabel("Reader text size");
  const box = await slider.boundingBox();
  assert.ok(box, "expected visible text-size slider");
  await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
}

async function hoverTopRightPageCorner(page: Page, dialog: Locator) {
  const book = dialog.locator(".book-stage");
  const box = await book.boundingBox();
  assert.ok(box, "expected visible book stage");
  await page.mouse.move(box.x + box.width - 12, box.y + 12);
  await page.waitForTimeout(180);
}

async function pullTopRightPageCorner(page: Page, dialog: Locator) {
  const book = dialog.locator(".book-stage");
  const bookBox = await book.boundingBox();
  assert.ok(bookBox, "expected a visible book stage");
  const startX = bookBox.x + bookBox.width - 12;
  const startY = bookBox.y + 12;
  const endX = bookBox.x + bookBox.width * 0.36;
  const endY = bookBox.y + bookBox.height * 0.18;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 16 });
  await expect(dialog.locator('.open-book-reader[data-reader-state="user_fold"]')).toBeVisible();
}

async function pullTopLeftPageCorner(page: Page, dialog: Locator) {
  const book = dialog.locator(".book-stage");
  const bookBox = await book.boundingBox();
  assert.ok(bookBox, "expected a visible book stage");
  const startX = bookBox.x + 12;
  const startY = bookBox.y + 12;
  const endX = bookBox.x + bookBox.width * 0.64;
  const endY = bookBox.y + bookBox.height * 0.18;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 16 });
  await expect(dialog.locator('.open-book-reader[data-reader-state="user_fold"]')).toBeVisible();
}

async function pageFlipInteractionMetrics(dialog: Locator) {
  return dialog.locator(".open-book-reader").evaluate((reader) => {
    const page3Content = reader.querySelector(
      '.reader-page[data-page-number="3"] .reader-page-content',
    );
    const page3Rect = page3Content?.getBoundingClientRect();
    const page3Style = page3Content ? getComputedStyle(page3Content) : null;
    const libraryShadows = Array.from(
      reader.querySelectorAll(".stf__outerShadow, .stf__innerShadow, .stf__hardShadow, .stf__hardInnerShadow"),
    );
    return {
      durationMs: Number.parseFloat(
        getComputedStyle(reader).getPropertyValue("--page-flip-duration"),
      ),
      hasCustomFlipOverlay: reader.querySelector(".page-turn-animation") !== null,
      hasCustomSpread: reader.querySelector(".book-spread") !== null,
      hasLibraryShadow: libraryShadows.some((element) => {
        const style = getComputedStyle(element);
        return style.display !== "none" && style.opacity !== "0";
      }),
      hasStPageFlipBlock: reader.querySelector(".stf__block") !== null,
      restingPages: Array.from(reader.querySelectorAll(".reader-page.--simple"))
        .filter((pageElement) => {
          const rect = pageElement.getBoundingClientRect();
          return getComputedStyle(pageElement).display !== "none" && rect.width > 1 && rect.height > 1;
        })
        .map((pageElement) => Number(pageElement.getAttribute("data-page-number"))),
      page3Content:
        page3Rect && page3Style
          ? {
              box: {
                height: page3Rect.height,
                width: page3Rect.width,
              },
              contentTransform: page3Style.transform,
              writingMode: page3Style.writingMode,
            }
          : null,
      state: reader.getAttribute("data-reader-state"),
    };
  });
}

async function assertCoverFillsPage(dialog: Locator) {
  const coverMetrics = await dialog.locator('.reader-page[data-kind="cover"]').evaluate((pageElement) => {
    const content = pageElement.querySelector(".reader-page-content");
    const frame = pageElement.querySelector(".cover-frame");
    const cell = pageElement.querySelector(".cover-cell");
    const media = pageElement.querySelector("img, svg");
    if (!content || !frame || !cell || !media) {
      throw new Error("Expected cover media.");
    }
    const pageRect = pageElement.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const mediaRect = media.getBoundingClientRect();
    const pageStyle = getComputedStyle(pageElement);
    const contentStyle = getComputedStyle(content);
    const mediaStyle = getComputedStyle(media);
    return {
      cellInsidePage: rectInside(cellRect, pageRect),
      contentInsidePage: rectInside(contentRect, pageRect),
      contentOverflow: contentStyle.overflow,
      fillsPage:
        Math.abs(pageRect.left - mediaRect.left) <= 1 &&
        Math.abs(pageRect.top - mediaRect.top) <= 1 &&
        Math.abs(pageRect.width - mediaRect.width) <= 1 &&
        Math.abs(pageRect.height - mediaRect.height) <= 1,
      frameInsidePage: rectInside(frameRect, pageRect),
      mediaInsidePage: rectInside(mediaRect, pageRect),
      mediaObjectFit: mediaStyle.objectFit,
      pageNumberCount: pageElement.querySelectorAll(".book-page-number").length,
      pageOverflow: pageStyle.overflow,
      media: {
        bottom: mediaRect.bottom,
        height: mediaRect.height,
        left: mediaRect.left,
        right: mediaRect.right,
        top: mediaRect.top,
        width: mediaRect.width,
      },
      page: {
        bottom: pageRect.bottom,
        height: pageRect.height,
        left: pageRect.left,
        right: pageRect.right,
        top: pageRect.top,
        width: pageRect.width,
      },
    };

    function rectInside(inner: DOMRect, outer: DOMRect) {
      return (
        inner.left >= outer.left - 1 &&
        inner.top >= outer.top - 1 &&
        inner.right <= outer.right + 1 &&
        inner.bottom <= outer.bottom + 1
      );
    }
  });
  assert.equal(
    coverMetrics.pageNumberCount,
    0,
    `cover should not render a page number over the artwork: ${JSON.stringify(coverMetrics)}`,
  );
  assert.equal(
    coverMetrics.pageOverflow,
    "hidden",
    `cover page should clip its contents: ${JSON.stringify(coverMetrics)}`,
  );
  assert.equal(
    coverMetrics.contentOverflow,
    "hidden",
    `cover content should clip nested media: ${JSON.stringify(coverMetrics)}`,
  );
  assert.equal(
    coverMetrics.fillsPage,
    true,
    `cover should fill the full page surface: ${JSON.stringify(coverMetrics)}`,
  );
  assert.equal(
    coverMetrics.contentInsidePage && coverMetrics.frameInsidePage && coverMetrics.cellInsidePage,
    true,
    `cover wrappers should stay inside the page surface: ${JSON.stringify(coverMetrics)}`,
  );
  assert.equal(
    coverMetrics.mediaInsidePage,
    true,
    `cover media should not overflow the page surface: ${JSON.stringify(coverMetrics)}`,
  );
  assert.equal(
    coverMetrics.mediaObjectFit,
    "cover",
    `cover media should be cropped within the page, not spilled out: ${JSON.stringify(coverMetrics)}`,
  );
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
