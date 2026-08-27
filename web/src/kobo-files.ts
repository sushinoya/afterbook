import {
  APP_TEXT,
  DIRECTORY_PICKER_OPTIONS,
  DOM_EXCEPTION_NAMES,
  KOBO_DIRECTORY_ERROR_CODES,
  READ_PERMISSION,
} from "./constants.js";

export const KOBO_DATABASE_PATH = ".kobo/KoboReader.sqlite";
export const KOBO_DATABASE_SIDECAR_PATHS = [
  ".kobo/KoboReader.sqlite-wal",
  ".kobo/KoboReader.sqlite-shm",
] as const;

export interface KoboFile {
  path: string;
  name: string;
  bytes: Uint8Array;
}

export interface CoverCacheLocator {
  directory: string;
  priority_candidates?: readonly string[];
  fallback_prefix: string;
  parsed_suffix: string;
}

export interface DirectoryPickerScope {
  showDirectoryPicker?: (
    options: typeof DIRECTORY_PICKER_OPTIONS,
  ) => Promise<KoboDirectoryHandle>;
}

export interface KoboFileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
}

export interface KoboDirectoryHandle {
  kind?: "directory";
  name?: string;
  queryPermission?: ((descriptor: typeof READ_PERMISSION) => Promise<PermissionState>) | undefined;
  requestPermission?: ((descriptor: typeof READ_PERMISSION) => Promise<PermissionState>) | undefined;
  getDirectoryHandle(name: string): Promise<KoboDirectoryHandle>;
  getFileHandle(name: string): Promise<KoboFileHandle>;
  entries?: (() => AsyncIterable<[string, KoboFileHandle | KoboDirectoryHandle]>) | undefined;
  values?: (() => AsyncIterable<KoboFileHandle | KoboDirectoryHandle>) | undefined;
}

export class KoboDirectoryError extends Error {
  code: string;

  constructor(message: string, options: { code?: string; cause?: unknown } = {}) {
    super(message);
    this.name = "KoboDirectoryError";
    this.code = options.code || KOBO_DIRECTORY_ERROR_CODES.generic;
    this.cause = options.cause;
  }
}

export function isFileSystemAccessSupported(
  scope: DirectoryPickerScope = globalThis as DirectoryPickerScope,
) {
  return typeof scope.showDirectoryPicker === "function";
}

export async function selectKoboDirectory(
  scope: DirectoryPickerScope = globalThis as DirectoryPickerScope,
): Promise<KoboDirectoryHandle> {
  if (!isFileSystemAccessSupported(scope)) {
    throw unsupportedBrowserError();
  }
  const showDirectoryPicker = scope.showDirectoryPicker;
  if (!showDirectoryPicker) {
    throw unsupportedBrowserError();
  }
  return showDirectoryPicker(DIRECTORY_PICKER_OPTIONS);
}

export async function ensureReadPermission(directoryHandle: KoboDirectoryHandle) {
  if (typeof directoryHandle.queryPermission === "function") {
    const state = await directoryHandle.queryPermission(READ_PERMISSION);
    if (state === "granted") {
      return;
    }
  }

  const requestPermission = directoryHandle.requestPermission;
  if (typeof requestPermission !== "function") {
    throw new KoboDirectoryError("Afterbook can only continue with read access.", {
      code: KOBO_DIRECTORY_ERROR_CODES.permissionDenied,
    });
  }

  const state = await requestPermission(READ_PERMISSION);
  if (state !== "granted") {
    throw new KoboDirectoryError("Afterbook can only continue with read access.", {
      code: KOBO_DIRECTORY_ERROR_CODES.permissionDenied,
    });
  }
}

export async function validateKoboDirectory(
  directoryHandle: KoboDirectoryHandle,
): Promise<KoboDirectoryHandle> {
  await ensureReadPermission(directoryHandle);
  await getRequiredFileHandle(directoryHandle, KOBO_DATABASE_PATH);
  return directoryHandle;
}

export async function readKoboSnapshot(directoryHandle: KoboDirectoryHandle): Promise<KoboFile[]> {
  await validateKoboDirectory(directoryHandle);
  const files = [await readRequiredFile(directoryHandle, KOBO_DATABASE_PATH)];

  for (const path of KOBO_DATABASE_SIDECAR_PATHS) {
    const sidecar = await readOptionalFile(directoryHandle, path);
    if (sidecar) {
      files.push(sidecar);
    }
  }

  return files;
}

