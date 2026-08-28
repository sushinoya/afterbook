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

const SPREAD_TRANSITION_MS = 220;
const TURN_DRAG_DISTANCE = 38;
const TURN_COMPLETE_THRESHOLD = 0.34;

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
  const transitionTimeout = useRef<number | null>(null);
  const dragStart = useRef<{
    direction: TurnDirection;
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);
  const [spreadIndex, setSpreadIndex] = useState(0);
  const [transition, setTransition] = useState<SpreadTransition | null>(null);
  const [dragCue, setDragCue] = useState<ReaderDragCue | null>(null);
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
  const canTurnBack = !transition && spreadIndex > 0;
  const canTurnForward = !transition && spreadIndex < spreadCount - 1;
  const progressStart = Math.min(spreadIndex * 2 + 1, pageCount);
  const progressEnd = Math.min(spreadIndex * 2 + 2, pageCount);
  const currentSpread = getSpread(renderedPages, spreadIndex);
  const targetSpread = transition ? getSpread(renderedPages, transition.toSpread) : null;
  const readerState = transition ? "transitioning" : dragCue ? "dragging" : "read";

  useEffect(() => {
    setSpreadIndex(0);
    setTransition(null);
    setDragCue(null);
    if (transitionTimeout.current) {
      window.clearTimeout(transitionTimeout.current);
      transitionTimeout.current = null;
    }
  }, [book.id, epub]);

  useEffect(() => {
    return () => {
      if (transitionTimeout.current) {
        window.clearTimeout(transitionTimeout.current);
        transitionTimeout.current = null;
      }
    };
  }, []);

  const animateToSpread = useCallback(
    (direction: TurnDirection) => {
      const toSpread = direction === "forward" ? spreadIndex + 1 : spreadIndex - 1;
      if (!preview || transition || toSpread < 0 || toSpread >= spreadCount) {
        return;
      }

      if (transitionTimeout.current) {
        window.clearTimeout(transitionTimeout.current);
      }

      const nextTransition = createSpreadTransition({
        direction,
        fromSpread: spreadIndex,
        toSpread,
      });
      setDragCue(null);
      setTransition(nextTransition);
      transitionTimeout.current = window.setTimeout(() => {
        setSpreadIndex(toSpread);
        setTransition(null);
        transitionTimeout.current = null;
      }, SPREAD_TRANSITION_MS);
    },
    [preview, spreadCount, spreadIndex, transition],
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
        animateToSpread("forward");
      } else {
        animateToSpread("backward");
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [animateToSpread, preview, spreadCount]);

  const handleCornerPointerDown = useCallback(
    (
      event: ReactPointerEvent<HTMLButtonElement>,
      direction: TurnDirection,
    ) => {
      if ((event.pointerType === "mouse" && event.button !== 0) || transition) {
        return;
      }
      if (direction === "forward" && !canTurnForward) {
        return;
      }
      if (direction === "backward" && !canTurnBack) {
        return;
      }

      const toSpread = direction === "forward" ? spreadIndex + 1 : spreadIndex - 1;
      if (toSpread < 0 || toSpread >= spreadCount) {
        return;
      }

      dragStart.current = {
        direction,
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragCue({ direction, progress: 0 });
    },
    [canTurnBack, canTurnForward, spreadCount, spreadIndex, transition],
  );

  const handleCornerPointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = dragStart.current;
    if (!start || start.pointerId !== event.pointerId) {
      return;
    }

    const progress = progressForPointer(start.direction, start.x, event.clientX);
    setDragCue({ direction: start.direction, progress });
  }, []);

  const handleCornerPointerLeave = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = dragStart.current;
    if (start?.pointerId === event.pointerId) {
      handleCornerPointerMove(event);
    }
  }, [handleCornerPointerMove]);

  const cancelDraggedTurn = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const start = dragStart.current;
      if (!start || start.pointerId !== event.pointerId) {
        return;
      }

      dragStart.current = null;
      setDragCue(null);
    },
    [],
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
      const progress = Math.max(
        dragCue?.progress || 0,
        progressForPointer(start.direction, start.x, event.clientX),
      );
      setDragCue(null);
      if (
        pulledForward ||
        pulledBackward ||
        deltaY >= TURN_DRAG_DISTANCE * 1.4 ||
        progress >= TURN_COMPLETE_THRESHOLD
      ) {
        animateToSpread(start.direction);
      }
    },
    [animateToSpread, dragCue],
  );

  const handleCornerPointerCancel = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    cancelDraggedTurn(event);
  }, [cancelDraggedTurn]);

  const handleCornerKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>, direction: TurnDirection) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      animateToSpread(direction);
    },
    [animateToSpread],
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
      data-reader-state={readerState}
      data-spread-index={spreadIndex}
      data-drag-direction={dragCue?.direction || undefined}
      data-drag-progress={dragCue ? dragCue.progress.toFixed(3) : undefined}
      style={
        {
          "--reader-drag-shift": `${dragCue ? dragShift(dragCue) : 0}px`,
          "--reader-font-size": `${16 * fontScale}px`,
          "--spread-transition-duration": `${SPREAD_TRANSITION_MS}ms`,
        } as CSSProperties
      }
    >
      <button
        className="spread-turn previous"
        type="button"
        aria-label="Previous page"
        onClick={() => animateToSpread("backward")}
        disabled={!canTurnBack}
      >
        <ChevronLeft size={26} aria-hidden="true" />
      </button>
      <div
        className="book-stage"
        data-transition-direction={transition?.direction || undefined}
        aria-label={`${preview.title} EPUB preview, ${spreadCount} spreads`}
      >
        <div className="book-spread current" data-transition-layer="current">
          <BookPageSurface page={currentSpread.left} side="left" />
          <BookPageSurface page={currentSpread.right} side="right" />
        </div>
        {transition && targetSpread ? (
          <div
            className={`book-spread incoming ${transition.direction}`}
            data-transition-layer="incoming"
            data-transition-direction={transition.direction}
          >
            <BookPageSurface page={targetSpread.left} side="left" />
            <BookPageSurface page={targetSpread.right} side="right" />
          </div>
        ) : null}
        <button
          className="page-corner forward top"
          type="button"
          aria-label="Top forward page corner"
          disabled={!canTurnForward}
          onPointerDown={(event) => handleCornerPointerDown(event, "forward")}
          onPointerMove={handleCornerPointerMove}
          onPointerLeave={handleCornerPointerLeave}
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
          onPointerMove={handleCornerPointerMove}
          onPointerLeave={handleCornerPointerLeave}
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
          onPointerMove={handleCornerPointerMove}
          onPointerLeave={handleCornerPointerLeave}
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
          onPointerMove={handleCornerPointerMove}
          onPointerLeave={handleCornerPointerLeave}
          onPointerUp={handleCornerPointerUp}
          onPointerCancel={handleCornerPointerCancel}
          onKeyDown={(event) => handleCornerKeyDown(event, "backward")}
        />
      </div>
      <button
        className="spread-turn next"
        type="button"
        aria-label="Next page"
        onClick={() => animateToSpread("forward")}
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

interface ReaderDragCue {
  direction: TurnDirection;
  progress: number;
}

interface SpreadTransition {
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

function createSpreadTransition({
  direction,
  fromSpread,
  toSpread,
}: Omit<SpreadTransition, "key">): SpreadTransition {
  return {
    direction,
    fromSpread,
    key: `${direction}-${fromSpread}-${toSpread}-${Date.now()}`,
    toSpread,
  };
}

function progressForPointer(direction: TurnDirection, startX: number, clientX: number): number {
  const travel = 180;
  if (direction === "forward") {
    return clamp((startX - clientX) / travel, 0, 1);
  }
  return clamp((clientX - startX) / travel, 0, 1);
}

function dragShift(drag: ReaderDragCue): number {
  const direction = drag.direction === "forward" ? -1 : 1;
  return direction * clamp(drag.progress, 0, 1) * 12;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
