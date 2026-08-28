import {
  BookOpen,
  BookOpenCheck,
  Check,
  ChevronRight,
  FolderOpen,
  HardDrive,
  LibraryBig,
  Loader2,
  Lock,
  PlugZap,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { ReaderBook, ReaderDefinition } from "../domain/readers.js";
import { BookPreviewModal } from "../features/annotation-export/components/book-preview-modal.js";
import {
  type AnnotationExportViewModel,
  useAnnotationExport,
} from "../features/annotation-export/use-annotation-export.js";
import { createReaderRegistry } from "../infrastructure/readers/reader-registry.js";

const GITHUB_REPOSITORY_URL = "https://github.com/sushinoya/afterbook";

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
          <h1>AfterBook</h1>
        </div>
        <div className="topbar-actions">
          <GitHubStarButton />
          <StatusIndicator phase={model.phase} message={model.statusMessage} />
        </div>
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
        <BookPreviewModal
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
        <h1 id="welcome-title">AfterBook.</h1>
        <p className="welcome-lede">
          Keep the parts of an eBook that mattered to you. Connect a supported
          ebook reader and turn highlights and notes into a small personal ePub
          book.
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

function GitHubStarButton() {
  useEffect(() => {
    const script = document.createElement("script");
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.src = "https://buttons.github.io/buttons.js";
    document.body.append(script);

    return () => {
      script.remove();
    };
  }, []);

  return (
    <a
      className="github-button github-star-embed"
      href={GITHUB_REPOSITORY_URL}
      data-icon="octicon-star"
      data-size="large"
      data-show-count="true"
      aria-label="Star sushinoya/afterbook on GitHub"
      target="_blank"
      rel="noreferrer"
    >
      Star
    </a>
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

      {step === 1 && readers.length > 1 ? (
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
      <div className={`wizard-actions${step === 0 ? " compact-action" : ""}`}>
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
        {step === 1 ? (
          <div className="connection-detail">
            <ShieldCheck size={17} aria-hidden="true" />
            <span>{model.connection?.label || selectedReader?.connectionLabel}</span>
          </div>
        ) : null}
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
    title: "Connect your reader by USB",
    description:
      "For Kobo, plug it in and tap Connect on the device. Wait for the reader drive to appear on this computer.",
    icon: <HardDrive size={30} aria-hidden="true" />,
  },
  {
    title: "Select the reader drive",
    description:
      "When the browser asks, choose the top-level reader drive, for example KOBOeReader. Do not choose an individual book or subfolder.",
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
