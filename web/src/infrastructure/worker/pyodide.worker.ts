import { KOBO_READER_ID } from "../readers/kobo/types.js";
import type { LocalFile } from "../file-system/local-files.js";
import type {
  CatalogAnnotationsInput,
  GenerateAnnotationEpubInput,
  WorkerRequest,
} from "./protocol.js";
import { WORKER_REQUESTS, WORKER_RESPONSES } from "./protocol.js";

declare const WorkerGlobalScope: (new () => unknown) | undefined;

const PYODIDE_VERSION = "314.0.6";
const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const PYODIDE_MODULE_URL = `${PYODIDE_INDEX_URL}pyodide.mjs`;
const PYTHON_PACKAGE_URL = "/python/afterbook.zip";
const PYTHON_PACKAGE_PATH = "/workspace";
const STAGED_READER_ROOT = "/reader-source";

const PYTHON_GLOBALS = {
  bookId: "_afterbook_book_id",
  exportFilename: "_afterbook_export_filename",
  exportData: "_afterbook_export_data",
} as const;

interface PyodideModule {
  loadPyodide(options: { indexURL: string }): Promise<PyodideRuntime>;
}

interface PyodideRuntime {
  FS: PyodideFS;
  globals: {
    set(key: string, value: unknown): void;
    get(key: string): unknown;
  };
  runPython(code: string): unknown;
  unpackArchive(archive: ArrayBuffer, format: "zip", options: { extractDir: string }): void;
}

interface PyodideFS {
  analyzePath(path: string): { exists: boolean };
  isDir(mode: number): boolean;
  mkdir(path: string): void;
  mkdirTree(path: string): void;
  readdir(path: string): string[];
  rmdir(path: string): void;
  stat(path: string): { mode: number };
  unlink(path: string): void;
  writeFile(path: string, data: Uint8Array): void;
}

interface WorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent<WorkerRequest>) => void): void;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

export function createPyodideWorkerController(
  options: {
    pyodide?: PyodideRuntime;
    importPyodide?: () => Promise<PyodideRuntime>;
    fetchPackage?: () => Promise<ArrayBuffer>;
  } = {},
) {
  let pyodide = options.pyodide || null;
  let initializing: Promise<PyodideRuntime> | null = null;

  async function initialize(): Promise<PyodideRuntime> {
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
    async handle(message: WorkerRequest) {
      const runtime = await initialize();

      if (message.type === WORKER_REQUESTS.catalogAnnotations) {
        const payload = catalogInput(message.payload);
        assertSupportedReader(payload.readerId);
        stageFiles(runtime.FS, payload.files, { clear: true });
        return { books: JSON.parse(String(runtime.runPython(listKoboBooksPython()))) };
      }

      if (message.type === WORKER_REQUESTS.generateAnnotationEpub) {
        const payload = exportInput(message.payload);
        assertSupportedReader(payload.readerId);
        if (payload.coverFile) {
          stageFiles(runtime.FS, [payload.coverFile], { clear: false });
        }
        runtime.globals.set(PYTHON_GLOBALS.bookId, payload.bookId);
        runtime.runPython(generateKoboEpubPython());
        return {
          filename: String(runtime.globals.get(PYTHON_GLOBALS.exportFilename)),
          data: copyBytes(runtime.globals.get(PYTHON_GLOBALS.exportData)),
        };
      }

      throw new Error(`Unsupported worker request: ${message.type}`);
    },
  };
}

export function attachPyodideWorker(
  scope: WorkerScope = globalThis as unknown as WorkerScope,
  controller = createPyodideWorkerController(),
) {
  scope.addEventListener("message", async (event) => {
    const message = event.data;
    try {
      const result = await controller.handle(message);
      const { payload, transfer } = responsePayload(result);
      scope.postMessage({ id: message.id, type: WORKER_RESPONSES.success, payload }, transfer);
    } catch (error) {
      scope.postMessage({ id: message.id, type: WORKER_RESPONSES.error, error: serializeError(error) });
    }
  });
}

export function stageFiles(
  FS: PyodideFS,
  files: readonly LocalFile[],
  options: { clear?: boolean } = {},
) {
  if (options.clear) {
    removeTree(FS, STAGED_READER_ROOT);
  }
  mkdirTree(FS, STAGED_READER_ROOT);

  for (const file of files) {
    const stagedPath = `${STAGED_READER_ROOT}/${safeRelativePath(file.path)}`;
    mkdirTree(FS, parentPath(stagedPath));
    FS.writeFile(stagedPath, copyBytes(file.bytes));
  }
}

export function safeRelativePath(path: string): string {
  if (typeof path !== "string" || path.trim() === "") {
    throw new Error("Staged reader file paths must not be empty.");
  }
  if (path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path)) {
    throw new Error("Staged reader file paths must be relative.");
  }

  const segments = path.split("/").filter(Boolean);
  if (!segments.length || segments.some((segment) => !isSafePathSegment(segment))) {
    throw new Error("Staged reader file paths must stay inside the reader root.");
  }
  return segments.join("/");
}

