export class AfterbookWorkerError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "AfterbookWorkerError";
    this.details = details;
  }
}

export function createAfterbookClient(options = {}) {
  const WorkerConstructor = options.WorkerConstructor || globalThis.Worker;
  const workerUrl = options.workerUrl || new URL("./pyodide-worker.js", import.meta.url);
  const worker =
    options.worker ||
    new WorkerConstructor(workerUrl, {
      type: "module",
      name: "afterbook-pyodide",
    });
  let nextId = 1;
  let closed = false;
  const pending = new Map();

  worker.addEventListener("message", (event) => {
    const message = event.data || {};
    const request = pending.get(message.id);
    if (!request) {
      return;
    }
    pending.delete(message.id);

    if (message.type === "error") {
      request.reject(workerResponseError(message.error));
      return;
    }

    if (message.type !== "success") {
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

  function request(type, payload = {}, transfer = []) {
    if (closed) {
      return Promise.reject(new AfterbookWorkerError("Afterbook worker is not available."));
    }
    const id = nextId;
    nextId += 1;
    const promise = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
    try {
      worker.postMessage({ id, type, payload }, transfer);
    } catch (error) {
      pending.delete(id);
      return Promise.reject(
        new AfterbookWorkerError(error?.message || "Afterbook worker request failed.", {
          error,
        }),
      );
    }
    return promise;
  }

  function rejectPending(error) {
    for (const request of pending.values()) {
      request.reject(error);
    }
    pending.clear();
  }

  return {
    loadSnapshot(files) {
      return request("loadSnapshot", { files }, transferableFiles(files));
    },
    exportBook(bookId, coverFile) {
      const payload = { bookId, coverFile };
      const transfer = coverFile ? transferableFiles([coverFile]) : [];
      return request("exportBook", payload, transfer);
    },
    terminate() {
      closed = true;
      worker.terminate();
      rejectPending(new AfterbookWorkerError("Afterbook worker was terminated."));
    },
  };
}

export function transferableFiles(files) {
  return files
    .map((file) => file.bytes)
    .filter((bytes) => bytes instanceof Uint8Array)
    .map((bytes) => bytes.buffer);
}

function normalizePayload(payload) {
  if (payload?.data instanceof ArrayBuffer) {
    return { ...payload, data: new Uint8Array(payload.data) };
  }
  return payload;
}

function workerResponseError(error) {
  return new AfterbookWorkerError(error?.message || "Afterbook worker failed.", {
    error,
  });
}
