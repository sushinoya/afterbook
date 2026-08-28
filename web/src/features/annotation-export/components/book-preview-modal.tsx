import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  X,
} from "lucide-react";
import { PageFlip, type PageFlipState } from "page-flip";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import type { GeneratedEpub, ReaderBook } from "../../../domain/readers.js";
import {
  parseGeneratedEpubPreview,
  type EpubPreviewPage,
} from "../epub-preview.js";

const PAGE_FLIP_DURATION_MS = 420;
const PAGE_DRAG_EDGE_RATIO = 0.16;
const PAGE_DRAG_EDGE_MIN_PX = 42;
const PAGE_DRAG_EDGE_MAX_PX = 82;

export function BookPreviewModal({
  book,
  epub,
  isLoading,
  isExporting,
  isActiveExport,
  onClose,
  onExport,
}: {
  book: ReaderBook;
  epub: GeneratedEpub | null;
  isLoading: boolean;
  isExporting: boolean;
  isActiveExport: boolean;
  onClose(): void;
  onExport(book: ReaderBook): void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const [fontScale, setFontScale] = useState(1);

  useEffect(() => {
    closeButton.current?.focus();
  }, [book.id]);

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="book-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="book-dialog-title"
      >
        <h2 className="visually-hidden" id="book-dialog-title">
          {book.title}
        </h2>
        <div className="book-modal-actions">
          <label className="book-text-size-control">
            <span aria-hidden="true">A</span>
            <input
              aria-label="Reader text size"
              type="range"
              min="0.88"
              max="1.28"
              step="0.04"
              value={fontScale}
              onInput={(event) => setFontScale(Number(event.currentTarget.value))}
              onChange={(event) => setFontScale(Number(event.currentTarget.value))}
            />
            <strong aria-hidden="true">A</strong>
          </label>
          <button
            className="book-action-button"
            type="button"
            onClick={() => onExport(book)}
            disabled={isExporting || isLoading}
          >
            {isActiveExport ? (
              <Loader2 className="spin" size={17} aria-hidden="true" />
            ) : (
              <Download size={17} aria-hidden="true" />
            )}
            Export EPUB
          </button>
          <button
            className="book-action-button icon-only"
            type="button"
            aria-label="Close book"
            onClick={onClose}
            ref={closeButton}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <EpubBookReader
          book={book}
          epub={epub}
          fontScale={fontScale}
          isLoading={isLoading}
        />
      </section>
    </div>
  );
}

