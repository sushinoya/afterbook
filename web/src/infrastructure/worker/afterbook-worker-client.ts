import type {
  CatalogAnnotationsInput,
  CatalogAnnotationsOutput,
  GenerateAnnotationEpubInput,
  GenerateAnnotationEpubOutput,
  ListBookAnnotationsInput,
  ListBookAnnotationsOutput,
  WorkerRequest,
  WorkerRequestType,
  WorkerResponse,
} from "./protocol.js";
import {
  AFTERBOOK_WORKER_NAME,
  WORKER_REQUESTS,
  WORKER_RESPONSES,
} from "./protocol.js";
import type { LocalFile } from "../file-system/local-files.js";
import PyodideWorker from "./pyodide.worker.ts?worker";

export interface AfterbookWorkerClient {
  catalogAnnotations(input: CatalogAnnotationsInput): Promise<CatalogAnnotationsOutput>;
  listBookAnnotations(input: ListBookAnnotationsInput): Promise<ListBookAnnotationsOutput>;
  generateAnnotationEpub(input: GenerateAnnotationEpubInput): Promise<GenerateAnnotationEpubOutput>;
  terminate(): void;
}

interface WorkerLike {
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  addEventListener(type: "messageerror", listener: () => void): void;
  postMessage(message: WorkerRequest, transfer: Transferable[]): void;
  terminate(): void;
}

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
};

export class AfterbookWorkerError extends Error {
  constructor(
    message: string,
    readonly details: unknown = {},
  ) {
    super(message);
    this.name = "AfterbookWorkerError";
  }
}

export function createAfterbookWorkerClient(
  options: {
    worker?: WorkerLike;
  } = {},
): AfterbookWorkerClient {
  const worker: WorkerLike =
    options.worker ||
    (new PyodideWorker({
      name: AFTERBOOK_WORKER_NAME,
    }) as WorkerLike);

  let nextRequestId = 1;
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

    if (message.type === WORKER_RESPONSES.error) {
      request.reject(workerResponseError(message.error));
      return;
    }

    if (message.type !== WORKER_RESPONSES.success) {
      request.reject(new AfterbookWorkerError("Afterbook worker returned an invalid response.", message));
      return;
    }

    request.resolve(normalizePayload(message.payload));
  });

  worker.addEventListener("error", (event) => {
    closed = true;
    rejectPending(
      new AfterbookWorkerError(event.message || "Afterbook worker crashed.", {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      }),
    );
  });

  worker.addEventListener("messageerror", () => {
    closed = true;
    rejectPending(new AfterbookWorkerError("Afterbook worker returned an unreadable message."));
  });

  function request<T>(type: WorkerRequestType, payload: unknown, transfer: Transferable[]) {
    if (closed) {
      return Promise.reject(new AfterbookWorkerError("Afterbook worker is not available."));
    }

    const id = nextRequestId;
    nextRequestId += 1;

    const promise = new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: (value) => resolve(value as T), reject });
    });

    try {
      worker.postMessage({ id, type, payload }, transfer);
    } catch (error) {
      pending.delete(id);
      return Promise.reject(
        new AfterbookWorkerError(errorMessage(error) || "Afterbook worker request failed.", error),
      );
    }
    return promise;
  }

  function rejectPending(error: Error) {
    for (const request of pending.values()) {
      request.reject(error);
    }
    pending.clear();
  }

  return {
    catalogAnnotations(input) {
      return request<CatalogAnnotationsOutput>(
        WORKER_REQUESTS.catalogAnnotations,
        input,
        transferableFiles(input.files),
      );
    },
    listBookAnnotations(input) {
      return request<ListBookAnnotationsOutput>(
        WORKER_REQUESTS.listBookAnnotations,
        input,
        [],
      );
    },
    generateAnnotationEpub(input) {
      return request<GenerateAnnotationEpubOutput>(
        WORKER_REQUESTS.generateAnnotationEpub,
        input,
        input.coverFile ? transferableFiles([input.coverFile]) : [],
      );
    },
    terminate() {
      closed = true;
      worker.terminate();
      rejectPending(new AfterbookWorkerError("Afterbook worker was terminated."));
    },
  };
}

export function transferableFiles(files: readonly LocalFile[]): Transferable[] {
  return files.map((file) => transferableBuffer(file.bytes));
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

function workerResponseError(error: WorkerResponse["error"]) {
  return new AfterbookWorkerError(error?.message || "Afterbook worker failed.", error);
}

function errorMessage(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : undefined;
}
