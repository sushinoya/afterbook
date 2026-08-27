import {
  BookOpenCheck,
  CheckCircle2,
  Database,
  Download,
  HardDrive,
  Loader2,
  PlugZap,
  ShieldCheck,
} from "lucide-react";
import { useMemo } from "react";

import type { ReaderBook, ReaderDefinition } from "../domain/readers.js";
import { useAnnotationExport } from "../features/annotation-export/use-annotation-export.js";
import { createReaderRegistry } from "../infrastructure/readers/reader-registry.js";

export function AppView() {
  const readers = useMemo(() => createReaderRegistry(), []);
  const model = useAnnotationExport(readers);
  const selectedReader =
    readers.find((reader) => reader.id === model.selectedReaderId) || readers[0];

  return (
    <div className="app-frame">
      <aside className="sidebar" aria-label="Afterbook navigation">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            A
          </div>
          <div>
            <h1>Afterbook</h1>
            <p>Reader management console</p>
          </div>
        </div>

        <nav className="primary-nav" aria-label="Primary">
          <a className="nav-item active" href="#annotation-export">
            <BookOpenCheck size={18} aria-hidden="true" />
            Annotation Export
          </a>
        </nav>
      </aside>

      <main className="workspace" id="annotation-export">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">Current Capability</p>
            <h2>Annotation Export</h2>
          </div>
          <div className="status-pill" data-phase={model.phase} role="status" aria-live="polite">
            {model.phase === "connecting" || model.phase === "cataloging" || model.phase === "exporting" ? (
              <Loader2 className="spin" size={16} aria-hidden="true" />
            ) : (
              <CheckCircle2 size={16} aria-hidden="true" />
            )}
            {model.statusMessage}
          </div>
        </header>

        <section className="connection-panel" aria-label="Reader source">
          <div className="reader-selector">
            <div className="section-label">Reader Source</div>
            <ReaderOptions
              readers={readers}
              selectedReaderId={model.selectedReaderId}
              onSelect={model.selectReader}
            />
          </div>

          <div className="connection-summary">
            <div className="summary-row">
              <HardDrive size={18} aria-hidden="true" />
              <span>{model.connection?.label || selectedReader?.connectionLabel}</span>
            </div>
            <div className="summary-row">
              <ShieldCheck size={18} aria-hidden="true" />
              <span>Read-only access</span>
            </div>
          </div>

          <button
            className="primary-button"
            type="button"
            onClick={model.connectReader}
            disabled={isBusy(model.phase)}
          >
            {isBusy(model.phase) ? (
              <Loader2 className="spin" size={18} aria-hidden="true" />
            ) : (
              <PlugZap size={18} aria-hidden="true" />
            )}
            Connect Reader
          </button>
        </section>

        <section className="content-section" aria-label="Annotated books">
          <div className="section-heading">
            <div>
              <div className="section-label">Catalog</div>
              <h3>Annotated Books</h3>
            </div>
            <div className="metric-strip" aria-label="Catalog totals">
              <Metric label="Titles" value={model.books.length} />
              <Metric label="Highlights" value={sum(model.books, (book) => book.metrics.highlights)} />
              <Metric label="Notes" value={sum(model.books, (book) => book.metrics.notes)} />
            </div>
          </div>

          <BookTable
            books={model.books}
            coverUrls={model.coverUrls}
            activeBookId={model.activeBookId}
            isExporting={model.phase === "exporting"}
            onExport={model.exportBook}
          />
        </section>
      </main>
    </div>
  );
}

function ReaderOptions({
  readers,
  selectedReaderId,
  onSelect,
}: {
  readers: readonly ReaderDefinition[];
  selectedReaderId: ReaderDefinition["id"];
  onSelect(readerId: ReaderDefinition["id"]): void;
}) {
  return (
    <div className="reader-options">
      {readers.map((reader) => (
        <button
          className="reader-option"
          data-selected={reader.id === selectedReaderId}
          type="button"
          key={reader.id}
          onClick={() => onSelect(reader.id)}
        >
          <Database size={18} aria-hidden="true" />
          <span>
            <strong>{reader.name}</strong>
            <small>{reader.vendor}</small>
          </span>
        </button>
      ))}
    </div>
  );
}

function BookTable({
  books,
  coverUrls,
  activeBookId,
  isExporting,
  onExport,
}: {
  books: readonly ReaderBook[];
  coverUrls: ReadonlyMap<string, string>;
  activeBookId: string | null;
  isExporting: boolean;
  onExport(book: ReaderBook): void;
}) {
  if (books.length === 0) {
    return (
      <div className="empty-state">
        <BookOpenCheck size={22} aria-hidden="true" />
        <span>No annotated books loaded.</span>
      </div>
    );
  }

  return (
    <div className="table-shell">
      <table>
        <thead>
          <tr>
            <th scope="col">Cover</th>
            <th scope="col">Title</th>
            <th scope="col">Reader</th>
            <th scope="col" className="numeric">
              Highlights
            </th>
            <th scope="col" className="numeric">
              Notes
            </th>
            <th scope="col" className="action-column">
              Export
            </th>
          </tr>
        </thead>
        <tbody>
          {books.map((book) => (
            <tr key={book.id}>
              <td>
                {coverUrls.has(book.id) ? (
                  <img className="cover" src={coverUrls.get(book.id)} alt={`${book.title} cover`} />
                ) : (
                  <div className="cover placeholder" aria-label="No cover" />
                )}
              </td>
              <td>
                <div className="book-title">{book.title}</div>
                {book.author ? <div className="book-author">{book.author}</div> : null}
              </td>
              <td>{book.readerId}</td>
              <td className="numeric">{book.metrics.highlights}</td>
              <td className="numeric">{book.metrics.notes}</td>
              <td className="action-column">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => onExport(book)}
                  disabled={isExporting}
                >
                  {activeBookId === book.id ? (
                    <Loader2 className="spin" size={16} aria-hidden="true" />
                  ) : (
                    <Download size={16} aria-hidden="true" />
                  )}
                  Export EPUB
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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

function isBusy(phase: string) {
  return phase === "connecting" || phase === "cataloging" || phase === "exporting";
}

function sum(books: readonly ReaderBook[], selector: (book: ReaderBook) => number) {
  return books.reduce((total, book) => total + selector(book), 0);
}
