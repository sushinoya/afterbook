import {
  type AnnotationExportCapability,
  type ReaderBook,
  type ReaderConnection,
} from "../../../domain/readers.js";
import {
  type BrowserDirectoryHandle,
  type DirectoryPickerScope,
  type LocalFile,
  directoryEntries,
  getDirectoryByPath,
  isMissingFileSystemEntry,
  isSafePathSegment,
  pickReadableDirectory,
  readOptionalFile,
  readRequiredFile,
  safeRelativePathSegments,
} from "../../file-system/local-files.js";
import { createAfterbookWorkerClient, type AfterbookWorkerClient } from "../../worker/afterbook-worker-client.js";
import {
  KOBO_DATABASE_PATH,
  KOBO_DATABASE_SIDECAR_PATHS,
  KOBO_READER_ID,
  type KoboBookRecord,
  type KoboCoverLocator,
} from "./types.js";

export class KoboBrowserReaderAdapter {
  constructor(
    private readonly options: {
      pickerScope?: DirectoryPickerScope;
      workerClientFactory?: () => AfterbookWorkerClient;
    } = {},
  ) {}

  async connect(): Promise<ReaderConnection> {
    const directoryHandle = await pickReadableDirectory(this.options.pickerScope);
    await readRequiredFile(directoryHandle, KOBO_DATABASE_PATH);

    const workerClient = this.options.workerClientFactory?.() || createAfterbookWorkerClient();
    const capability = new KoboAnnotationExportCapability(directoryHandle, workerClient);

    return {
      id: crypto.randomUUID(),
      readerId: KOBO_READER_ID,
      label: directoryHandle.name || "Kobo eReader",
      connectedAt: new Date(),
      capabilities: {
        annotationExport: capability,
      },
    };
  }
}

class KoboAnnotationExportCapability implements AnnotationExportCapability {
  constructor(
    private readonly directoryHandle: BrowserDirectoryHandle,
    private readonly workerClient: AfterbookWorkerClient,
  ) {}

  async listBooks(): Promise<ReaderBook[]> {
    const files = await readKoboSnapshot(this.directoryHandle);
    const payload = await this.workerClient.catalogAnnotations({
      readerId: KOBO_READER_ID,
      files,
    });
    return parseKoboBooks(payload.books).map(koboBookToReaderBook);
  }

  async findCover(book: ReaderBook): Promise<LocalFile | null> {
    return findCachedCover(this.directoryHandle, book.coverHint);
  }

  async exportBook(book: ReaderBook, coverFile: LocalFile | null) {
    return this.workerClient.generateAnnotationEpub({
      readerId: KOBO_READER_ID,
      bookId: book.source.id,
      coverFile,
    });
  }
}

async function readKoboSnapshot(directoryHandle: BrowserDirectoryHandle): Promise<LocalFile[]> {
  const files = [await readRequiredFile(directoryHandle, KOBO_DATABASE_PATH)];

  for (const path of KOBO_DATABASE_SIDECAR_PATHS) {
    const sidecar = await readOptionalFile(directoryHandle, path);
    if (sidecar) {
      files.push(sidecar);
    }
  }

  return files;
}

async function findCachedCover(
  directoryHandle: BrowserDirectoryHandle,
  coverHint: unknown,
): Promise<LocalFile | null> {
  if (!isKoboCoverLocator(coverHint)) {
    return null;
  }

  for (const path of coverHint.priority_candidates || []) {
    const file = await readOptionalFile(directoryHandle, path);
    if (file) {
      return file;
    }
  }

  let coverDirectory: BrowserDirectoryHandle;
  try {
    coverDirectory = await getDirectoryByPath(directoryHandle, coverHint.directory);
  } catch (error) {
    if (isMissingFileSystemEntry(error)) {
      return null;
    }
    throw error;
  }

  let bestMatch: LocalFile | null = null;
  for await (const [name, handle] of directoryEntries(coverDirectory)) {
    if (
      handle.kind === "file" &&
      name.startsWith(coverHint.fallback_prefix) &&
      name.endsWith(coverHint.parsed_suffix) &&
      isSafePathSegment(name)
    ) {
      const path = joinRelativePath(coverHint.directory, name);
      const file = await readRequiredFile(directoryHandle, path);
      if (!bestMatch || file.bytes.byteLength > bestMatch.bytes.byteLength) {
        bestMatch = file;
      }
    }
  }
  return bestMatch;
}

function koboBookToReaderBook(book: KoboBookRecord): ReaderBook {
  return {
    id: `${KOBO_READER_ID}:${book.source_id}`,
    readerId: KOBO_READER_ID,
    title: book.title,
    author: book.author,
    subtitle: book.subtitle,
    metrics: {
      highlights: book.highlight_count,
      notes: book.note_count,
    },
    coverHint: book.cover,
    source: {
      id: book.source_id,
      format: "kobo",
    },
  };
}

function parseKoboBooks(value: unknown): KoboBookRecord[] {
  return Array.isArray(value) ? value.filter(isKoboBookRecord) : [];
}

function isKoboBookRecord(value: unknown): value is KoboBookRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const book = value as Partial<KoboBookRecord>;
  return (
    typeof book.source_id === "string" &&
    typeof book.title === "string" &&
    (typeof book.author === "string" || book.author === null) &&
    (typeof book.subtitle === "string" || book.subtitle === null) &&
    typeof book.highlight_count === "number" &&
    typeof book.note_count === "number" &&
    (book.cover === null || isKoboCoverLocator(book.cover))
  );
}

function isKoboCoverLocator(value: unknown): value is KoboCoverLocator {
  if (!value || typeof value !== "object") {
    return false;
  }
  const locator = value as Partial<KoboCoverLocator>;
  return (
    typeof locator.directory === "string" &&
    typeof locator.fallback_prefix === "string" &&
    typeof locator.parsed_suffix === "string" &&
    (locator.priority_candidates === undefined || Array.isArray(locator.priority_candidates))
  );
}

function joinRelativePath(directory: string, filename: string): string {
  return safeRelativePathSegments(`${directory}/${filename}`).join("/");
}
