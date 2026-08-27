import {
  APP_DOM_IDS,
  APP_TEXT,
  BOOK_TABLE_HEADERS,
  BOOK_TITLE_AUTHOR_SEPARATOR,
  CLIPPING_BOOK_SUFFIX,
  DOM_EXCEPTION_NAMES,
  EPUB_MIME_TYPE,
  KOBO_DIRECTORY_ERROR_CODES,
} from "./constants.js";
import { createAfterbookClient, type AfterbookClient } from "./worker-client.js";
import {
  KoboDirectoryError,
  type CoverCacheLocator,
  type DirectoryPickerScope,
  type KoboDirectoryHandle,
  type KoboFile,
  findCachedCover,
  readKoboSnapshot,
  selectKoboDirectory,
} from "./kobo-files.js";

export interface KoboBook {
  source_id: string;
  title: string;
  author: string | null;
  subtitle: string | null;
  highlight_count: number;
  note_count: number;
  cover: CoverCacheLocator | null;
}

interface AppElements {
  statusElement: HTMLElement;
  connectButton: HTMLButtonElement;
  booksElement: HTMLElement;
}

interface UrlFactory {
  createObjectURL(blob: Blob): string;
  revokeObjectURL?(url: string): void;
}

interface AfterbookAppOptions {
  document?: Document;
  window?: DirectoryPickerScope;
  statusElement?: HTMLElement;
  connectButton?: HTMLButtonElement;
  booksElement?: HTMLElement;
  client?: AfterbookClient;
  clientFactory?: () => AfterbookClient;
  download?: (filename: string, data: Uint8Array) => void;
  urlFactory?: UrlFactory;
}

interface AfterbookAppState {
  client: AfterbookClient | null;
  directoryHandle: KoboDirectoryHandle | null;
  books: KoboBook[];
  covers: Map<string, KoboFile>;
  coverUrls: Map<string, string>;
  exportingBookId: string | null;
}

export function startAfterbookApp(options: AfterbookAppOptions = {}) {
  const app = createAfterbookApp(options);
  app.mount();
  return app;
}

