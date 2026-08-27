export const KOBO_DATABASE_PATH = ".kobo/KoboReader.sqlite";
export const KOBO_DATABASE_SIDECAR_PATHS = [
  ".kobo/KoboReader.sqlite-wal",
  ".kobo/KoboReader.sqlite-shm",
];
const READ_PERMISSION = { mode: "read" };

export class KoboDirectoryError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "KoboDirectoryError";
    this.code = options.code || "kobo-directory-error";
    this.cause = options.cause;
  }
}

export function isFileSystemAccessSupported(scope = globalThis) {
  return typeof scope.showDirectoryPicker === "function";
}

export async function selectKoboDirectory(scope = globalThis) {
  if (!isFileSystemAccessSupported(scope)) {
    throw new KoboDirectoryError(
      "Afterbook needs Chrome or Edge on desktop so it can read your Kobo drive.",
      { code: "unsupported-browser" },
    );
  }
  return scope.showDirectoryPicker({ id: "afterbook-kobo", mode: "read" });
}

export async function ensureReadPermission(directoryHandle) {
  if (typeof directoryHandle.queryPermission === "function") {
    const state = await directoryHandle.queryPermission(READ_PERMISSION);
    if (state === "granted") {
      return;
    }
  }

  if (typeof directoryHandle.requestPermission !== "function") {
    throw new KoboDirectoryError("Afterbook can only continue with read access.", {
      code: "permission-denied",
    });
  }

  const state = await directoryHandle.requestPermission(READ_PERMISSION);
  if (state !== "granted") {
    throw new KoboDirectoryError("Afterbook can only continue with read access.", {
      code: "permission-denied",
    });
  }
}

export async function validateKoboDirectory(directoryHandle) {
  await ensureReadPermission(directoryHandle);
  await getRequiredFileHandle(directoryHandle, KOBO_DATABASE_PATH);
  return directoryHandle;
}

export async function readKoboSnapshot(directoryHandle) {
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

export async function findCachedCover(directoryHandle, coverLocator) {
  if (!coverLocator) {
    return null;
  }

  for (const path of coverLocator.priority_candidates || []) {
    const file = await readOptionalFile(directoryHandle, path);
    if (file) {
      return file;
    }
  }

  let cacheDirectory;
  try {
    cacheDirectory = await getDirectoryHandleByPath(directoryHandle, coverLocator.directory);
  } catch (error) {
    if (isMissingHandleError(error)) {
      return null;
    }
    throw error;
  }

  let best = null;
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

export async function readRequiredFile(directoryHandle, relativePath) {
  const handle = await getRequiredFileHandle(directoryHandle, relativePath);
  return readFileHandle(handle, relativePath);
}

export async function readOptionalFile(directoryHandle, relativePath) {
  try {
    return await readRequiredFile(directoryHandle, relativePath);
  } catch (error) {
    if (isMissingHandleError(error)) {
      return null;
    }
    throw error;
  }
}

export async function getRequiredFileHandle(directoryHandle, relativePath) {
  const segments = safeRelativePathSegments(relativePath);
  const filename = segments.pop();
  const parent = await getDirectoryHandleBySegments(directoryHandle, segments);
  return parent.getFileHandle(filename);
}

export async function getDirectoryHandleByPath(directoryHandle, relativePath) {
  return getDirectoryHandleBySegments(directoryHandle, safeRelativePathSegments(relativePath));
}

async function getDirectoryHandleBySegments(directoryHandle, segments) {
  let current = directoryHandle;
  for (const segment of segments) {
    current = await current.getDirectoryHandle(segment);
  }
  return current;
}

export function safeRelativePathSegments(relativePath) {
  if (typeof relativePath !== "string" || relativePath.trim() === "") {
    throw new KoboDirectoryError("Invalid Kobo file path.", { code: "invalid-path" });
  }
  if (relativePath.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(relativePath)) {
    throw new KoboDirectoryError("Kobo file paths must be relative.", { code: "invalid-path" });
  }
  const segments = relativePath.split("/").filter(Boolean);
  if (!segments.length || segments.some((segment) => !isSafePathSegment(segment))) {
    throw new KoboDirectoryError("Kobo file path escapes the selected directory.", {
      code: "invalid-path",
    });
  }
  return segments;
}

function joinRelativePath(directory, filename) {
  return safeRelativePathSegments(`${directory}/${filename}`).join("/");
}

function isSafePathSegment(segment) {
  return segment !== "." && segment !== ".." && !segment.includes("/") && !segment.includes("\\");
}

async function readFileHandle(handle, path) {
  const file = await handle.getFile();
  return {
    path,
    name: file.name || path.split("/").pop(),
    bytes: new Uint8Array(await file.arrayBuffer()),
  };
}

async function* directoryEntries(directoryHandle) {
  if (typeof directoryHandle.entries === "function") {
    for await (const entry of directoryHandle.entries()) {
      yield entry;
    }
    return;
  }
  for await (const handle of directoryHandle.values()) {
    yield [handle.name, handle];
  }
}

function isMissingHandleError(error) {
  return error && (error.name === "NotFoundError" || error.code === "not-found");
}