function EpubBookReader({
  book,
  epub,
  fontScale,
  isLoading,
}: {
  book: ReaderBook;
  epub: GeneratedEpub | null;
  fontScale: number;
  isLoading: boolean;
}) {
  const bookStage = useRef<HTMLDivElement>(null);
  const pageFlip = useRef<PageFlip | null>(null);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [readerState, setReaderState] = useState<PageFlipState>("read");
  const previewState = useMemo(() => {
    if (!epub) {
      return { preview: null, error: null };
    }
    try {
      return { preview: parseGeneratedEpubPreview(epub), error: null };
    } catch (error) {
      return {
        preview: null,
        error: error instanceof Error ? error.message : "Could not render this EPUB preview.",
      };
    }
  }, [epub]);

  const preview = previewState.preview;
  const pageCount = preview?.pages.length || 0;
  const renderedPages = useMemo(
    () => (preview ? createRenderablePages(preview.pages) : []),
    [preview],
  );
  const spreadCount = Math.max(1, Math.ceil(renderedPages.length / 2));
  const isReaderIdle = readerState === "read";
  const canTurnBack = isReaderIdle && currentPageIndex > 0;
  const canTurnForward = isReaderIdle && currentPageIndex < renderedPages.length - 2;
  const progressStart = Math.min(currentPageIndex + 1, pageCount);
  const progressEnd = Math.min(currentPageIndex + 2, pageCount);

  useEffect(() => {
    const stage = bookStage.current;
    if (!preview || renderedPages.length === 0 || !stage) {
      return undefined;
    }

    let lastSizeKey = "";
    let animationFrame = 0;
    let isDisposed = false;

    const destroyBook = () => {
      if (pageFlip.current) {
        pageFlip.current.destroy();
        pageFlip.current = null;
      }
      stage.replaceChildren();
    };

    const mountBook = () => {
      if (isDisposed) {
        return;
      }

      const rect = stage.getBoundingClientRect();
      const pageWidth = Math.floor(rect.width / 2);
      const pageHeight = Math.floor(rect.height);
      if (pageWidth <= 0 || pageHeight <= 0) {
        return;
      }

      const sizeKey = `${pageWidth}x${pageHeight}`;
      if (sizeKey === lastSizeKey && pageFlip.current) {
        pageFlip.current.update();
        return;
      }
      lastSizeKey = sizeKey;

      destroyBook();
      setCurrentPageIndex(0);
      setReaderState("read");

      const host = document.createElement("div");
      host.className = "page-flip-book";
      stage.append(host);
      installPageDragStartGuard(host, {
        getCurrentPageIndex: () => pageFlip.current?.getCurrentPageIndex() || 0,
        getReaderState: () => pageFlip.current?.getState() || "read",
        pageCount: renderedPages.length,
      });

      const instance = new PageFlip(host, {
        autoSize: false,
        clickEventForward: true,
        disableFlipByClick: true,
        drawShadow: true,
        flippingTime: PAGE_FLIP_DURATION_MS,
        height: pageHeight,
        maxShadowOpacity: 0.36,
        mobileScrollSupport: true,
        showCover: false,
        showPageCorners: false,
        size: "fixed",
        startPage: 0,
        startZIndex: 1,
        swipeDistance: 24,
        useMouseEvents: true,
        usePortrait: false,
        width: pageWidth,
      });
      pageFlip.current = instance;

      instance.on("flip", (event) => {
        setCurrentPageIndex(normalizePageIndex(event.data, pageCount));
      });
      instance.on("changeState", (event) => {
        setReaderState(normalizePageFlipState(event.data));
      });
      instance.on("init", (event) => {
        if (isPageFlipInitEvent(event.data)) {
          setCurrentPageIndex(normalizePageIndex(event.data.page, pageCount));
        }
      });
      instance.loadFromHTML(buildPageFlipElements(renderedPages));
    };

    const scheduleMount = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(mountBook);
    };

    const resizeObserver = new ResizeObserver(scheduleMount);
    resizeObserver.observe(stage);
    scheduleMount();

    return () => {
      isDisposed = true;
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      destroyBook();
    };
  }, [pageCount, preview, renderedPages]);

  const flipToPreviousPage = useCallback(() => {
    if (canTurnBack) {
      pageFlip.current?.flipPrev("top");
    }
  }, [canTurnBack]);

  const flipToNextPage = useCallback(() => {
    if (canTurnForward) {
      pageFlip.current?.flipNext("top");
    }
  }, [canTurnForward]);

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
        return;
      }
      event.preventDefault();
      if (event.key === "ArrowRight") {
        flipToNextPage();
      } else {
        flipToPreviousPage();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [flipToNextPage, flipToPreviousPage]);

  if (isLoading) {
    return (
      <div className="open-book-empty">
        <Loader2 className="spin" size={22} aria-hidden="true" />
        <span>Preparing EPUB preview.</span>
      </div>
    );
  }

  if (!preview || pageCount === 0) {
    return (
      <div className="open-book-empty">
        <BookOpen size={22} aria-hidden="true" />
        <span>{previewState.error || "Could not render this EPUB preview."}</span>
      </div>
    );
  }

  return (
    <div
      className="open-book-reader"
      data-reader-engine="st-page-flip"
      data-reader-state={readerState}
      data-page-index={currentPageIndex}
      style={
        {
          "--reader-font-size": `${16 * fontScale}px`,
          "--page-flip-duration": `${PAGE_FLIP_DURATION_MS}ms`,
        } as CSSProperties
      }
    >
      <button
        className="spread-turn previous"
        type="button"
        aria-label="Previous page"
        onClick={flipToPreviousPage}
        disabled={!canTurnBack}
      >
        <ChevronLeft size={26} aria-hidden="true" />
      </button>
      <div
        className="book-stage"
        data-page-flip-library="st-page-flip"
        aria-label={`${preview.title} EPUB preview, ${spreadCount} spreads`}
        ref={bookStage}
      />
      <button
        className="spread-turn next"
        type="button"
        aria-label="Next page"
        onClick={flipToNextPage}
        disabled={!canTurnForward}
      >
        <ChevronRight size={26} aria-hidden="true" />
      </button>
      <p className="book-progress" aria-live="polite">
        {progressStart === progressEnd
          ? `Page ${progressStart} of ${pageCount}`
          : `Pages ${progressStart}-${progressEnd} of ${pageCount}`}
      </p>
    </div>
  );
}

interface RenderablePage {
  bodyHtml: string;
  id: string;
  kind: EpubPreviewPage["kind"] | "blank";
  pageNumber: number;
  title: string;
}

function createRenderablePages(pages: readonly EpubPreviewPage[]): RenderablePage[] {
  const rendered: RenderablePage[] = pages.map((page, index) => ({
    ...page,
    pageNumber: index + 1,
  }));
  if (rendered.length % 2 === 1) {
    rendered.push({
      bodyHtml: "",
      id: "__blank-final-page",
      kind: "blank",
      pageNumber: rendered.length + 1,
      title: "Blank",
    });
  }
  return rendered;
}

