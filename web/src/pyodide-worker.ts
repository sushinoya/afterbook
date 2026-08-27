import {
  PYODIDE_ARCHIVE_FORMAT,
  PYTHON_GLOBALS,
  PYTHON_PACKAGE_WEB_PATH,
  WORKER_MESSAGE_TYPES,
  WORKER_RESPONSE_TYPES,
} from "./constants.js";
import type { KoboFile } from "./kobo-files.js";

declare const WorkerGlobalScope: (new () => unknown) | undefined;

export const PYODIDE_VERSION = "314.0.6";
export const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
export const PYODIDE_MODULE_URL = `${PYODIDE_INDEX_URL}pyodide.mjs`;
export const KOBO_ROOT = "/kobo";
export const PYTHON_PACKAGE_PATH = "/workspace";

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

export interface PyodideFS {
  analyzePath(path: string): { exists: boolean };
  isDir(mode: number): boolean;
  mkdir(path: string): void;
  mkdirTree(path: string): void;
  readFile(path: string, options?: { encoding: "binary" }): Uint8Array;
  readdir(path: string): string[];
  rmdir(path: string): void;
  stat(path: string): { mode: number };
  unlink(path: string): void;
  writeFile(path: string, data: Uint8Array): void;
}

interface WorkerControllerOptions {
  pyodide?: PyodideRuntime;
  moduleUrl?: string;
  indexURL?: string;
  packageUrl?: string;
  fetchFn?: typeof fetch;
  loadPyodideRuntime?: (options: WorkerControllerOptions) => Promise<PyodideRuntime>;
  loadAfterbookPackage?: (
    pyodide: PyodideRuntime,
    options: WorkerControllerOptions,
  ) => Promise<void>;
}

interface WorkerMessage {
  id?: number;
  type?: WorkerMessageType;
  payload?: unknown;
}

type WorkerMessageType = (typeof WORKER_MESSAGE_TYPES)[keyof typeof WORKER_MESSAGE_TYPES];

interface SnapshotPayload {
  files: KoboFile[];
}

interface ExportPayload {
  bookId: string;
  coverFile?: KoboFile | null;
}

interface ExportedEpub {
  filename: string;
  data: Uint8Array;
}

interface WorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent<WorkerMessage>) => void): void;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

export async function loadPyodideRuntime(
  options: WorkerControllerOptions = {},
): Promise<PyodideRuntime> {
  const moduleUrl = options.moduleUrl || PYODIDE_MODULE_URL;
  const indexURL = options.indexURL || PYODIDE_INDEX_URL;
  const { loadPyodide } = (await import(moduleUrl)) as PyodideModule;
  return loadPyodide({ indexURL });
}

export async function loadAfterbookPackage(
  pyodide: PyodideRuntime,
  options: WorkerControllerOptions = {},
): Promise<void> {
  const fetchFn = options.fetchFn || fetch;
  const packageUrl =
    options.packageUrl || new URL(PYTHON_PACKAGE_WEB_PATH, import.meta.url).toString();
  const response = await fetchFn(packageUrl);
  if (!response.ok) {
    throw new Error(`Could not load Afterbook Python package: ${response.status}`);
  }
  const archive = await response.arrayBuffer();
  pyodide.FS.mkdirTree(PYTHON_PACKAGE_PATH);
  pyodide.unpackArchive(archive, PYODIDE_ARCHIVE_FORMAT, { extractDir: PYTHON_PACKAGE_PATH });
  pyodide.runPython(`
import sys
if "${PYTHON_PACKAGE_PATH}" not in sys.path:
    sys.path.insert(0, "${PYTHON_PACKAGE_PATH}")
`);
}

export function createWorkerController(options: WorkerControllerOptions = {}) {
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
    async handle(message: WorkerMessage) {
      const runtime = await initialize();
      if (message.type === WORKER_MESSAGE_TYPES.loadSnapshot) {
        stageFiles(runtime.FS, snapshotFiles(message.payload), KOBO_ROOT, { clear: true });
        return { books: JSON.parse(String(runtime.runPython(koboListBooksPython()))) };
      }
      if (message.type === WORKER_MESSAGE_TYPES.exportBook) {
        const payload = exportPayload(message.payload);
        if (payload.coverFile) {
          stageFiles(runtime.FS, [payload.coverFile], KOBO_ROOT, { clear: false });
        }
        runtime.globals.set(PYTHON_GLOBALS.bookId, payload.bookId);
        runtime.runPython(koboExportPython());
        const filename = String(runtime.globals.get(PYTHON_GLOBALS.exportFilename));
        const data = copyBytes(runtime.globals.get(PYTHON_GLOBALS.exportData));
        return { filename, data } satisfies ExportedEpub;
      }
      throw new Error(`Unsupported worker message: ${message.type}`);
    },
  };
}

