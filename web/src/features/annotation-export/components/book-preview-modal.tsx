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

const PAGE_TURN_MS = 440;
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
  const bookStage = useRef<HTMLDivElement>(null);
  const turnTimeout = useRef<number | null>(null);
  const turnRef = useRef<BookTurn | null>(null);
  const dragStart = useRef<{
    corner: TurnCorner;
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
  const isBackwardCornerDisabled =
    !canTurnBack && !(turn?.direction === "backward" && turn.phase === "dragging");
  const isForwardCornerDisabled =
    !canTurnForward && !(turn?.direction === "forward" && turn.phase === "dragging");
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
    turnRef.current = null;
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

  const resolveTurn = useCallback((nextTurn: BookTurn, shouldCommit: boolean) => {
    if (turnTimeout.current) {
      window.clearTimeout(turnTimeout.current);
    }
    turnTimeout.current = window.setTimeout(() => {
      if (shouldCommit) {
        setSpreadIndex(nextTurn.toSpread);
      }
      setTurn(null);
      turnRef.current = null;
      turnTimeout.current = null;
    }, nextTurn.durationMs);
  }, []);

  const animateToSpread = useCallback(
    (direction: TurnDirection, corner: TurnCorner = "top") => {
      const toSpread = direction === "forward" ? spreadIndex + 1 : spreadIndex - 1;
      if (!preview || turn || toSpread < 0 || toSpread >= spreadCount) {
        return;
      }

      const nextTurn = createBookTurn({
        corner,
        direction,
        fromSpread: spreadIndex,
        phase: "completing",
        progress: 0,
        toSpread,
      });
      turnRef.current = nextTurn;
      setTurn(nextTurn);
      resolveTurn(nextTurn, true);
    },
    [preview, resolveTurn, spreadCount, spreadIndex, turn],
  );

  const releaseDraggedTurn = useCallback(
    (progress: number) => {
      const activeTurn = turnRef.current;
      if (!activeTurn || activeTurn.phase !== "dragging") {
        return;
      }

      const shouldCommit = progress >= TURN_COMPLETE_THRESHOLD;
      const nextTurn = createBookTurn({
        ...activeTurn,
        phase: shouldCommit ? "completing" : "cancelling",
        progress,
      });
      turnRef.current = nextTurn;
      setTurn(nextTurn);
      resolveTurn(nextTurn, shouldCommit);
    },
    [resolveTurn],
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
      corner: TurnCorner,
    ) => {
      if ((event.pointerType === "mouse" && event.button !== 0) || turn) {
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
        corner,
        direction,
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      const nextTurn = createBookTurn({
        corner,
        direction,
        fromSpread: spreadIndex,
        phase: "dragging",
        progress: 0,
        toSpread,
      });
      turnRef.current = nextTurn;
      setTurn(nextTurn);
    },
    [canTurnBack, canTurnForward, spreadCount, spreadIndex, turn],
  );

  const handleCornerPointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = dragStart.current;
    if (!start || start.pointerId !== event.pointerId) {
      return;
    }

    const progress = progressForPointer(bookStage.current, start.direction, event.clientX);
    const currentTurn = turnRef.current;
    if (!currentTurn || currentTurn.phase !== "dragging") {
      return;
    }
    const nextTurn = createBookTurn({
      ...currentTurn,
      key: currentTurn.key,
      progress,
    });
    turnRef.current = nextTurn;
    setTurn(nextTurn);
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
      const activeTurn = turnRef.current;
      const currentProgress = activeTurn?.phase === "dragging" ? activeTurn.progress : 0;
      const nextTurn = activeTurn
        ? createBookTurn({
            ...activeTurn,
            phase: "cancelling",
            progress: currentProgress,
          })
        : null;
      if (nextTurn) {
        turnRef.current = nextTurn;
        setTurn(nextTurn);
        resolveTurn(nextTurn, false);
      }
    },
    [resolveTurn],
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
        turnRef.current?.phase === "dragging" ? turnRef.current.progress : 0,
        progressForPointer(bookStage.current, start.direction, event.clientX),
      );
      releaseDraggedTurn(
        pulledForward || pulledBackward || deltaY >= TURN_DRAG_DISTANCE * 1.4
          ? Math.max(progress, TURN_COMPLETE_THRESHOLD)
          : progress,
      );
    },
    [releaseDraggedTurn, turn],
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
      data-turn-state={turn ? "turning" : "read"}
      data-spread-index={spreadIndex}
      style={
        {
          "--page-turn-duration": `${PAGE_TURN_MS}ms`,
          "--reader-font-size": `${16 * fontScale}px`,
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
        aria-label={`${preview.title} EPUB preview, ${spreadCount} spreads`}
        ref={bookStage}
      >
        <div className="book-spread">
          <BookPageSurface page={baseSpread.left} side="left" />
          <BookPageSurface page={baseSpread.right} side="right" />
        </div>
        {turn ? (
          <TurningSheet
            key={turn.key}
            corner={turn.corner}
            direction={turn.direction}
            phase={turn.phase}
            progress={turn.progress}
            durationMs={turn.durationMs}
            front={turn.direction === "forward" ? currentSpread.right : currentSpread.left}
            back={turn.direction === "forward" ? targetSpread.left : targetSpread.right}
          />
        ) : null}
        <button
          className="page-corner forward top"
          type="button"
          aria-label="Top forward page corner"
          disabled={isForwardCornerDisabled}
          onPointerDown={(event) => handleCornerPointerDown(event, "forward", "top")}
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
          disabled={isForwardCornerDisabled}
          onPointerDown={(event) => handleCornerPointerDown(event, "forward", "bottom")}
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
          disabled={isBackwardCornerDisabled}
          onPointerDown={(event) => handleCornerPointerDown(event, "backward", "top")}
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
          disabled={isBackwardCornerDisabled}
          onPointerDown={(event) => handleCornerPointerDown(event, "backward", "bottom")}
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
type TurnCorner = "top" | "bottom";
type TurnPhase = "dragging" | "completing" | "cancelling";

interface BookTurn {
  corner: TurnCorner;
  direction: TurnDirection;
  durationMs: number;
  fromSpread: number;
  key: string;
  phase: TurnPhase;
  progress: number;
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
  corner,
  direction,
  durationMs,
  front,
  back,
  phase,
  progress,
}: {
  corner: TurnCorner;
  direction: TurnDirection;
  durationMs: number;
  front: RenderablePage;
  back: RenderablePage;
  phase: TurnPhase;
  progress: number;
}) {
  return (
    <div
      className={`turning-sheet ${direction}`}
      data-corner={corner}
      data-turn-direction={direction}
      data-turn-phase={phase}
      data-turn-progress={progress.toFixed(3)}
      data-front-page={front.pageNumber}
      data-back-page={back.pageNumber}
      style={
        {
          "--turn-duration": `${durationMs}ms`,
          "--turn-from-angle": `${turnAngle(direction, progress)}deg`,
          "--turn-progress": progress.toFixed(3),
          "--turn-skew": `${turnSkew(direction, corner, progress)}deg`,
          "--turn-to-angle": `${phase === "cancelling" ? 0 : turnAngle(direction, 1)}deg`,
        } as CSSProperties
      }
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

function createBookTurn({
  corner,
  direction,
  fromSpread,
  key,
  phase,
  progress,
  toSpread,
}: Omit<BookTurn, "durationMs" | "key"> & { key?: string }): BookTurn {
  return {
    corner,
    direction,
    durationMs: turnDuration(phase, progress),
    fromSpread,
    key: key || `${direction}-${phase}-${fromSpread}-${toSpread}-${Date.now()}`,
    phase,
    progress,
    toSpread,
  };
}

function progressForPointer(
  element: HTMLElement | null,
  direction: TurnDirection,
  clientX: number,
): number {
  if (!element) {
    return 0;
  }
  const rect = element.getBoundingClientRect();
  const travel = rect.width * 0.46;
  if (direction === "forward") {
    return clamp((rect.right - clientX) / travel, 0, 0.98);
  }
  return clamp((clientX - rect.left) / travel, 0, 0.98);
}

function turnAngle(direction: TurnDirection, progress: number): number {
  return (direction === "forward" ? -1 : 1) * 178 * clamp(progress, 0, 1);
}

function turnSkew(direction: TurnDirection, corner: TurnCorner, progress: number): number {
  const directionSign = direction === "forward" ? -1 : 1;
  const cornerSign = corner === "top" ? -1 : 1;
  return directionSign * cornerSign * Math.sin(progress * Math.PI) * 3.4;
}

function turnDuration(phase: TurnPhase, progress: number): number {
  if (phase === "dragging") {
    return 0;
  }
  const remaining = phase === "cancelling" ? progress : 1 - progress;
  return Math.round(clamp(160 + remaining * 210, 160, PAGE_TURN_MS));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