export function createAfterbookApp(options: AfterbookAppOptions = {}) {
  const documentRef = options.document || globalThis.document;
  const windowRef = options.window || (globalThis as DirectoryPickerScope);
  const elements: AppElements = {
    statusElement:
      options.statusElement || requiredElement(documentRef, APP_DOM_IDS.status, HTMLElement),
    connectButton:
      options.connectButton ||
      requiredElement(documentRef, APP_DOM_IDS.connectKobo, HTMLButtonElement),
    booksElement:
      options.booksElement || requiredElement(documentRef, APP_DOM_IDS.books, HTMLElement),
  };
  const clientFactory = options.clientFactory || (() => createAfterbookClient());
  const download =
    options.download || ((filename, data) => downloadEpub(documentRef, filename, data));
  const urlFactory = options.urlFactory || globalThis.URL;
  const state: AfterbookAppState = {
    client: options.client || null,
    directoryHandle: null,
    books: [],
    covers: new Map(),
    coverUrls: new Map(),
    exportingBookId: null,
  };

  function mount() {
    elements.connectButton.addEventListener("click", connect);
    renderBooks();
    if (typeof windowRef.showDirectoryPicker !== "function") {
      setStatus(APP_TEXT.unsupportedBrowser);
    }
  }

  async function connect() {
    try {
      clearCoverUrls();
      renderBooks();
      setStatus(APP_TEXT.chooseDrive);
      elements.connectButton.disabled = true;

      const directoryHandle = await selectKoboDirectory(windowRef);
      state.directoryHandle = directoryHandle;

      setStatus(APP_TEXT.copyingSnapshot);
      const snapshotFiles = await readKoboSnapshot(directoryHandle);

      setStatus(APP_TEXT.readingAnnotations);
      const result = await getClient().loadSnapshot(snapshotFiles);
      state.books = parseBooks(result.books);
      renderBooks();

      await loadCovers();
      renderBooks();
      setStatus(
        state.books.length
          ? booksFoundMessage(state.books.length)
          : APP_TEXT.noBooksFound,
      );
    } catch (error) {
      state.books = [];
      renderBooks();
      setStatus(friendlyErrorMessage(error));
    } finally {
      elements.connectButton.disabled = false;
    }
  }

  async function loadCovers() {
    for (const book of state.books) {
      const cover = await safelyFindCover(book);
      if (!cover) {
        continue;
      }
      const url = urlFactory.createObjectURL(new Blob([arrayBufferFor(cover.bytes)]));
      state.covers.set(book.source_id, cover);
      state.coverUrls.set(book.source_id, url);
    }
  }

  async function safelyFindCover(book: KoboBook) {
    if (!state.directoryHandle) {
      return null;
    }
    try {
      return await findCachedCover(state.directoryHandle, book.cover);
    } catch (error) {
      if (
        errorName(error) === DOM_EXCEPTION_NAMES.notAllowed ||
        errorName(error) === DOM_EXCEPTION_NAMES.notFound
      ) {
        return null;
      }
      throw error;
    }
  }

  async function exportBook(book: KoboBook) {
    try {
      state.exportingBookId = book.source_id;
      renderBooks();
      setStatus(creatingEpubMessage(book.title));

      const cover = state.covers.get(book.source_id) || (await safelyFindCover(book));
      const coverFile = cover ? { ...cover, bytes: cover.bytes.slice() } : null;
      const generated = await getClient().exportBook(book.source_id, coverFile);
      download(generated.filename, generated.data);
      setStatus(downloadedEpubMessage(generated.filename));
    } catch (error) {
      setStatus(friendlyErrorMessage(error));
    } finally {
      state.exportingBookId = null;
      renderBooks();
    }
  }

  function renderBooks() {
    elements.booksElement.replaceChildren();
    if (!state.books.length) {
      elements.booksElement.textContent = APP_TEXT.noBooksLoaded;
      return;
    }

    const table = documentRef.createElement("table");
    const thead = documentRef.createElement("thead");
    const headRow = documentRef.createElement("tr");
    for (const label of BOOK_TABLE_HEADERS) {
      const cell = documentRef.createElement("th");
      cell.scope = "col";
      cell.textContent = label;
      headRow.append(cell);
    }
    thead.append(headRow);
    table.append(thead);

    const tbody = documentRef.createElement("tbody");
    for (const book of state.books) {
      tbody.append(bookRow(book));
    }
    table.append(tbody);
    elements.booksElement.append(table);
  }

  function bookRow(book: KoboBook) {
    const row = documentRef.createElement("tr");
    row.append(coverCell(book));
    row.append(
      textCell(
        `${book.title}${book.author ? `${BOOK_TITLE_AUTHOR_SEPARATOR}${book.author}` : ""}`,
      ),
    );
    row.append(textCell(String(book.highlight_count || 0)));
    row.append(textCell(String(book.note_count || 0)));

    const actionCell = documentRef.createElement("td");
    const button = documentRef.createElement("button");
    button.type = "button";
    button.textContent =
      state.exportingBookId === book.source_id
        ? APP_TEXT.creatingButton
        : APP_TEXT.createClippingBookButton;
    button.disabled = state.exportingBookId !== null;
    button.addEventListener("click", () => exportBook(book));
    actionCell.append(button);
    row.append(actionCell);
    return row;
  }

  function coverCell(book: KoboBook) {
    const cell = documentRef.createElement("td");
    const url = state.coverUrls.get(book.source_id);
    if (!url) {
      cell.textContent = APP_TEXT.noCover;
      return cell;
    }
    const image = documentRef.createElement("img");
    image.src = url;
    image.alt = `${book.title} cover`;
    image.width = 48;
    image.height = 72;
    cell.append(image);
    return cell;
  }

  function textCell(value: string) {
    const cell = documentRef.createElement("td");
    cell.textContent = value;
    return cell;
  }

  function getClient(): AfterbookClient {
    if (!state.client) {
      state.client = clientFactory();
    }
    return state.client;
  }

  function setStatus(message: string) {
    elements.statusElement.textContent = message;
  }

  function clearCoverUrls() {
    for (const url of state.coverUrls.values()) {
      urlFactory.revokeObjectURL?.(url);
    }
    state.covers.clear();
    state.coverUrls.clear();
  }

  return {
    connect,
    exportBook,
    mount,
    renderBooks,
    state,
  };
}

