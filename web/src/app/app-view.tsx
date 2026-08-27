import {
  BookOpen,
  BookOpenCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FolderOpen,
  HardDrive,
  LibraryBig,
  Loader2,
  Lock,
  PlugZap,
  ShieldCheck,
  X,
} from "lucide-react";
import * as pageFlipModule from "page-flip";
import type { PageFlip as PageFlipInstance, PageFlipState } from "page-flip";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import type { GeneratedEpub, ReaderBook, ReaderDefinition } from "../domain/readers.js";
import {
  type AnnotationExportViewModel,
  useAnnotationExport,
} from "../features/annotation-export/use-annotation-export.js";
import {
  parseGeneratedEpubPreview,
  type EpubPreviewPage,
} from "../features/annotation-export/epub-preview.js";
import { createReaderRegistry } from "../infrastructure/readers/reader-registry.js";

const PageFlip = pageFlipModule.PageFlip ?? pageFlipModule.default?.PageFlip;

export function AppView() {
  const readers = useMemo(() => createReaderRegistry(), []);
  const model = useAnnotationExport(readers);
  const [hasStarted, setHasStarted] = useState(false);
  const selectedReader =
    readers.find((reader) => reader.id === model.selectedReaderId) || readers[0];
  const isConnected = Boolean(model.connection);

  if (!hasStarted) {
    return <WelcomeScreen onStart={() => setHasStarted(true)} />;
  }

  return (
    <div className="reader-app">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            A
          </div>
          <div>
            <h1>AfterBook</h1>
            <p>Your highlights, gathered quietly.</p>
          </div>
        </div>
        <StatusIndicator phase={model.phase} message={model.statusMessage} />
      </header>

      <main className="reader-workspace" id="annotation-export">
        {isConnected ? (
          <ConnectedLibrary model={model} />
        ) : (
          <ConnectionWizard
            model={model}
            readers={readers}
            selectedReader={selectedReader}
          />
        )}
      </main>

      {model.selectedBook ? (
        <BookModal
          book={model.selectedBook}
          epub={model.selectedEpub}
          isLoading={model.isLoadingSelectedBook}
          isExporting={model.phase === "exporting"}
          isActiveExport={model.activeBookId === model.selectedBook.id}
          onClose={model.closeBook}
          onExport={model.exportBook}
        />
      ) : null}
    </div>
  );
}

function WelcomeScreen({ onStart }: { onStart(): void }) {
  return (
    <main className="welcome-screen">
      <section className="welcome-copy" aria-labelledby="welcome-title">
        <p className="eyebrow">Private reader companion</p>
        <h1 id="welcome-title">AfterBook.</h1>
        <p className="welcome-lede">
          A quieter home for the passages you kept. Connect your reader, gather
          your annotated books, and turn your highlights into a lasting EPUB.
        </p>
        <div className="welcome-actions">
          <button className="primary-button large" type="button" onClick={onStart}>
            <BookOpen size={19} aria-hidden="true" />
            Get started
          </button>
          <div className="privacy-note">
            <Lock size={16} aria-hidden="true" />
            Local and read-only
          </div>
        </div>
      </section>
    </main>
  );
}

function StatusIndicator({ phase, message }: { phase: string; message: string }) {
  const busy =
    phase === "connecting" ||
    phase === "cataloging" ||
    phase === "opening-book" ||
    phase === "exporting";
  return (
    <div className="status-pill" data-phase={phase} role="status" aria-live="polite">
      {busy ? (
        <Loader2 className="spin" size={16} aria-hidden="true" />
      ) : (
        <Check size={16} aria-hidden="true" />
      )}
      {message}
    </div>
  );
}

