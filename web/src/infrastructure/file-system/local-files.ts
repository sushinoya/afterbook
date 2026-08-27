import { ReaderConnectionError } from "../../domain/errors.js";

export interface LocalFile {
  path: string;
  name: string;
  bytes: Uint8Array;
}

export interface BrowserFileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
}

export interface BrowserDirectoryHandle {
  kind?: "directory";
  name?: string;
  queryPermission?: ((descriptor: typeof READ_PERMISSION) => Promise<PermissionState>) | undefined;
  requestPermission?: ((descriptor: typeof READ_PERMISSION) => Promise<PermissionState>) | undefined;
  getDirectoryHandle(name: string): Promise<BrowserDirectoryHandle>;
  getFileHandle(name: string): Promise<BrowserFileHandle>;
  entries?: (() => AsyncIterable<[string, BrowserDirectoryEntry]>) | undefined;
  values?: (() => AsyncIterable<BrowserDirectoryEntry>) | undefined;
}

export type BrowserDirectoryEntry = BrowserFileHandle | BrowserDirectoryHandle;

export interface DirectoryPickerScope {
  showDirectoryPicker?: (
    options: typeof DIRECTORY_PICKER_OPTIONS,
  ) => Promise<BrowserDirectoryHandle>;
}

export const DIRECTORY_PICKER_OPTIONS = {
  id: "afterbook-reader-source",
  mode: "read",
} as const;

export const READ_PERMISSION = {
  mode: "read",
} as const;

export async function pickReadableDirectory(
  scope: DirectoryPickerScope = globalThis as DirectoryPickerScope,
): Promise<BrowserDirectoryHandle> {
  const pickDirectory = scope.showDirectoryPicker;
  if (!pickDirectory) {
    throw new ReaderConnectionError(
      "This browser cannot connect to a local reader source.",
      "unsupported-browser",
    );
  }

  const directoryHandle = await pickDirectory(DIRECTORY_PICKER_OPTIONS);
  await ensureReadPermission(directoryHandle);
  return directoryHandle;
}

export async function ensureReadPermission(directoryHandle: BrowserDirectoryHandle) {
  if (typeof directoryHandle.queryPermission === "function") {
    const state = await directoryHandle.queryPermission(READ_PERMISSION);
    if (state === "granted") {
      return;
    }
  }

  const requestPermission = directoryHandle.requestPermission;
  if (!requestPermission) {
    throw new ReaderConnectionError(
      "Afterbook can only continue with read access to the reader source.",
      "permission-denied",
    );
  }

  const state = await requestPermission(READ_PERMISSION);
  if (state !== "granted") {
    throw new ReaderConnectionError(
      "Afterbook can only continue with read access to the reader source.",
      "permission-denied",
    );
  }
}

export async function readRequiredFile(
  directoryHandle: BrowserDirectoryHandle,
  relativePath: string,
): Promise<LocalFile> {
  const handle = await getRequiredFileHandle(directoryHandle, relativePath);
  return readFileHandle(handle, relativePath);
}

export async function readOptionalFile(
  directoryHandle: BrowserDirectoryHandle,
  relativePath: string,
): Promise<LocalFile | null> {
  try {
    return await readRequiredFile(directoryHandle, relativePath);
  } catch (error) {
    if (isMissingFileSystemEntry(error)) {
      return null;
    }
    throw error;
  }
}

export async function getDirectoryByPath(
  directoryHandle: BrowserDirectoryHandle,
  relativePath: string,
): Promise<BrowserDirectoryHandle> {
  let current = directoryHandle;
  for (const segment of safeRelativePathSegments(relativePath)) {
    current = await current.getDirectoryHandle(segment);
  }
  return current;
}

export async function* directoryEntries(
  directoryHandle: BrowserDirectoryHandle,
): AsyncIterable<[string, BrowserDirectoryEntry]> {
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

export function safeRelativePathSegments(relativePath: string): string[] {
  if (typeof relativePath !== "string" || relativePath.trim() === "") {
    throw new ReaderConnectionError("Reader file paths must not be empty.", "invalid-path");
  }
  if (relativePath.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(relativePath)) {
    throw new ReaderConnectionError("Reader file paths must be relative.", "invalid-path");
  }

  const segments = relativePath.split("/").filter(Boolean);
  if (!segments.length || segments.some((segment) => !isSafePathSegment(segment))) {
    throw new ReaderConnectionError(
      "Reader file paths must stay inside the selected source.",
      "invalid-path",
    );
  }
  return segments;
}

export function isSafePathSegment(segment: string): boolean {
  return segment !== "." && segment !== ".." && !segment.includes("/") && !segment.includes("\\");
}

export function isMissingFileSystemEntry(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    ((error as { name?: unknown }).name === "NotFoundError" ||
      (error as { code?: unknown }).code === "not-found")
  );
}

async function getRequiredFileHandle(
  directoryHandle: BrowserDirectoryHandle,
  relativePath: string,
): Promise<BrowserFileHandle> {
  const segments = safeRelativePathSegments(relativePath);
  const filename = segments.pop();
  if (!filename) {
    throw new ReaderConnectionError("Reader file paths must include a file name.", "invalid-path");
  }

  let parent = directoryHandle;
  for (const segment of segments) {
    parent = await parent.getDirectoryHandle(segment);
  }
  return parent.getFileHandle(filename);
}

async function readFileHandle(handle: BrowserFileHandle, path: string): Promise<LocalFile> {
  const file = await handle.getFile();
  return {
    path,
    name: file.name || path.split("/").pop() || path,
    bytes: new Uint8Array(await file.arrayBuffer()),
  };
}