export function downloadEpub(documentRef: Document, filename: string, data: Uint8Array) {
  const blob = new Blob([arrayBufferFor(data)], { type: EPUB_MIME_TYPE });
  const url = URL.createObjectURL(blob);
  const link = documentRef.createElement("a");
  link.href = url;
  link.download = filename;
  documentRef.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function friendlyErrorMessage(error: unknown) {
  if (errorName(error) === DOM_EXCEPTION_NAMES.abort) {
    return APP_TEXT.noKoboDriveSelected;
  }
  if (
    error instanceof KoboDirectoryError &&
    error.code === KOBO_DIRECTORY_ERROR_CODES.unsupportedBrowser
  ) {
    return error.message;
  }
  if (
    errorCode(error) === KOBO_DIRECTORY_ERROR_CODES.permissionDenied ||
    errorName(error) === DOM_EXCEPTION_NAMES.notAllowed
  ) {
    return APP_TEXT.readAccessRequired;
  }
  if (errorName(error) === DOM_EXCEPTION_NAMES.notFound) {
    return APP_TEXT.missingKoboDatabase;
  }
  return errorMessage(error) || APP_TEXT.genericReadFailure;
}

function requiredElement<T extends HTMLElement>(
  documentRef: Document,
  id: string,
  constructor: { new (): T },
): T {
  const element = documentRef.getElementById(id);
  if (element instanceof constructor) {
    return element;
  }
  throw new Error(`Missing #${id} element.`);
}

function parseBooks(value: unknown): KoboBook[] {
  return Array.isArray(value) ? value.filter(isKoboBook) : [];
}

function booksFoundMessage(count: number): string {
  return `${count} book${count === 1 ? "" : "s"} found.`;
}

function creatingEpubMessage(title: string): string {
  return `Creating ${title}${CLIPPING_BOOK_SUFFIX}.`;
}

function downloadedEpubMessage(filename: string): string {
  return `Downloaded ${filename}.`;
}

function isKoboBook(value: unknown): value is KoboBook {
  if (!value || typeof value !== "object") {
    return false;
  }
  const book = value as Partial<KoboBook>;
  return (
    typeof book.source_id === "string" &&
    typeof book.title === "string" &&
    (typeof book.author === "string" || book.author === null) &&
    (typeof book.subtitle === "string" || book.subtitle === null) &&
    typeof book.highlight_count === "number" &&
    typeof book.note_count === "number" &&
    (book.cover === null || isCoverCacheLocator(book.cover))
  );
}

function errorName(error: unknown): string | undefined {
  return errorValue(error, "name");
}

function errorCode(error: unknown): string | undefined {
  return errorValue(error, "code");
}

function errorMessage(error: unknown): string | undefined {
  return errorValue(error, "message");
}

function isCoverCacheLocator(value: unknown): value is CoverCacheLocator {
  if (!value || typeof value !== "object") {
    return false;
  }
  const locator = value as Partial<CoverCacheLocator>;
  return (
    typeof locator.directory === "string" &&
    typeof locator.fallback_prefix === "string" &&
    typeof locator.parsed_suffix === "string" &&
    (locator.priority_candidates === undefined || Array.isArray(locator.priority_candidates))
  );
}

function arrayBufferFor(bytes: Uint8Array): ArrayBuffer {
  if (
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength &&
    bytes.buffer instanceof ArrayBuffer
  ) {
    return bytes.buffer;
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function errorValue(error: unknown, property: "name" | "code" | "message"): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const value = (error as Record<string, unknown>)[property];
  return typeof value === "string" ? value : undefined;
}