export async function findCachedCover(
  directoryHandle: KoboDirectoryHandle,
  coverLocator: CoverCacheLocator | null | undefined,
): Promise<KoboFile | null> {
  if (!coverLocator) {
    return null;
  }

  for (const path of coverLocator.priority_candidates || []) {
    const file = await readOptionalFile(directoryHandle, path);
    if (file) {
      return file;
    }
  }

  let cacheDirectory: KoboDirectoryHandle;
  try {
    cacheDirectory = await getDirectoryHandleByPath(directoryHandle, coverLocator.directory);
  } catch (error) {
    if (isMissingHandleError(error)) {
      return null;
    }
    throw error;
  }

  let best: KoboFile | null = null;
  for await (const [name, handle] of directoryEntries(cacheDirectory)) {
    if (
      handle.kind === "file" &&
      name.startsWith(coverLocator.fallback_prefix) &&
      name.endsWith(coverLocator.parsed_suffix) &&
      isSafePathSegment(name)
    ) {
      const file = await readFileHandle(handle, joinRelativePath(coverLocator.directory, name));
      if (!best || file.bytes.byteLength > best.bytes.byteLength) {
        best = file;
      }
    }
  }
  return best;
}

export async function readRequiredFile(
  directoryHandle: KoboDirectoryHandle,
  relativePath: string,
): Promise<KoboFile> {
  const handle = await getRequiredFileHandle(directoryHandle, relativePath);
  return readFileHandle(handle, relativePath);
}

export async function readOptionalFile(
  directoryHandle: KoboDirectoryHandle,
  relativePath: string,
): Promise<KoboFile | null> {
  try {
    return await readRequiredFile(directoryHandle, relativePath);
  } catch (error) {
    if (isMissingHandleError(error)) {
      return null;
    }
    throw error;
  }
}

export async function getRequiredFileHandle(
  directoryHandle: KoboDirectoryHandle,
  relativePath: string,
): Promise<KoboFileHandle> {
  const segments = safeRelativePathSegments(relativePath);
  const filename = segments.pop();
  if (!filename) {
    throw new KoboDirectoryError("Invalid Kobo file path.", {
      code: KOBO_DIRECTORY_ERROR_CODES.invalidPath,
    });
  }
  const parent = await getDirectoryHandleBySegments(directoryHandle, segments);
  return parent.getFileHandle(filename);
}

export async function getDirectoryHandleByPath(
  directoryHandle: KoboDirectoryHandle,
  relativePath: string,
): Promise<KoboDirectoryHandle> {
  return getDirectoryHandleBySegments(directoryHandle, safeRelativePathSegments(relativePath));
}

async function getDirectoryHandleBySegments(
  directoryHandle: KoboDirectoryHandle,
  segments: readonly string[],
): Promise<KoboDirectoryHandle> {
  let current = directoryHandle;
  for (const segment of segments) {
    current = await current.getDirectoryHandle(segment);
  }
  return current;
}

export function safeRelativePathSegments(relativePath: string): string[] {
  if (typeof relativePath !== "string" || relativePath.trim() === "") {
    throw new KoboDirectoryError("Invalid Kobo file path.", {
      code: KOBO_DIRECTORY_ERROR_CODES.invalidPath,
    });
  }
  if (relativePath.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(relativePath)) {
    throw new KoboDirectoryError("Kobo file paths must be relative.", {
      code: KOBO_DIRECTORY_ERROR_CODES.invalidPath,
    });
  }
  const segments = relativePath.split("/").filter(Boolean);
  if (!segments.length || segments.some((segment) => !isSafePathSegment(segment))) {
    throw new KoboDirectoryError("Kobo file path escapes the selected directory.", {
      code: KOBO_DIRECTORY_ERROR_CODES.invalidPath,
    });
  }
  return segments;
}

function joinRelativePath(directory: string, filename: string): string {
  return safeRelativePathSegments(`${directory}/${filename}`).join("/");
}

function isSafePathSegment(segment: string): boolean {
  return segment !== "." && segment !== ".." && !segment.includes("/") && !segment.includes("\\");
}

async function readFileHandle(handle: KoboFileHandle, path: string): Promise<KoboFile> {
  const file = await handle.getFile();
  return {
    path,
    name: file.name || path.split("/").pop() || path,
    bytes: new Uint8Array(await file.arrayBuffer()),
  };
}

async function* directoryEntries(
  directoryHandle: KoboDirectoryHandle,
): AsyncIterable<[string, KoboFileHandle | KoboDirectoryHandle]> {
  if (typeof directoryHandle.entries === "function") {
    for await (const entry of directoryHandle.entries()) {
      yield entry;
    }
    return;
  }
  if (typeof directoryHandle.values !== "function") {
    return;
  }
  for await (const handle of directoryHandle.values()) {
    if (handle.name) {
      yield [handle.name, handle];
    }
  }
}

function unsupportedBrowserError(): KoboDirectoryError {
  return new KoboDirectoryError(APP_TEXT.unsupportedBrowser, {
    code: KOBO_DIRECTORY_ERROR_CODES.unsupportedBrowser,
  });
}

function isMissingHandleError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    ("name" in error || "code" in error) &&
    ((error as { name?: unknown }).name === DOM_EXCEPTION_NAMES.notFound ||
      (error as { code?: unknown }).code === KOBO_DIRECTORY_ERROR_CODES.notFound)
  );
}
