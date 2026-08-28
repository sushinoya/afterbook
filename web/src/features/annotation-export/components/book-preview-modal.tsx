import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  X,
} from "lucide-react";
import HTMLFlipBook from "react-pageflip";
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
  type RefAttributes,
} from "react";

import type { GeneratedEpub, ReaderBook } from "../../../domain/readers.js";
import {
  parseGeneratedEpubPreview,
  type EpubPreviewPage,
} from "../epub-preview.js";

const PAGE_FLIP_DURATION_MS = 520;
const PAGE_DRAG_EDGE_RATIO = 0.16;
const PAGE_DRAG_EDGE_MIN_PX = 42;
const PAGE_DRAG_EDGE_MAX_PX = 82;

type PageFlipCorner = "top" | "bottom";
type ReaderState = "user_fold" | "fold_corner" | "flipping" | "read";

interface PageFlipEvent<TData = unknown> {
  data: TData;
}

interface HtmlFlipBookController {
  flipNext(corner?: PageFlipCorner): void;
  flipPrev(corner?: PageFlipCorner): void;
  getCurrentPageIndex(): number;
  getState(): ReaderState;
}

interface HtmlFlipBookHandle {
  pageFlip(): HtmlFlipBookController | undefined;
}

interface HtmlFlipBookProps {
  autoSize: boolean;
  children: ReactNode;
  className: string;
  clickEventForward: boolean;
  disableFlipByClick: boolean;
  drawShadow: boolean;
  flippingTime: number;
  height: number;
  maxHeight: number;
  maxShadowOpacity: number;
  maxWidth: number;
  minHeight: number;
  minWidth: number;
  mobileScrollSupport: boolean;
  onChangeState?(event: PageFlipEvent): void;
  onFlip?(event: PageFlipEvent): void;
  onInit?(event: PageFlipEvent): void;
  onUpdate?(event: PageFlipEvent): void;
  renderOnlyPageLengthChange?: boolean;
  showCover: boolean;
  showPageCorners: boolean;
  size: "fixed";
  startPage: number;
  startZIndex: number;
  style: CSSProperties;
  swipeDistance: number;
  useMouseEvents: boolean;
  usePortrait: boolean;
  width: number;
}

const HTMLFlipBookView = HTMLFlipBook as unknown as ComponentType<
  HtmlFlipBookProps & RefAttributes<HtmlFlipBookHandle>
>;

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
  const flipBook = useRef<HtmlFlipBookHandle | null>(null);
  const [bookSize, setBookSize] = useState<BookSize | null>(null);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [readerState, setReaderState] = useState<ReaderState>("read");
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
  const flipBookKey = `${book.id}:${epub?.filename || ""}:${epub?.data.byteLength || 0}:${bookSize?.pageWidth || 0}x${bookSize?.pageHeight || 0}`;

  const guardState = useRef({
    currentPageIndex,
    pageCount: renderedPages.length,
    readerState,
  });
  guardState.current = {
    currentPageIndex,
    pageCount: renderedPages.length,
    readerState,
  };

  useEffect(() => {
    setCurrentPageIndex(0);
    setReaderState("read");
  }, [book.id, epub?.data.byteLength, epub?.filename, renderedPages.length]);

  useEffect(() => {
    const stage = bookStage.current;
    if (!preview || !stage) {
      return undefined;
    }

    let animationFrame = 0;

    const measureBook = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        const rect = stage.getBoundingClientRect();
        const pageWidth = Math.floor(rect.width / 2);
        const pageHeight = Math.floor(rect.height);
        if (pageWidth <= 0 || pageHeight <= 0) {
          return;
        }
        setBookSize((current) => {
          if (current?.pageWidth === pageWidth && current.pageHeight === pageHeight) {
            return current;
          }
          return { pageHeight, pageWidth };
        });
      });
    };

    const resizeObserver = new ResizeObserver(measureBook);
    resizeObserver.observe(stage);
    measureBook();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
    };
  }, [preview, renderedPages.length]);

  useEffect(() => {
    const stage = bookStage.current;
    if (!preview || !stage) {
      return undefined;
    }

    return installPageDragStartGuard(stage, {
      getCurrentPageIndex: () => guardState.current.currentPageIndex,
      getReaderState: () => guardState.current.readerState,
      pageCount: renderedPages.length,
    });
  }, [preview, renderedPages.length]);

  const flipToPreviousPage = useCallback(() => {
    if (canTurnBack) {
      flipBook.current?.pageFlip()?.flipPrev("top");
    }
  }, [canTurnBack]);

  const flipToNextPage = useCallback(() => {
    if (canTurnForward) {
      flipBook.current?.pageFlip()?.flipNext("top");
    }
  }, [canTurnForward]);

  const handleFlip = useCallback(
    (event: PageFlipEvent) => {
      setCurrentPageIndex(normalizePageIndex(event.data, renderedPages.length));
    },
    [renderedPages.length],
  );

  const handleReaderStateChange = useCallback((event: PageFlipEvent) => {
    setReaderState(normalizeReaderState(event.data));
  }, []);

  const handleReaderInit = useCallback(
    (event: PageFlipEvent) => {
      if (isPageFlipInitEvent(event.data)) {
        setCurrentPageIndex(normalizePageIndex(event.data.page, renderedPages.length));
      }
      setReaderState("read");
    },
    [renderedPages.length],
  );

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
      data-reader-engine="react-pageflip"
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
        data-page-flip-library="react-pageflip"
        aria-label={`${preview.title} EPUB preview, ${spreadCount} spreads`}
        ref={bookStage}
      >
        {bookSize ? (
          <FlipBookSurface
            bookKey={flipBookKey}
            ref={flipBook}
            pages={renderedPages}
            size={bookSize}
            onFlip={handleFlip}
            onInit={handleReaderInit}
            onReaderStateChange={handleReaderStateChange}
          />
        ) : null}
      </div>
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