async function initializeRuntime(options: WorkerControllerOptions): Promise<PyodideRuntime> {
  const runtime = await (options.loadPyodideRuntime || loadPyodideRuntime)(options);
  await (options.loadAfterbookPackage || loadAfterbookPackage)(runtime, options);
  return runtime;
}

export function stageFiles(
  FS: PyodideFS,
  files: readonly KoboFile[],
  rootPath = KOBO_ROOT,
  options: { clear?: boolean } = {},
) {
  if (options.clear) {
    removeTree(FS, rootPath);
  }
  mkdirTree(FS, rootPath);
  for (const file of files || []) {
    writeStagedFile(FS, rootPath, file);
  }
}

export function writeStagedFile(FS: PyodideFS, rootPath: string, file: KoboFile) {
  const path = `${rootPath}/${stagedFilePath(file)}`;
  mkdirTree(FS, parentPath(path));
  FS.writeFile(path, bytesFromFile(file));
}

export function safeRelativePath(path: string): string {
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

function isSafePathSegment(segment: string): boolean {
  return segment !== "." && segment !== ".." && !segment.includes("/") && !segment.includes("\\");
}

function koboListBooksPython(): string {
  return `
import json
from afterbook.api import list_kobo_books
json.dumps(list_kobo_books("${KOBO_ROOT}"))
`;
}

function koboExportPython(): string {
  return `
from pyodide.ffi import to_js
from afterbook.api import generate_kobo_epub
result = generate_kobo_epub("${KOBO_ROOT}", ${PYTHON_GLOBALS.bookId})
${PYTHON_GLOBALS.exportFilename} = result.filename
${PYTHON_GLOBALS.exportData} = to_js(result.data)
`;
}

function snapshotFiles(payload: unknown): KoboFile[] {
  if (!isSnapshotPayload(payload)) {
    throw new Error(`${WORKER_MESSAGE_TYPES.loadSnapshot} requires a file list.`);
  }
  return payload.files;
}

function exportPayload(payload: unknown): ExportPayload {
  if (!isExportPayload(payload)) {
    throw new Error(`${WORKER_MESSAGE_TYPES.exportBook} requires a book id.`);
  }
  return payload;
}

function bytesFromFile(file: KoboFile): Uint8Array {
  if (typeof file.path !== "string") {
    throw new Error("Staged files require a relative path.");
  }
  return copyBytes(file.bytes);
}

function stagedFilePath(file: KoboFile): string {
  if (typeof file.path !== "string") {
    throw new Error("Staged files require a relative path.");
  }
  return safeRelativePath(file.path);
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
      throw new Error("Expected EPUB data as bytes.");
    }
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  }
  throw new Error("Expected EPUB data as bytes.");
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
    if (name === "." || name === "..") {
      continue;
    }
    removeTree(FS, `${path}/${name}`);
  }
  if (path !== "/") {
    FS.rmdir(path);
  }
}

function exists(FS: PyodideFS, path: string): boolean {
  return FS.analyzePath(path).exists;
}

function serializeError(error: unknown) {
  return {
    name: errorValue(error, "name") || "Error",
    message: errorValue(error, "message") || String(error),
    stack: errorValue(error, "stack"),
  };
}

function workerResponsePayload(payload: unknown) {
  if (hasUint8ArrayData(payload)) {
    const buffer = transferableBuffer(payload.data);
    return { payload: { ...payload, data: buffer }, transfer: [buffer] };
  }
  return { payload, transfer: [] };
}

export function attachWorker(
  scope: WorkerScope = globalThis as unknown as WorkerScope,
  controller = createWorkerController(),
) {
  scope.addEventListener("message", async (event) => {
    const message = event.data || {};
    try {
      const result = await controller.handle(message);
      const { payload, transfer } = workerResponsePayload(result);
      scope.postMessage({ id: message.id, type: WORKER_RESPONSE_TYPES.success, payload }, transfer);
    } catch (error) {
      scope.postMessage({
        id: message.id,
        type: WORKER_RESPONSE_TYPES.error,
        error: serializeError(error),
      });
    }
  });
}

function isSnapshotPayload(payload: unknown): payload is SnapshotPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    Array.isArray((payload as { files?: unknown }).files)
  );
}

function isExportPayload(payload: unknown): payload is ExportPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as { bookId?: unknown }).bookId === "string" &&
    (payload as { bookId: string }).bookId.trim() !== ""
  );
}

function hasUint8ArrayData(payload: unknown): payload is { data: Uint8Array } {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { data?: unknown }).data instanceof Uint8Array
  );
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

function errorValue(error: unknown, property: "name" | "message" | "stack"): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const value = (error as Record<string, unknown>)[property];
  return typeof value === "string" ? value : undefined;
}

if (typeof WorkerGlobalScope !== "undefined" && globalThis instanceof WorkerGlobalScope) {
  attachWorker(globalThis as unknown as WorkerScope);
}