function ConnectionWizard({
  model,
  readers,
  selectedReader,
}: {
  model: AnnotationExportViewModel;
  readers: readonly ReaderDefinition[];
  selectedReader: ReaderDefinition | undefined;
}) {
  const [step, setStep] = useState(0);
  const busy = isReaderBusy(model.phase);
  const currentStep = CONNECTION_STEPS[step] || CONNECTION_STEPS[0];

  return (
    <section className="connection-wizard" aria-labelledby="setup-title">
      <div className="wizard-progress" aria-label="Connection progress">
        {CONNECTION_STEPS.map((connectionStep, index) => (
          <span
            key={connectionStep.title}
            data-state={index < step ? "done" : index === step ? "active" : "idle"}
          />
        ))}
      </div>

      <div className="wizard-page">
        <div className="wizard-icon" aria-hidden="true">
          {currentStep.icon}
        </div>
        <p className="eyebrow">
          Step {step + 1} of {CONNECTION_STEPS.length}
        </p>
        <h2 id="setup-title">{currentStep.title}</h2>
        <p>{currentStep.description}</p>
      </div>

      {step === 1 ? (
        <div className="reader-picker" aria-label="Reader source">
          {readers.map((reader) => (
            <button
              className="reader-chip"
              data-selected={reader.id === model.selectedReaderId}
              type="button"
              key={reader.id}
              onClick={() => model.selectReader(reader.id)}
            >
              <BookOpenCheck size={16} aria-hidden="true" />
              <span>{reader.name}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="wizard-actions">
        {step === 1 ? (
          <button
            className="secondary-button"
            type="button"
            onClick={() => setStep(0)}
            disabled={busy}
          >
            Back
          </button>
        ) : null}
        <div className="connection-detail">
          <ShieldCheck size={17} aria-hidden="true" />
          <span>{model.connection?.label || selectedReader?.connectionLabel}</span>
        </div>
        {step === 0 ? (
          <button className="primary-button" type="button" onClick={() => setStep(1)}>
            Continue
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        ) : (
          <button
            className="primary-button"
            type="button"
            onClick={model.connectReader}
            disabled={busy}
          >
            {busy ? (
              <Loader2 className="spin" size={18} aria-hidden="true" />
            ) : (
              <PlugZap size={18} aria-hidden="true" />
            )}
            Connect Reader
          </button>
        )}
      </div>
    </section>
  );
}

const CONNECTION_STEPS = [
  {
    title: "Connect your e-reader",
    description:
      "Plug in your e-reader and choose the option that lets this computer access its files.",
    icon: <HardDrive size={30} aria-hidden="true" />,
  },
  {
    title: "Choose your e-reader",
    description:
      "When the browser prompt opens, select your e-reader from the sidebar or choose its drive.",
    icon: <FolderOpen size={30} aria-hidden="true" />,
  },
] as const;

function ConnectedLibrary({ model }: { model: AnnotationExportViewModel }) {
  return (
    <>
      <section className="connected-banner" aria-labelledby="connected-title">
        <div className="connected-icon" aria-hidden="true">
          <Check size={24} />
        </div>
        <div>
          <p className="eyebrow">Connected</p>
          <h2 id="connected-title">{model.connection?.label || "Reader connected"}</h2>
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={model.connectReader}
          disabled={isReaderBusy(model.phase)}
        >
          <PlugZap size={17} aria-hidden="true" />
          Refresh Reader
        </button>
      </section>
      <LibraryView
        books={model.books}
        coverUrls={model.coverUrls}
        onOpenBook={model.openBook}
      />
    </>
  );
}

function LibraryView({
  books,
  coverUrls,
  onOpenBook,
}: {
  books: readonly ReaderBook[];
  coverUrls: ReadonlyMap<string, string>;
  onOpenBook(book: ReaderBook): void;
}) {
  return (
    <section className="library-section" aria-labelledby="library-title">
      <div className="section-intro library-header">
        <div>
          <p className="eyebrow">Library</p>
          <h2 id="library-title">Annotated books</h2>
        </div>
        <div className="library-metrics" aria-label="Library totals">
          <Metric label="Books" value={books.length} />
          <Metric label="Highlights" value={sum(books, (book) => book.metrics.highlights)} />
          <Metric label="Notes" value={sum(books, (book) => book.metrics.notes)} />
        </div>
      </div>

      {books.length > 0 ? (
        <div className="book-grid">
          {books.map((book) => (
            <button
              className="book-card"
              type="button"
              key={book.id}
              onClick={() => onOpenBook(book)}
              aria-label={`Open ${book.title}`}
            >
              <BookCover book={book} coverUrl={coverUrls.get(book.id)} size="large" />
              <span className="book-card-title">{book.title}</span>
              {book.author ? <span className="book-card-author">{book.author}</span> : null}
            </button>
          ))}
        </div>
      ) : (
        <div className="library-empty">
          <LibraryBig size={26} aria-hidden="true" />
          <strong>No annotated books found.</strong>
          <span>Choose a different reader if you expected to see saved highlights.</span>
        </div>
      )}
    </section>
  );
}

function BookModal({
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
    function handleKeyDown(event: KeyboardEvent) {
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
  const bookHost = useRef<HTMLDivElement>(null);
  const pageFlip = useRef<PageFlipInstance | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [flipState, setFlipState] = useState<PageFlipState>("read");
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
  const renderedPageCount = pageCount + (pageCount % 2);
  const spreadCount = Math.max(1, Math.ceil(renderedPageCount / 2));
  const canTurnBack = currentPage > 0;
  const canTurnForward = currentPage < Math.max(0, renderedPageCount - 2);

  useEffect(() => {
    setCurrentPage(0);
    setFlipState("read");
  }, [book.id, epub]);

  useEffect(() => {
    const host = bookHost.current;
    if (!preview || !host) {
      return undefined;
    }
    if (!PageFlip) {
      throw new Error("The page-flip reader engine could not be loaded.");
    }

    host.replaceChildren();

    const bookElement = document.createElement("div");
    bookElement.className = "page-flip-book";
    bookElement.setAttribute(
      "aria-label",
      `${preview.title} EPUB preview, ${spreadCount} spreads`,
    );
    host.appendChild(bookElement);

    const pageElements = preview.pages.map((page, index) =>
      createFlipBookPage(page, index, pageCount),
    );

    if (pageElements.length % 2 === 1) {
      pageElements.push(createBlankFlipBookPage(pageElements.length + 1));
    }

    pageElements.forEach((pageElement) => bookElement.appendChild(pageElement));

    const engine = new PageFlip(bookElement, {
      width: 440,
      height: 640,
      size: "stretch",
      minWidth: 190,
      maxWidth: 560,
      minHeight: 280,
      maxHeight: 760,
      autoSize: false,
      drawShadow: true,
      flippingTime: 900,
      maxShadowOpacity: 0.45,
      mobileScrollSupport: false,
      showCover: false,
      usePortrait: false,
      disableFlipByClick: true,
    });

    pageFlip.current = engine;
    engine.on("init", (event) => {
      setCurrentPage(event.data.page);
    });
    engine.on("flip", (event) => {
      setCurrentPage(event.data);
    });
    engine.on("changeState", (event) => {
      setFlipState(event.data);
    });
    engine.loadFromHTML(pageElements);

    return () => {
      pageFlip.current = null;
      try {
        engine.destroy();
      } finally {
        host.replaceChildren();
      }
    };
  }, [pageCount, preview, spreadCount]);

  useEffect(() => {
    if (!preview || spreadCount <= 1) {
      return undefined;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
        return;
      }
      event.preventDefault();
      if (event.key === "ArrowRight") {
        pageFlip.current?.flipNext("top");
      } else {
        pageFlip.current?.flipPrev("top");
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [preview, spreadCount]);

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
      data-flip-engine="page-flip"
      data-flip-state={flipState}
      style={{ "--reader-font-size": `${16 * fontScale}px` } as CSSProperties}
    >
      <button
        className="spread-turn previous"
        type="button"
        aria-label="Previous page"
        onClick={() => pageFlip.current?.flipPrev("top")}
        disabled={!canTurnBack}
      >
        <ChevronLeft size={26} aria-hidden="true" />
      </button>
      <div className="page-flip-shell">
        <div className="page-flip-host" ref={bookHost} />
      </div>
      <button
        className="spread-turn next"
        type="button"
        aria-label="Next page"
        onClick={() => pageFlip.current?.flipNext("top")}
        disabled={!canTurnForward}
      >
        <ChevronRight size={26} aria-hidden="true" />
      </button>
      <p className="book-progress" aria-live="polite">
        Page {Math.min(currentPage + 1, pageCount)} of {pageCount}
      </p>
    </div>
  );
}

function createFlipBookPage(
  page: EpubPreviewPage,
  index: number,
  pageCount: number,
) {
  const pageElement = document.createElement("article");
  pageElement.className = "flip-book-page";
  pageElement.dataset.kind = page.kind;
  if (page.kind === "cover") {
    pageElement.dataset.density = "hard";
  }
  pageElement.setAttribute("role", "document");
  pageElement.setAttribute(
    "aria-label",
    `${page.title}, page ${index + 1} of ${pageCount}`,
  );
  pageElement.innerHTML = `
    <div class="epub-page-content">${page.bodyHtml}</div>
    <span class="book-page-number">${index + 1}</span>
  `;
  return pageElement;
}

function createBlankFlipBookPage(pageNumber: number) {
  const pageElement = document.createElement("article");
  pageElement.className = "flip-book-page blank";
  pageElement.setAttribute("aria-hidden", "true");
  pageElement.innerHTML = `<span class="book-page-number">${pageNumber}</span>`;
  return pageElement;
}

function BookCover({
  book,
  coverUrl,
  size,
}: {
  book: ReaderBook;
  coverUrl: string | undefined;
  size: "large";
}) {
  const [hasImageError, setHasImageError] = useState(false);

  useEffect(() => {
    setHasImageError(false);
  }, [coverUrl]);

  return coverUrl && !hasImageError ? (
    <img
      className={`book-cover ${size}`}
      src={coverUrl}
      alt={`${book.title} cover`}
      onError={() => setHasImageError(true)}
    />
  ) : (
    <div className={`book-cover placeholder ${size}`} aria-label={`${book.title} cover`}>
      <BookOpen size={26} aria-hidden="true" />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function isReaderBusy(phase: string) {
  return phase === "connecting" || phase === "cataloging";
}

function sum(books: readonly ReaderBook[], selector: (book: ReaderBook) => number) {
  return books.reduce((total, book) => total + selector(book), 0);
}
