import {
  WORKER_MESSAGE_TYPES,
  WORKER_MODULE_PATH,
  WORKER_NAME,
  WORKER_RESPONSE_TYPES,
} from "./constants.js";
import type { KoboFile } from "./kobo-files.js";

export interface WorkerErrorDetails {
  error?: unknown;
  message?: unknown;
}

export class AfterbookWorkerError extends Error {
  details: WorkerErrorDetails;

  constructor(message: string, details: WorkerErrorDetails = {}) {
    super(message);
    this.name = "AfterbookWorkerError";
    this.details = details;
  }
}

export interface ListedBooksPayload {
  books?: unknown[];
}

export interface GeneratedEpubPayload {
  filename: string;
  data: Uint8Array;
}

export interface AfterbookClient {
  loadSnapshot(files: KoboFile[]): Promise<ListedBooksPayload>;
  exportBook(bookId: string, coverFile: KoboFile | null): Promise<GeneratedEpubPayload>;
  terminate(): void;
}

interface WorkerConstructor {
  new (
    url: string | URL,
    options: { type: "module"; name: string },
  ): WorkerLike;
}

interface WorkerLike {
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  addEventListener(type: "messageerror", listener: () => void): void;
  postMessage(message: WorkerRequest, transfer: Transferable[]): void;
  terminate(): void;
}

interface WorkerRequest {
  id: number;
  type: WorkerRequestType;
  payload: unknown;
}

interface WorkerResponse {
  id?: number;
  type?: WorkerResponseType;
  payload?: unknown;
  error?: { message?: string };
}

type WorkerRequestType = (typeof WORKER_MESSAGE_TYPES)[keyof typeof WORKER_MESSAGE_TYPES];
type WorkerResponseType = (typeof WORKER_RESPONSE_TYPES)[keyof typeof WORKER_RESPONSE_TYPES];

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
};

export function createAfterbookClient(options: {
  WorkerConstructor?: WorkerConstructor;
  workerUrl?: string | URL;
  worker?: WorkerLike;
} = {}): AfterbookClient {
  const WorkerConstructor = options.WorkerConstructor || (globalThis.Worker as WorkerConstructor);
  const workerUrl = options.workerUrl || new URL(WORKER_MODULE_PATH, import.meta.url);
  const worker =
    options.worker ||
    new WorkerConstructor(workerUrl, {
      type: "module",
      name: WORKER_NAME,
    });
  let nextId = 1;
  let closed = false;
  const pending = new Map<number, PendingRequest>();

  worker.addEventListener("message", (event) => {
    const message = (event.data || {}) as WorkerResponse;
    if (typeof message.id !== "number") {
      return;
    }
    const request = pending.get(message.id);
    if (!request) {
      return;
    }
    pending.delete(message.id);

    if (message.type === WORKER_RESPONSE_TYPES.error) {
      request.reject(workerResponseError(message.error));
      return;
    }

    if (message.type !== WORKER_RESPONSE_TYPES.success) {
      request.reject(
        new AfterbookWorkerError("Afterbook worker sent an invalid response.", {
          message,
        }),
      );
      return;
    }

    request.resolve(normalizePayload(message.payload));
  });

  worker.addEventListener("error", (event) => {
    closed = true;
    rejectPending(
      new AfterbookWorkerError(event.message || "Afterbook worker crashed.", {
        error: {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          message: event.message,
        },
      }),
    );
  });

  worker.addEventListener("messageerror", () => {
    closed = true;
    rejectPending(new AfterbookWorkerError("Afterbook worker sent an unreadable response."));
  });

  function request<T>(type: WorkerRequest["type"], payload = {}, transfer: Transferable[] = []) {
    if (closed) {
      return Promise.reject(new AfterbookWorkerError("Afterbook worker is not available."));
    }
    const id = nextId;
    nextId += 1;
    const promise = new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: (value) => resolve(value as T), reject });
    });
    try {
      worker.postMessage({ id, type, payload }, transfer);
    } catch (error) {
      pending.delete(id);
      return Promise.reject(
        new AfterbookWorkerError(errorMessage(error) || "Afterbook worker request failed.", {
          error,
        }),
      );
    }
    return promise;
  }

  function rejectPending(error: AfterbookWorkerError) {
    for (const request of pending.values()) {
      request.reject(error);
    }
    pending.clear();
  }

  return {
    loadSnapshot(files) {
      return request<ListedBooksPayload>(
        WORKER_MESSAGE_TYPES.loadSnapshot,
        { files },
        transferableFiles(files),
      );
    },
    exportBook(bookId, coverFile) {
      const payload = { bookId, coverFile };
      const transfer = coverFile ? transferableFiles([coverFile]) : [];
      return request<GeneratedEpubPayload>(WORKER_MESSAGE_TYPES.exportBook, payload, transfer);
    },
    terminate() {
      closed = true;
      worker.terminate();
      rejectPending(new AfterbookWorkerError("Afterbook worker was terminated."));
    },
  };
}

export function transferableFiles(files: KoboFile[]): Transferable[] {
  return files
    .map((file) => file.bytes)
    .filter((bytes) => bytes instanceof Uint8Array)
    .map((bytes) => transferableBuffer(bytes));
}

function normalizePayload(payload: unknown): unknown {
  if (hasArrayBufferData(payload)) {
    return { ...payload, data: new Uint8Array(payload.data) };
  }
  return payload;
}

function hasArrayBufferData(payload: unknown): payload is { data: ArrayBuffer } {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { data?: unknown }).data instanceof ArrayBuffer
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

function workerResponseError(error: { message?: string } | undefined) {
  return new AfterbookWorkerError(error?.message || "Afterbook worker failed.", {
    error,
  });
}

function errorMessage(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : undefined;
}
