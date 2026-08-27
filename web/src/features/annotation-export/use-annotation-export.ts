import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

import { ReaderConnectionError, errorMessage, errorName } from "../../domain/errors.js";
import type {
  ReaderBook,
  ReaderConnection,
  ReaderDefinition,
  ReaderId,
} from "../../domain/readers.js";
import type { LocalFile } from "../../infrastructure/file-system/local-files.js";

export interface AnnotationExportViewModel {
  readers: readonly ReaderDefinition[];
  selectedReaderId: ReaderId;
  connection: ReaderConnection | null;
  books: readonly ReaderBook[];
  coverUrls: ReadonlyMap<string, string>;
  phase: AnnotationExportPhase;
  statusMessage: string;
  activeBookId: string | null;
  selectReader(readerId: ReaderId): void;
  connectReader(): Promise<void>;
  exportBook(book: ReaderBook): Promise<void>;
}

export type AnnotationExportPhase =
  | "idle"
  | "connecting"
  | "cataloging"
  | "ready"
  | "exporting"
  | "error";

interface AnnotationExportState {
  selectedReaderId: ReaderId;
  connection: ReaderConnection | null;
  books: ReaderBook[];
  covers: Map<string, LocalFile>;
  coverUrls: Map<string, string>;
  phase: AnnotationExportPhase;
  statusMessage: string;
  activeBookId: string | null;
}

type AnnotationExportAction =
  | { type: "reader-selected"; readerId: ReaderId }
  | { type: "connect-started" }
  | { type: "catalog-started"; connection: ReaderConnection }
  | {
      type: "catalog-completed";
      books: ReaderBook[];
      covers: Map<string, LocalFile>;
      coverUrls: Map<string, string>;
    }
  | { type: "export-started"; bookId: string }
  | { type: "export-completed"; filename: string }
  | { type: "failed"; message: string }
  | { type: "reset-cover-urls" };

const STATUS_MESSAGES = {
  idle: "No reader connected.",
  connecting: "Connecting to reader source.",
  cataloging: "Reading annotation catalog.",
  exporting: "Preparing EPUB.",
} as const;

export function useAnnotationExport(
  readers: readonly ReaderDefinition[],
): AnnotationExportViewModel {
  const objectUrls = useRef(new Set<string>());
  const initialReader = readers[0];
  if (!initialReader) {
    throw new Error("Afterbook requires at least one reader adapter.");
  }

  const [state, dispatch] = useReducer(annotationExportReducer, {
    selectedReaderId: initialReader.id,
    connection: null,
    books: [],
    covers: new Map(),
    coverUrls: new Map(),
    phase: "idle",
    statusMessage: STATUS_MESSAGES.idle,
    activeBookId: null,
  });

  const selectedReader = useMemo(
    () => readers.find((reader) => reader.id === state.selectedReaderId) || initialReader,
    [initialReader, readers, state.selectedReaderId],
  );

  useEffect(() => {
    return () => {
      for (const url of objectUrls.current) {
        URL.revokeObjectURL(url);
      }
      objectUrls.current.clear();
    };
  }, []);

  const revokeCoverUrls = useCallback(() => {
    for (const url of objectUrls.current) {
      URL.revokeObjectURL(url);
    }
    objectUrls.current.clear();
    dispatch({ type: "reset-cover-urls" });
  }, []);

  const selectReader = useCallback(
    (readerId: ReaderId) => {
      revokeCoverUrls();
      dispatch({ type: "reader-selected", readerId });
    },
    [revokeCoverUrls],
  );

  const connectReader = useCallback(async () => {
    revokeCoverUrls();
    dispatch({ type: "connect-started" });

    try {
      const connection = await selectedReader.adapter.connect();
      dispatch({ type: "catalog-started", connection });

      const books = await connection.capabilities.annotationExport.listBooks();
      const { covers, coverUrls } = await loadCovers(connection, books, objectUrls.current);

      dispatch({ type: "catalog-completed", books, covers, coverUrls });
    } catch (error) {
      dispatch({ type: "failed", message: friendlyErrorMessage(error) });
    }
  }, [revokeCoverUrls, selectedReader]);

  const exportBook = useCallback(
    async (book: ReaderBook) => {
      if (!state.connection) {
        dispatch({ type: "failed", message: "Connect a reader before exporting." });
        return;
      }

      dispatch({ type: "export-started", bookId: book.id });
      try {
        const coverFile =
          state.covers.get(book.id) ||
          (await state.connection.capabilities.annotationExport.findCover(book));
        const generated = await state.connection.capabilities.annotationExport.exportBook(
          book,
          coverFile ? cloneLocalFile(coverFile) : null,
        );
        downloadEpub(generated.filename, generated.data);
        dispatch({ type: "export-completed", filename: generated.filename });
      } catch (error) {
        dispatch({ type: "failed", message: friendlyErrorMessage(error) });
      }
    },
    [state.connection, state.covers],
  );

  return {
    readers,
    selectedReaderId: state.selectedReaderId,
    connection: state.connection,
    books: state.books,
    coverUrls: state.coverUrls,
    phase: state.phase,
    statusMessage: state.statusMessage,
    activeBookId: state.activeBookId,
    selectReader,
    connectReader,
    exportBook,
  };
}

