export const APP_DOM_IDS = {
  status: "status",
  connectKobo: "connect-kobo",
  books: "books",
} as const;

export const APP_TEXT = {
  unsupportedBrowser: "Chrome or Edge on desktop is required to connect to a Kobo drive.",
  chooseDrive: "Choose the mounted KOBOeReader drive.",
  copyingSnapshot: "Copying a local database snapshot.",
  readingAnnotations: "Reading highlights and notes locally.",
  noBooksLoaded: "No Kobo books loaded.",
  noBooksFound: "No books with highlights or notes were found.",
  noCover: "No cover",
  creatingButton: "Creating...",
  createClippingBookButton: "Create clipping book",
  noKoboDriveSelected: "No Kobo drive was selected.",
  readAccessRequired: "Afterbook can only continue after you grant read access to the Kobo drive.",
  missingKoboDatabase: "That folder does not contain .kobo/KoboReader.sqlite. Choose KOBOeReader.",
  genericReadFailure: "Afterbook could not read this Kobo drive.",
} as const;

export const BOOK_TABLE_HEADERS = ["Cover", "Book", "Highlights", "Notes", ""] as const;
export const BOOK_TITLE_AUTHOR_SEPARATOR = " - ";
export const CLIPPING_BOOK_SUFFIX = " - My Clippings.epub";
export const EPUB_MIME_TYPE = "application/epub+zip";

export const DIRECTORY_PICKER_OPTIONS = {
  id: "afterbook-kobo",
  mode: "read",
} as const;

export const READ_PERMISSION = {
  mode: "read",
} as const;

export const KOBO_DIRECTORY_ERROR_CODES = {
  invalidPath: "invalid-path",
  permissionDenied: "permission-denied",
  generic: "kobo-directory-error",
  notFound: "not-found",
  unsupportedBrowser: "unsupported-browser",
} as const;

export const DOM_EXCEPTION_NAMES = {
  abort: "AbortError",
  notAllowed: "NotAllowedError",
  notFound: "NotFoundError",
} as const;

export const WORKER_MODULE_PATH = "./pyodide-worker.js";
export const WORKER_NAME = "afterbook-pyodide";

export const WORKER_MESSAGE_TYPES = {
  loadSnapshot: "loadSnapshot",
  exportBook: "exportBook",
} as const;

export const WORKER_RESPONSE_TYPES = {
  success: "success",
  error: "error",
} as const;

export const PYTHON_PACKAGE_WEB_PATH = "../python/afterbook.zip";
export const PYODIDE_ARCHIVE_FORMAT = "zip";

export const PYTHON_GLOBALS = {
  bookId: "_afterbook_book_id",
  exportFilename: "_afterbook_export_filename",
  exportData: "_afterbook_export_data",
} as const;
