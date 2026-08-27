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
import { useEffect, useMemo, useRef, useState } from "react";

import type { GeneratedEpub, ReaderBook, ReaderDefinition } from "../domain/readers.js";
import {
  type AnnotationExportViewModel,
  useAnnotationExport,
} from "../features/annotation-export/use-annotation-export.js";
import { parseGeneratedEpubPreview } from "../features/annotation-export/epub-preview.js";
import { createReaderRegistry } from "../infrastructure/readers/reader-registry.js";

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
            <h1>Afterbook</h1>
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
          coverUrl={model.coverUrls.get(model.selectedBook.id)}
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
        <p className="eyebrow">Afterbook</p>
        <h1 id="welcome-title">Bring your highlights home.</h1>
        <p className="welcome-lede">
          A calm space for gathering the notes and passages you saved while reading.
          Connect your reader, review your annotated books, then export a lasting EPUB
          when you are ready.
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

      <section className="reading-room" aria-label="Reading room preview">
        <div className="window-pane" aria-hidden="true" />
        <div className="desk">
          <div className="open-book">
            <span />
            <span />
          </div>
          <div className="book-stack">
            <span />
            <span />
            <span />
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
    title: "Connect your device",
    description:
      "Plug in your e-reader and choose file transfer or mount mode if the device asks.",
    icon: <HardDrive size={30} aria-hidden="true" />,
  },
  {
    title: "Select the reader folder",
    description:
      "When the browser picker opens, choose the reader drive or mounted folder.",
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
          <span>Try another reader folder if you expected to see saved highlights.</span>
        </div>
      )}
    </section>
  );
}

function BookModal({
  book,
  epub,
  coverUrl,
  isLoading,
  isExporting,
  isActiveExport,
  onClose,
  onExport,
}: {
  book: ReaderBook;
  epub: GeneratedEpub | null;
  coverUrl: string | undefined;
  isLoading: boolean;
  isExporting: boolean;
  isActiveExport: boolean;
  onClose(): void;
  onExport(book: ReaderBook): void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);

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
        <button
          className="icon-button close-button"
          type="button"
          aria-label="Close book"
          onClick={onClose}
          ref={closeButton}
        >
          <X size={20} aria-hidden="true" />
        </button>

        <header className="modal-book-header">
          <BookCover book={book} coverUrl={coverUrl} size="hero" />
          <div className="modal-title-block">
            <p className="eyebrow">{book.readerId}</p>
            <h2 id="book-dialog-title">{book.title}</h2>
            {book.author ? <p className="modal-author">{book.author}</p> : null}
            <div className="annotation-counts">
              <span>{book.metrics.highlights} highlights</span>
              <span>{book.metrics.notes} notes</span>
            </div>
          </div>
          <button
            className="secondary-button"
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
        </header>

        <EpubBookReader book={book} epub={epub} isLoading={isLoading} />
      </section>
    </div>
  );
}

function EpubBookReader({
  book,
  epub,
  isLoading,
}: {
  book: ReaderBook;
  epub: GeneratedEpub | null;
  isLoading: boolean;
}) {
  const [pageIndex, setPageIndex] = useState(0);
  const [turnDirection, setTurnDirection] = useState<"idle" | "forward" | "back">("idle");
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
  const activePage = preview?.pages[pageIndex] || null;

  useEffect(() => {
    setPageIndex(0);
    setTurnDirection("idle");
  }, [book.id, epub]);

  useEffect(() => {
    if (!preview || pageCount <= 1) {
      return undefined;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
        return;
      }
      event.preventDefault();
      const nextIndex =
        event.key === "ArrowRight"
          ? Math.min(pageCount - 1, pageIndex + 1)
          : Math.max(0, pageIndex - 1);
      if (nextIndex !== pageIndex) {
        setTurnDirection(nextIndex > pageIndex ? "forward" : "back");
        setPageIndex(nextIndex);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pageCount, pageIndex, preview]);

  function turnTo(nextIndex: number) {
    if (nextIndex === pageIndex || nextIndex < 0 || nextIndex >= pageCount) {
      return;
    }
    setTurnDirection(nextIndex > pageIndex ? "forward" : "back");
    setPageIndex(nextIndex);
  }

  if (isLoading) {
    return (
      <div className="epub-reader-empty">
        <Loader2 className="spin" size={22} aria-hidden="true" />
        <span>Preparing EPUB preview.</span>
      </div>
    );
  }

  if (!preview || !activePage) {
    return (
      <div className="epub-reader-empty">
        <BookOpen size={22} aria-hidden="true" />
        <span>{previewState.error || "Could not render this EPUB preview."}</span>
      </div>
    );
  }

  return (
    <div className="epub-reader" data-turn={turnDirection}>
      <div className="epub-toolbar">
        <div className="epub-page-status">
          <span>
            Page {pageIndex + 1} of {pageCount}
          </span>
          <strong>{activePage.title}</strong>
        </div>
        <div className="epub-controls">
          <button
            className="icon-button"
            type="button"
            aria-label="Previous EPUB page"
            onClick={() => turnTo(pageIndex - 1)}
            disabled={pageIndex === 0}
          >
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Next EPUB page"
            onClick={() => turnTo(pageIndex + 1)}
            disabled={pageIndex >= pageCount - 1}
          >
            <ChevronRight size={20} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="book-stage" aria-label={`${preview.title} EPUB preview`}>
        <div className="book-spine" aria-hidden="true" />
        <article
          className="epub-page-sheet"
          key={activePage.id}
          role="document"
          aria-label={`${activePage.title}, page ${pageIndex + 1} of ${pageCount}`}
        >
          <div
            className="epub-page-content"
            data-kind={activePage.kind}
            dangerouslySetInnerHTML={{ __html: activePage.bodyHtml }}
          />
        </article>
      </div>
    </div>
  );
}

function BookCover({
  book,
  coverUrl,
  size,
}: {
  book: ReaderBook;
  coverUrl: string | undefined;
  size: "large" | "hero";
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
      <BookOpen size={size === "hero" ? 34 : 26} aria-hidden="true" />
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
