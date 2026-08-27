import { createAfterbookClient } from "./worker-client.js";
import {
  KoboDirectoryError,
  findCachedCover,
  readKoboSnapshot,
  selectKoboDirectory,
} from "./kobo-files.js";

export function startAfterbookApp(options = {}) {
  const app = createAfterbookApp(options);
  app.mount();
  return app;
}

export function createAfterbookApp(options = {}) {
  const documentRef = options.document || globalThis.document;
  const windowRef = options.window || globalThis;
  const statusElement = options.statusElement || documentRef.getElementById("status");
  const connectButton = options.connectButton || documentRef.getElementById("connect-kobo");
  const booksElement = options.booksElement || documentRef.getElementById("books");
  const clientFactory = options.clientFactory || (() => createAfterbookClient());
  const download = options.download || ((filename, data) => downloadEpub(documentRef, filename, data));
  const urlFactory = options.urlFactory || windowRef.URL;
  const state = {
    client: options.client || null,
    directoryHandle: null,
    books: [],
    covers: new Map(),
    coverUrls: new Map(),
    exportingBookId: null,
  };

  function mount() {
    connectButton.addEventListener("click", connect);
    renderBooks();
    if (typeof windowRef.showDirectoryPicker !== "function") {
      setStatus("Chrome or Edge on desktop is required to connect to a Kobo drive.");
    }
  }

  async function connect() {
    try {
      clearCoverUrls();
      renderBooks();
      setStatus("Choose the mounted KOBOeReader drive.");
      connectButton.disabled = true;

      const directoryHandle = await selectKoboDirectory(windowRef);
      state.directoryHandle = directoryHandle;

      setStatus("Copying a local database snapshot.");
      const snapshotFiles = await readKoboSnapshot(directoryHandle);

      setStatus("Reading highlights and notes locally.");
      const result = await getClient().loadSnapshot(snapshotFiles);
      state.books = result.books || [];
      renderBooks();

      await loadCovers();
      renderBooks();
      setStatus(
        state.books.length
          ? `${state.books.length} book${state.books.length === 1 ? "" : "s"} found.`
          : "No books with highlights or notes were found.",
      );
    } catch (error) {
      state.books = [];
      renderBooks();
      setStatus(friendlyErrorMessage(error));
    } finally {
      connectButton.disabled = false;
    }
  }

  async function loadCovers() {
    for (const book of state.books) {
      const cover = await safelyFindCover(book);
      if (!cover) {
        continue;
      }
      const url = urlFactory.createObjectURL(new Blob([cover.bytes]));
      state.covers.set(book.source_id, cover);
      state.coverUrls.set(book.source_id, url);
    }
  }

  async function safelyFindCover(book) {
    try {
      return await findCachedCover(state.directoryHandle, book.cover);
    } catch (error) {
      if (error.name === "NotAllowedError" || error.name === "NotFoundError") {
        return null;
      }
      throw error;
    }
  }

  async function exportBook(book) {
    try {
      state.exportingBookId = book.source_id;
      renderBooks();
      setStatus(`Creating ${book.title} - My Clippings.epub.`);

      const cover = state.covers.get(book.source_id) || (await safelyFindCover(book));
      const coverFile = cover ? { ...cover, bytes: cover.bytes.slice() } : null;
      const generated = await getClient().exportBook(book.source_id, coverFile);
      download(generated.filename, generated.data);
      setStatus(`Downloaded ${generated.filename}.`);
    } catch (error) {
      setStatus(friendlyErrorMessage(error));
    } finally {
      state.exportingBookId = null;
      renderBooks();
    }
  }

  function renderBooks() {
    booksElement.replaceChildren();
    if (!state.books.length) {
      booksElement.textContent = "No Kobo books loaded.";
      return;
    }

    const table = documentRef.createElement("table");
    const thead = documentRef.createElement("thead");
    const headRow = documentRef.createElement("tr");
    for (const label of ["Cover", "Book", "Highlights", "Notes", ""]) {
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
    booksElement.append(table);
  }

  function bookRow(book) {
    const row = documentRef.createElement("tr");
    row.append(coverCell(book));
    row.append(textCell(`${book.title}${book.author ? ` - ${book.author}` : ""}`));
    row.append(textCell(String(book.highlight_count || 0)));
    row.append(textCell(String(book.note_count || 0)));

    const actionCell = documentRef.createElement("td");
    const button = documentRef.createElement("button");
    button.type = "button";
    button.textContent =
      state.exportingBookId === book.source_id ? "Creating..." : "Create clipping book";
    button.disabled = state.exportingBookId !== null;
    button.addEventListener("click", () => exportBook(book));
    actionCell.append(button);
    row.append(actionCell);
    return row;
  }

  function coverCell(book) {
    const cell = documentRef.createElement("td");
    const url = state.coverUrls.get(book.source_id);
    if (!url) {
      cell.textContent = "No cover";
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

  function textCell(value) {
    const cell = documentRef.createElement("td");
    cell.textContent = value;
    return cell;
  }

  function getClient() {
    if (!state.client) {
      state.client = clientFactory();
    }
    return state.client;
  }

  function setStatus(message) {
    statusElement.textContent = message;
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

export function downloadEpub(documentRef, filename, data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const blob = new Blob([bytes], { type: "application/epub+zip" });
  const url = URL.createObjectURL(blob);
  const link = documentRef.createElement("a");
  link.href = url;
  link.download = filename;
  documentRef.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function friendlyErrorMessage(error) {
  if (error?.name === "AbortError") {
    return "No Kobo drive was selected.";
  }
  if (error instanceof KoboDirectoryError && error.code === "unsupported-browser") {
    return error.message;
  }
  if (error?.code === "permission-denied" || error?.name === "NotAllowedError") {
    return "Afterbook can only continue after you grant read access to the Kobo drive.";
  }
  if (error?.name === "NotFoundError") {
    return "That folder does not contain .kobo/KoboReader.sqlite. Choose KOBOeReader.";
  }
  return error?.message || "Afterbook could not read this Kobo drive.";
}