function annotationExportReducer(
  state: AnnotationExportState,
  action: AnnotationExportAction,
): AnnotationExportState {
  switch (action.type) {
    case "reader-selected":
      return {
        ...state,
        selectedReaderId: action.readerId,
        connection: null,
        books: [],
        covers: new Map(),
        coverUrls: new Map(),
        phase: "idle",
        statusMessage: STATUS_MESSAGES.idle,
        activeBookId: null,
      };
    case "connect-started":
      return {
        ...state,
        connection: null,
        books: [],
        covers: new Map(),
        coverUrls: new Map(),
        phase: "connecting",
        statusMessage: STATUS_MESSAGES.connecting,
        activeBookId: null,
      };
    case "catalog-started":
      return {
        ...state,
        connection: action.connection,
        phase: "cataloging",
        statusMessage: STATUS_MESSAGES.cataloging,
      };
    case "catalog-completed":
      return {
        ...state,
        books: action.books,
        covers: action.covers,
        coverUrls: action.coverUrls,
        phase: "ready",
        statusMessage: readyMessage(action.books.length),
        activeBookId: null,
      };
    case "export-started":
      return {
        ...state,
        phase: "exporting",
        activeBookId: action.bookId,
        statusMessage: STATUS_MESSAGES.exporting,
      };
    case "export-completed":
      return {
        ...state,
        phase: "ready",
        activeBookId: null,
        statusMessage: `Downloaded ${action.filename}.`,
      };
    case "failed":
      return {
        ...state,
        phase: "error",
        activeBookId: null,
        statusMessage: action.message,
      };
    case "reset-cover-urls":
      return {
        ...state,
        covers: new Map(),
        coverUrls: new Map(),
      };
  }
}

async function loadCovers(
  connection: ReaderConnection,
  books: readonly ReaderBook[],
  objectUrls: Set<string>,
) {
  const covers = new Map<string, LocalFile>();
  const coverUrls = new Map<string, string>();

  for (const book of books) {
    const cover = await safelyFindCover(connection, book);
    if (!cover) {
      continue;
    }

    const url = URL.createObjectURL(new Blob([arrayBufferFor(cover.bytes)]));
    objectUrls.add(url);
    covers.set(book.id, cover);
    coverUrls.set(book.id, url);
  }

  return { covers, coverUrls };
}

async function safelyFindCover(connection: ReaderConnection, book: ReaderBook) {
  try {
    return await connection.capabilities.annotationExport.findCover(book);
  } catch (error) {
    if (errorName(error) === "NotAllowedError" || errorName(error) === "NotFoundError") {
      return null;
    }
    throw error;
  }
}

function downloadEpub(filename: string, data: Uint8Array) {
  const blob = new Blob([arrayBufferFor(data)], { type: "application/epub+zip" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function readyMessage(bookCount: number) {
  if (bookCount === 0) {
    return "No annotated books found.";
  }
  return `${bookCount} title${bookCount === 1 ? "" : "s"} ready.`;
}

function friendlyErrorMessage(error: unknown): string {
  if (errorName(error) === "AbortError") {
    return "No reader source selected.";
  }
  if (error instanceof ReaderConnectionError) {
    if (error.code === "unsupported-browser") {
      return "Chrome or Edge on desktop is required for local reader access.";
    }
    if (error.code === "permission-denied") {
      return "Afterbook needs read access to continue.";
    }
    if (error.code === "invalid-source") {
      return "Selected source is not a supported reader.";
    }
    return error.message;
  }
  if (errorName(error) === "NotAllowedError") {
    return "Afterbook needs read access to continue.";
  }
  if (errorName(error) === "NotFoundError") {
    return "Selected source is not a supported reader.";
  }
  return errorMessage(error) || "Afterbook could not complete the operation.";
}

function cloneLocalFile(file: LocalFile): LocalFile {
  return {
    ...file,
    bytes: file.bytes.slice(),
  };
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