async function initializeRuntime(options: {
  importPyodide?: () => Promise<PyodideRuntime>;
  fetchPackage?: () => Promise<ArrayBuffer>;
}): Promise<PyodideRuntime> {
  const runtime = await (options.importPyodide || loadPyodideRuntime)();
  const archive = await (options.fetchPackage || fetchAfterbookPackage)();
  runtime.FS.mkdirTree(PYTHON_PACKAGE_PATH);
  runtime.unpackArchive(archive, "zip", { extractDir: PYTHON_PACKAGE_PATH });
  runtime.runPython(`
import sys
if "${PYTHON_PACKAGE_PATH}" not in sys.path:
    sys.path.insert(0, "${PYTHON_PACKAGE_PATH}")
`);
  return runtime;
}

async function loadPyodideRuntime(): Promise<PyodideRuntime> {
  const { loadPyodide } = (await import(/* @vite-ignore */ PYODIDE_MODULE_URL)) as PyodideModule;
  return loadPyodide({ indexURL: PYODIDE_INDEX_URL });
}

async function fetchAfterbookPackage(): Promise<ArrayBuffer> {
  const response = await fetch(PYTHON_PACKAGE_URL);
  if (!response.ok) {
    throw new Error(`Could not load Afterbook Python package: ${response.status}`);
  }
  return response.arrayBuffer();
}

function listKoboBooksPython(): string {
  return `
import json
from afterbook.api import list_kobo_books
json.dumps(list_kobo_books("${STAGED_READER_ROOT}"))
`;
}

function generateKoboEpubPython(): string {
  return `
from pyodide.ffi import to_js
from afterbook.api import generate_kobo_epub
result = generate_kobo_epub("${STAGED_READER_ROOT}", ${PYTHON_GLOBALS.bookId})
${PYTHON_GLOBALS.exportFilename} = result.filename
${PYTHON_GLOBALS.exportData} = to_js(result.data)
`;
}

function catalogInput(payload: unknown): CatalogAnnotationsInput {
  if (!isCatalogInput(payload)) {
    throw new Error("Cataloging annotations requires a reader id and file list.");
  }
  return payload;
}

function exportInput(payload: unknown): GenerateAnnotationEpubInput {
  if (!isExportInput(payload)) {
    throw new Error("Generating an EPUB requires a reader id and book id.");
  }
  return payload;
}

function isCatalogInput(payload: unknown): payload is CatalogAnnotationsInput {
  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as { readerId?: unknown }).readerId === "string" &&
    Array.isArray((payload as { files?: unknown }).files)
  );
}

function isExportInput(payload: unknown): payload is GenerateAnnotationEpubInput {
  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as { readerId?: unknown }).readerId === "string" &&
    typeof (payload as { bookId?: unknown }).bookId === "string"
  );
}

function assertSupportedReader(readerId: string): asserts readerId is typeof KOBO_READER_ID {
  if (readerId !== KOBO_READER_ID) {
    throw new Error(`Reader is not supported by this worker: ${readerId}`);
  }
}

function responsePayload(payload: unknown) {
  if (hasUint8ArrayData(payload)) {
    const buffer = transferableBuffer(payload.data);
    return { payload: { ...payload, data: buffer }, transfer: [buffer] };
  }
  return { payload, transfer: [] };
}

function serializeError(error: unknown) {
  return {
    name: errorValue(error, "name") || "Error",
    message: errorValue(error, "message") || String(error),
    stack: errorValue(error, "stack"),
  };
}

function copyBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value.slice();
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value).slice();
  }
  if (ArrayBuffer.isView(value)) {
    if (!(value.buffer instanceof ArrayBuffer)) {
      throw new Error("Expected bytes backed by an ArrayBuffer.");
    }
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  }
  throw new Error("Expected bytes.");
}

function transferableBuffer(bytes: Uint8Array): ArrayBuffer {
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

function hasUint8ArrayData(payload: unknown): payload is { data: Uint8Array } {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { data?: unknown }).data instanceof Uint8Array
  );
}

function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index > 0 ? path.slice(0, index) : "/";
}

function mkdirTree(FS: PyodideFS, path: string) {
  if (!path || path === "/" || exists(FS, path)) {
    return;
  }
  mkdirTree(FS, parentPath(path));
  FS.mkdir(path);
}

function removeTree(FS: PyodideFS, path: string) {
  if (!exists(FS, path)) {
    return;
  }
  const stat = FS.stat(path);
  if (!FS.isDir(stat.mode)) {
    FS.unlink(path);
    return;
  }
  for (const name of FS.readdir(path)) {
    if (name !== "." && name !== "..") {
      removeTree(FS, `${path}/${name}`);
    }
  }
  if (path !== "/") {
    FS.rmdir(path);
  }
}

function exists(FS: PyodideFS, path: string): boolean {
  return FS.analyzePath(path).exists;
}

function isSafePathSegment(segment: string): boolean {
  return segment !== "." && segment !== ".." && !segment.includes("/") && !segment.includes("\\");
}

function errorValue(error: unknown, property: "name" | "message" | "stack"): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const value = (error as Record<string, unknown>)[property];
  return typeof value === "string" ? value : undefined;
}

if (typeof WorkerGlobalScope !== "undefined" && globalThis instanceof WorkerGlobalScope) {
  attachPyodideWorker(globalThis as unknown as WorkerScope);
}
