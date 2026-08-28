import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

import type { GeneratedEpub, ReaderBook } from "../../../domain/readers.js";
import {
  parseGeneratedEpubPreview,
  type EpubPreviewPage,
} from "../epub-preview.js";

const PAGE_TURN_MS = 760;
const TURN_DRAG_DISTANCE = 38;

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
  const turnTimeout = useRef<number | null>(null);
  const dragStart = useRef<{
    direction: TurnDirection;
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);
  const [spreadIndex, setSpreadIndex] = useState(0);
  const [turn, setTurn] = useState<BookTurn | null>(null);
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
  const visibleSpreadIndex = turn?.fromSpread ?? spreadIndex;
  const canTurnBack = !turn && spreadIndex > 0;
  const canTurnForward = !turn && spreadIndex < spreadCount - 1;
  const progressStart = Math.min(spreadIndex * 2 + 1, pageCount);
  const progressEnd = Math.min(spreadIndex * 2 + 2, pageCount);
  const currentSpread = getSpread(renderedPages, visibleSpreadIndex);
  const targetSpread = turn ? getSpread(renderedPages, turn.toSpread) : currentSpread;
  const baseSpread = turn
    ? {
        left: turn.direction === "backward" ? targetSpread.left : currentSpread.left,
        right: turn.direction === "forward" ? targetSpread.right : currentSpread.right,
      }
    : currentSpread;

  useEffect(() => {
    setSpreadIndex(0);
    setTurn(null);
    if (turnTimeout.current) {
      window.clearTimeout(turnTimeout.current);
      turnTimeout.current = null;
    }
  }, [book.id, epub]);

  useEffect(() => {
    return () => {
      if (turnTimeout.current) {
        window.clearTimeout(turnTimeout.current);
        turnTimeout.current = null;
      }
    };
  }, []);

  const turnToSpread = useCallback(
    (direction: TurnDirection) => {
      const toSpread = direction === "forward" ? spreadIndex + 1 : spreadIndex - 1;
      if (!preview || turn || toSpread < 0 || toSpread >= spreadCount) {
        return;
      }

      if (turnTimeout.current) {
        window.clearTimeout(turnTimeout.current);
      }

      setTurn({
        direction,
        fromSpread: spreadIndex,
        key: `${direction}-${spreadIndex}-${toSpread}-${Date.now()}`,
        toSpread,
      });

      turnTimeout.current = window.setTimeout(() => {
        setSpreadIndex(toSpread);
        setTurn(null);
        turnTimeout.current = null;
      }, PAGE_TURN_MS);
    },
    [preview, spreadCount, spreadIndex, turn],
  );

  useEffect(() => {
    if (!preview || spreadCount <= 1) {
      return undefined;
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
        return;
      }
      event.preventDefault();
      if (event.key === "ArrowRight") {
        turnToSpread("forward");
      } else {
        turnToSpread("backward");
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [preview, spreadCount, turnToSpread]);

  const handleCornerPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, direction: TurnDirection) => {
      if ((event.pointerType === "mouse" && event.button !== 0) || turn) {
        return;
      }
      if (direction === "forward" && !canTurnForward) {
        return;
      }
      if (direction === "backward" && !canTurnBack) {
        return;
      }

      dragStart.current = {
        direction,
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [canTurnBack, canTurnForward, turn],
  );

  const handleCornerPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const start = dragStart.current;
      if (!start || start.pointerId !== event.pointerId) {
        return;
      }

      dragStart.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      const deltaX = event.clientX - start.x;
      const deltaY = Math.abs(event.clientY - start.y);
      const pulledForward = start.direction === "forward" && deltaX <= -TURN_DRAG_DISTANCE;
      const pulledBackward = start.direction === "backward" && deltaX >= TURN_DRAG_DISTANCE;
      if (pulledForward || pulledBackward || deltaY >= TURN_DRAG_DISTANCE * 1.4) {
        turnToSpread(start.direction);
      }
    },
    [turnToSpread],
  );

  const handleCornerPointerCancel = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragStart.current?.pointerId === event.pointerId) {
      dragStart.current = null;
    }
  }, []);

  const handleCornerKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>, direction: TurnDirection) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      turnToSpread(direction);
    },
    [turnToSpread],
  );

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
      data-reader-engine="react-spread"
      data-turn-state={turn ? "turning" : "read"}
      data-spread-index={spreadIndex}
      style={{ "--reader-font-size": `${16 * fontScale}px` } as CSSProperties}
    >
      <button
        className="spread-turn previous"
        type="button"
        aria-label="Previous page"
        onClick={() => turnToSpread("backward")}
        disabled={!canTurnBack}
      >
        <ChevronLeft size={26} aria-hidden="true" />
      </button>
      <div
        className="book-stage"
        aria-label={`${preview.title} EPUB preview, ${spreadCount} spreads`}
      >
        <div className="book-spread">
          <BookPageSurface page={baseSpread.left} side="left" />
          <BookPageSurface page={baseSpread.right} side="right" />
        </div>
        {turn ? (
          <TurningSheet
            key={turn.key}
            direction={turn.direction}
            front={turn.direction === "forward" ? currentSpread.right : currentSpread.left}
            back={turn.direction === "forward" ? targetSpread.left : targetSpread.right}
          />
        ) : null}
        <button
          className="page-corner forward top"
          type="button"
          aria-label="Top forward page corner"
          disabled={!canTurnForward}
          onPointerDown={(event) => handleCornerPointerDown(event, "forward")}
          onPointerUp={handleCornerPointerUp}
          onPointerCancel={handleCornerPointerCancel}
          onKeyDown={(event) => handleCornerKeyDown(event, "forward")}
        />
        <button
          className="page-corner forward bottom"
          type="button"
          aria-label="Bottom forward page corner"
          disabled={!canTurnForward}
          onPointerDown={(event) => handleCornerPointerDown(event, "forward")}
          onPointerUp={handleCornerPointerUp}
          onPointerCancel={handleCornerPointerCancel}
          onKeyDown={(event) => handleCornerKeyDown(event, "forward")}
        />
        <button
          className="page-corner backward top"
          type="button"
          aria-label="Top backward page corner"
          disabled={!canTurnBack}
          onPointerDown={(event) => handleCornerPointerDown(event, "backward")}
          onPointerUp={handleCornerPointerUp}
          onPointerCancel={handleCornerPointerCancel}
          onKeyDown={(event) => handleCornerKeyDown(event, "backward")}
        />
        <button
          className="page-corner backward bottom"
          type="button"
          aria-label="Bottom backward page corner"
          disabled={!canTurnBack}
          onPointerDown={(event) => handleCornerPointerDown(event, "backward")}
          onPointerUp={handleCornerPointerUp}
          onPointerCancel={handleCornerPointerCancel}
          onKeyDown={(event) => handleCornerKeyDown(event, "backward")}
        />
      </div>
      <button
        className="spread-turn next"
        type="button"
        aria-label="Next page"
        onClick={() => turnToSpread("forward")}
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