interface BookSize {
  pageHeight: number;
  pageWidth: number;
}

interface FlipBookSurfaceProps {
  bookKey: string;
  pages: readonly RenderablePage[];
  size: BookSize;
  onFlip(event: PageFlipEvent): void;
  onInit(event: PageFlipEvent): void;
  onReaderStateChange(event: PageFlipEvent): void;
}

const FLIP_BOOK_STYLE: CSSProperties = { height: "100%", width: "100%" };

const FlipBookSurface = memo(
  forwardRef<HtmlFlipBookHandle, FlipBookSurfaceProps>(function FlipBookSurface(
    { bookKey, pages, size, onFlip, onInit, onReaderStateChange },
    ref,
  ) {
    return (
      <HTMLFlipBookView
        key={bookKey}
        ref={ref}
        className="page-flip-book"
        style={FLIP_BOOK_STYLE}
        width={size.pageWidth}
        height={size.pageHeight}
        size="fixed"
        minWidth={size.pageWidth}
        maxWidth={size.pageWidth}
        minHeight={size.pageHeight}
        maxHeight={size.pageHeight}
        drawShadow={true}
        flippingTime={PAGE_FLIP_DURATION_MS}
        usePortrait={false}
        startPage={0}
        startZIndex={1}
        autoSize={false}
        maxShadowOpacity={0.36}
        showCover={false}
        mobileScrollSupport={true}
        clickEventForward={true}
        useMouseEvents={true}
        swipeDistance={24}
        showPageCorners={false}
        disableFlipByClick={true}
        renderOnlyPageLengthChange={true}
        onFlip={onFlip}
        onChangeState={onReaderStateChange}
        onInit={onInit}
        onUpdate={onInit}
      >
        {pages.map((page, index) => (
          <ReaderPageView
            key={page.id}
            page={page}
            side={index % 2 === 0 ? "left" : "right"}
          />
        ))}
      </HTMLFlipBookView>
    );
  }),
);

interface RenderablePage {
  bodyHtml: string;
  coverImageSource: string | null;
  id: string;
  kind: EpubPreviewPage["kind"] | "blank";
  pageNumber: number;
  title: string;
}

interface ReaderPageViewProps {
  page: RenderablePage;
  side: "left" | "right";
}

const ReaderPageView = forwardRef<HTMLElement, ReaderPageViewProps>(
  function ReaderPageView({ page, side }, ref) {
    const className = [
      "reader-page",
      side,
      page.kind === "blank" ? "blank" : "",
    ]
      .filter(Boolean)
      .join(" ");

    if (page.kind === "blank") {
      return (
        <article
          className={className}
          data-kind={page.kind}
          data-page-number={page.pageNumber}
          ref={ref}
          aria-hidden="true"
        />
      );
    }

    return (
      <article
        className={className}
        data-kind={page.kind}
        data-page-number={page.pageNumber}
        ref={ref}
        aria-label={`${page.title}, page ${page.pageNumber}`}
        role="document"
      >
        <div className="reader-page-shell">
          <div className="reader-page-content">
            {page.kind === "cover" && page.coverImageSource ? (
              <img
                alt={page.title === "Cover" ? "Book cover" : `${page.title} cover`}
                className="cover-art"
                decoding="async"
                draggable={false}
                src={page.coverImageSource}
              />
            ) : (
              <div dangerouslySetInnerHTML={{ __html: page.bodyHtml }} />
            )}
          </div>
          {page.kind !== "cover" ? (
            <span className="book-page-number">{page.pageNumber}</span>
          ) : null}
        </div>
      </article>
    );
  },
);

function createRenderablePages(pages: readonly EpubPreviewPage[]): RenderablePage[] {
  const rendered: RenderablePage[] = pages.map((page, index) => ({
    ...page,
    coverImageSource: page.kind === "cover" ? coverImageSourceFromHtml(page.bodyHtml) : null,
    pageNumber: index + 1,
  }));
  if (rendered.length % 2 === 1) {
    rendered.push({
      bodyHtml: "",
      coverImageSource: null,
      id: "__blank-final-page",
      kind: "blank",
      pageNumber: rendered.length + 1,
      title: "Blank",
    });
  }
  return rendered;
}

function coverImageSourceFromHtml(html: string): string | null {
  if (typeof document === "undefined") {
    return null;
  }

  const template = document.createElement("template");
  template.innerHTML = html;
  return coverImageSource(template.content);
}

function coverImageSource(content: ParentNode): string | null {
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
    getReaderState(): ReaderState;
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

  return () => {
    host.removeEventListener("mousedown", guardDragStart, { capture: true });
    host.removeEventListener("touchstart", guardDragStart, { capture: true });
  };
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
    getReaderState(): ReaderState;
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

function normalizeReaderState(value: unknown): ReaderState {
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