function buildPageFlipElements(pages: readonly RenderablePage[]): HTMLElement[] {
  return pages.map((page) => {
    const element = document.createElement("article");
    element.className = `reader-page${page.kind === "blank" ? " blank" : ""}`;
    element.dataset.kind = page.kind;
    element.dataset.pageNumber = String(page.pageNumber);
    element.dataset.pageFlipPage = "";

    if (page.kind === "blank") {
      element.setAttribute("aria-hidden", "true");
      return element;
    }

    element.setAttribute("aria-label", `${page.title}, page ${page.pageNumber}`);
    element.setAttribute("role", "document");

    const content = document.createElement("div");
    content.className = "reader-page-content";
    content.innerHTML = page.bodyHtml;
    if (page.kind === "cover") {
      normalizeCoverPageContent(content, page.title);
    }
    element.append(content);

    if (page.kind !== "cover") {
      const pageNumber = document.createElement("span");
      pageNumber.className = "book-page-number";
      pageNumber.textContent = String(page.pageNumber);
      element.append(pageNumber);
    }

    return element;
  });
}

function normalizeCoverPageContent(content: HTMLElement, title: string) {
  const source = coverImageSource(content);
  if (!source) {
    return;
  }

  const image = document.createElement("img");
  image.alt = title === "Cover" ? "Book cover" : `${title} cover`;
  image.className = "cover-art";
  image.decoding = "async";
  image.draggable = false;
  image.src = source;
  content.replaceChildren(image);
}

function coverImageSource(content: HTMLElement): string | null {
  const candidates: string[] = [];
  const image = content.querySelector("img");
  const directSource = image?.getAttribute("src");
  if (directSource) {
    candidates.push(directSource);
  }

  const svgImage = content.querySelector("svg image");
  const svgHref =
    svgImage && "href" in svgImage
      ? (svgImage.href as SVGAnimatedString | undefined)?.baseVal
      : null;
  for (const source of [
    svgHref,
    svgImage?.getAttribute("href"),
    svgImage?.getAttribute("xlink:href"),
    svgImage?.getAttributeNS("http://www.w3.org/1999/xlink", "href"),
  ]) {
    if (source) {
      candidates.push(source);
    }
  }

  return candidates.find((source) => source.startsWith("data:")) || candidates[0] || null;
}

function normalizePageIndex(value: unknown, pageCount: number): number {
  return clamp(typeof value === "number" ? value : 0, 0, Math.max(0, pageCount - 1));
}

function installPageDragStartGuard(
  host: HTMLElement,
  options: {
    getCurrentPageIndex(): number;
    getReaderState(): PageFlipState;
    pageCount: number;
  },
) {
  const guardDragStart = (event: MouseEvent | TouchEvent) => {
    const point = pointerStartPoint(event);
    if (!point || isAllowedPageDragStart(host, point, options)) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  host.addEventListener("mousedown", guardDragStart, { capture: true });
  host.addEventListener("touchstart", guardDragStart, { capture: true });
}

function pointerStartPoint(event: MouseEvent | TouchEvent): { x: number; y: number } | null {
  if (event instanceof MouseEvent) {
    return { x: event.clientX, y: event.clientY };
  }
  const touch = event.changedTouches.item(0) || event.touches.item(0);
  return touch ? { x: touch.clientX, y: touch.clientY } : null;
}

function isAllowedPageDragStart(
  host: HTMLElement,
  point: { x: number; y: number },
  options: {
    getCurrentPageIndex(): number;
    getReaderState(): PageFlipState;
    pageCount: number;
  },
) {
  if (options.getReaderState() !== "read") {
    return false;
  }

  const rect = host.getBoundingClientRect();
  const localX = point.x - rect.left;
  const localY = point.y - rect.top;
  if (localX < 0 || localY < 0 || localX > rect.width || localY > rect.height) {
    return false;
  }

  const pageWidth = rect.width / 2;
  const dragEdgeWidth = clamp(
    pageWidth * PAGE_DRAG_EDGE_RATIO,
    PAGE_DRAG_EDGE_MIN_PX,
    PAGE_DRAG_EDGE_MAX_PX,
  );
  const currentPageIndex = options.getCurrentPageIndex();
  const canTurnBack = currentPageIndex > 0;
  const canTurnForward = currentPageIndex < options.pageCount - 2;

  return (canTurnBack && localX <= dragEdgeWidth) || (canTurnForward && localX >= rect.width - dragEdgeWidth);
}

function normalizePageFlipState(value: unknown): PageFlipState {
  if (
    value === "read" ||
    value === "user_fold" ||
    value === "fold_corner" ||
    value === "flipping"
  ) {
    return value;
  }
  return "read";
}

function isPageFlipInitEvent(value: unknown): value is { page: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    "page" in value &&
    typeof (value as { page: unknown }).page === "number"
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