type TurnDirection = "forward" | "backward";

interface BookTurn {
  direction: TurnDirection;
  fromSpread: number;
  key: string;
  toSpread: number;
}

interface RenderablePage {
  bodyHtml: string;
  id: string;
  kind: EpubPreviewPage["kind"] | "blank";
  pageNumber: number;
  title: string;
}

function TurningSheet({
  direction,
  front,
  back,
}: {
  direction: TurnDirection;
  front: RenderablePage;
  back: RenderablePage;
}) {
  return (
    <div
      className={`turning-sheet ${direction}`}
      data-turn-direction={direction}
      data-front-page={front.pageNumber}
      data-back-page={back.pageNumber}
      aria-hidden="true"
    >
      <div className="turning-sheet-face front">
        <BookPageSurface page={front} side={direction === "forward" ? "right" : "left"} />
      </div>
      <div className="turning-sheet-face back">
        <BookPageSurface page={back} side={direction === "forward" ? "left" : "right"} />
      </div>
    </div>
  );
}

function BookPageSurface({ page, side }: { page: RenderablePage; side: "left" | "right" }) {
  const isBlank = page.kind === "blank";
  return (
    <article
      className={`reader-page ${side}${isBlank ? " blank" : ""}`}
      data-kind={page.kind}
      data-page-number={page.pageNumber}
      role={isBlank ? undefined : "document"}
      aria-hidden={isBlank || undefined}
      aria-label={isBlank ? undefined : `${page.title}, page ${page.pageNumber}`}
    >
      {isBlank ? null : (
        <div
          className="reader-page-content"
          dangerouslySetInnerHTML={{ __html: page.bodyHtml }}
        />
      )}
      {isBlank ? null : <span className="book-page-number">{page.pageNumber}</span>}
    </article>
  );
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

function getSpread(pages: readonly RenderablePage[], spreadIndex: number) {
  const fallback = pages[0] || {
    bodyHtml: "",
    id: "__blank-page",
    kind: "blank" as const,
    pageNumber: 1,
    title: "Blank",
  };
  return {
    left: pages[spreadIndex * 2] || fallback,
    right: pages[spreadIndex * 2 + 1] || fallback,
  };
}
