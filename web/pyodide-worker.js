export const PYODIDE_VERSION = "314.0.6";
export const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
export const PYODIDE_MODULE_URL = `${PYODIDE_INDEX_URL}pyodide.mjs`;
export const KOBO_ROOT = "/kobo";
export const PYTHON_PACKAGE_PATH = "/workspace";

export async function loadPyodideRuntime(options = {}) {
  const moduleUrl = options.moduleUrl || PYODIDE_MODULE_URL;
  const indexURL = options.indexURL || PYODIDE_INDEX_URL;
  const { loadPyodide } = await import(moduleUrl);
  return loadPyodide({ indexURL });
}

export async function loadAfterbookPackage(pyodide, options = {}) {
  const fetchFn = options.fetchFn || fetch;
  const packageUrl =
    options.packageUrl || new URL("./python/afterbook.zip", import.meta.url).toString();
  const response = await fetchFn(packageUrl);
  if (!response.ok) {
    throw new Error(`Could not load Afterbook Python package: ${response.status}`);
  }
  const archive = await response.arrayBuffer();
  pyodide.FS.mkdirTree(PYTHON_PACKAGE_PATH);
  pyodide.unpackArchive(archive, "zip", { extractDir: PYTHON_PACKAGE_PATH });
  pyodide.runPython(`
import sys
if "${PYTHON_PACKAGE_PATH}" not in sys.path:
    sys.path.insert(0, "${PYTHON_PACKAGE_PATH}")
`);
}

export function createWorkerController(options = {}) {
  let pyodide = options.pyodide || null;
  let initializing = null;

  async function initialize() {
    if (pyodide) {
      return pyodide;
    }
    if (!initializing) {
      initializing = initializeRuntime(options)
        .then((runtime) => {
          pyodide = runtime;
          return runtime;
        })
        .catch((error) => {
          initializing = null;
          throw error;
        });
    }
    return initializing;
  }

  return {
    async handle(message) {
      const runtime = await initialize();
      if (message.type === "loadSnapshot") {
        stageFiles(runtime.FS, snapshotFiles(message.payload), KOBO_ROOT, { clear: true });
        return { books: JSON.parse(runtime.runPython(koboListBooksPython())) };
      }
      if (message.type === "exportBook") {
        const bookId = exportBookId(message.payload);
        const coverFile = message.payload?.coverFile;
        if (coverFile) {
          stageFiles(runtime.FS, [coverFile], KOBO_ROOT, { clear: false });
        }
        runtime.globals.set("_afterbook_book_id", bookId);
        runtime.runPython(koboExportPython());
        const filename = String(runtime.globals.get("_afterbook_export_filename"));
        const data = copyBytes(runtime.globals.get("_afterbook_export_data"));
        return { filename, data };
      }
      throw new Error(`Unsupported worker message: ${message.type}`);
    },
  };
}

async function initializeRuntime(options) {
  const runtime = await (options.loadPyodideRuntime || loadPyodideRuntime)(options);
  await (options.loadAfterbookPackage || loadAfterbookPackage)(runtime, options);
  return runtime;
}

export function stageFiles(FS, files, rootPath = KOBO_ROOT, options = {}) {
  if (options.clear) {
    removeTree(FS, rootPath);
  }
  mkdirTree(FS, rootPath);
  for (const file of files || []) {
    writeStagedFile(FS, rootPath, file);
  }
}

export function writeStagedFile(FS, rootPath, file) {
  const path = `${rootPath}/${stagedFilePath(file)}`;
  mkdirTree(FS, parentPath(path));
  FS.writeFile(path, bytesFromFile(file));
}

export function safeRelativePath(path) {
  if (typeof path !== "string" || path.trim() === "") {
    throw new Error("Invalid staged file path.");
  }
  if (path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path)) {
    throw new Error("Staged file paths must be relative.");
  }
  const segments = path.split("/").filter(Boolean);
  if (!segments.length || segments.some((segment) => !isSafePathSegment(segment))) {
    throw new Error("Staged file path escapes the Kobo root.");
  }
  return segments.join("/");
}

function isSafePathSegment(segment) {
  return segment !== "." && segment !== ".." && !segment.includes("/") && !segment.includes("\\");
}

function koboListBooksPython() {
  return `
import json
from afterbook.api import list_kobo_books
json.dumps(list_kobo_books("${KOBO_ROOT}"))
`;
}

function koboExportPython() {
  return `
from pyodide.ffi import to_js
from afterbook.api import generate_kobo_epub
result = generate_kobo_epub("${KOBO_ROOT}", _afterbook_book_id)
_afterbook_export_filename = result.filename
_afterbook_export_data = to_js(result.data)
`;
}

function snapshotFiles(payload) {
  const files = payload?.files;
  if (!Array.isArray(files)) {
    throw new Error("loadSnapshot requires a file list.");
  }
  return files;
}

function exportBookId(payload) {
  const bookId = payload?.bookId;
  if (typeof bookId !== "string" || bookId.trim() === "") {
    throw new Error("exportBook requires a book id.");
  }
  return bookId;
}

function bytesFromFile(file) {
  if (!file || typeof file.path !== "string") {
    throw new Error("Staged files require a relative path.");
  }
  return copyBytes(file.bytes);
}

function stagedFilePath(file) {
  if (!file || typeof file.path !== "string") {
    throw new Error("Staged files require a relative path.");
  }
  return safeRelativePath(file.path);
}

function copyBytes(value) {
  if (value instanceof Uint8Array) {
    return value.slice();
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value).slice();
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  }
  throw new Error("Expected EPUB data as bytes.");
}

function parentPath(path) {
  const index = path.lastIndexOf("/");
  return index > 0 ? path.slice(0, index) : "/";
}

function mkdirTree(FS, path) {
  if (!path || path === "/" || exists(FS, path)) {
    return;
  }
  mkdirTree(FS, parentPath(path));
  FS.mkdir(path);
}

function removeTree(FS, path) {
  if (!exists(FS, path)) {
    return;
  }
  const stat = FS.stat(path);
  if (!FS.isDir(stat.mode)) {
    FS.unlink(path);
    return;
  }
  for (const name of FS.readdir(path)) {
    if (name === "." || name === "..") {
      continue;
    }
    removeTree(FS, `${path}/${name}`);
  }
  if (path !== "/") {
    FS.rmdir(path);
  }
}

function exists(FS, path) {
  return FS.analyzePath(path).exists;
}

function serializeError(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || String(error),
    stack: error?.stack,
  };
}

function workerResponsePayload(payload) {
  if (payload?.data instanceof Uint8Array) {
    return { payload: { ...payload, data: payload.data.buffer }, transfer: [payload.data.buffer] };
  }
  return { payload, transfer: [] };
}

export function attachWorker(scope = globalThis, controller = createWorkerController()) {
  scope.addEventListener("message", async (event) => {
    const message = event.data || {};
    try {
      const result = await controller.handle(message);
      const { payload, transfer } = workerResponsePayload(result);
      scope.postMessage({ id: message.id, type: "success", payload }, transfer);
    } catch (error) {
      scope.postMessage({ id: message.id, type: "error", error: serializeError(error) });
    }
  });
}

if (typeof WorkerGlobalScope !== "undefined" && globalThis instanceof WorkerGlobalScope) {
  attachWorker(globalThis);
}
