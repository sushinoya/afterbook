import { describe, expect, it } from "vitest";

import { createAfterbookWorkerClient } from "../../src/infrastructure/worker/afterbook-worker-client.js";
import { WORKER_REQUESTS, WORKER_RESPONSES } from "../../src/infrastructure/worker/protocol.js";
import { KOBO_READER_ID } from "../../src/infrastructure/readers/kobo/types.js";

describe("Afterbook worker client", () => {
  it("sends catalog requests and transfers file buffers", async () => {
    const worker = new FakeWorker();
    const client = createAfterbookWorkerClient({ worker });
    const promise = client.catalogAnnotations({
      readerId: KOBO_READER_ID,
      files: [{ path: ".kobo/KoboReader.sqlite", name: "KoboReader.sqlite", bytes: bytes([1, 2]) }],
    });

    const message = worker.messages[0];
    expect(message?.type).toBe(WORKER_REQUESTS.catalogAnnotations);
    expect(worker.transfers[0]).toHaveLength(1);

    worker.reply({ id: message?.id, type: WORKER_RESPONSES.success, payload: { books: [] } });
    await expect(promise).resolves.toEqual({ books: [] });
  });

  it("converts generated EPUB buffers back to bytes", async () => {
    const worker = new FakeWorker();
    const client = createAfterbookWorkerClient({ worker });
    const promise = client.generateAnnotationEpub({
      readerId: KOBO_READER_ID,
      bookId: "book-id",
      coverFile: null,
    });

    const message = worker.messages[0];
    worker.reply({
      id: message?.id,
      type: WORKER_RESPONSES.success,
      payload: { filename: "Book.epub", data: bytes([80, 75]).buffer },
    });

    await expect(promise).resolves.toMatchObject({
      filename: "Book.epub",
      data: new Uint8Array([80, 75]),
    });
  });

  it("requests annotations for a selected book", async () => {
    const worker = new FakeWorker();
    const client = createAfterbookWorkerClient({ worker });
    const promise = client.listBookAnnotations({
      readerId: KOBO_READER_ID,
      bookId: "book-id",
    });

    const message = worker.messages[0];
    expect(message?.type).toBe(WORKER_REQUESTS.listBookAnnotations);
    expect(worker.transfers[0]).toHaveLength(0);

    worker.reply({
      id: message?.id,
      type: WORKER_RESPONSES.success,
      payload: { annotations: [{ source_id: "annotation-id" }] },
    });

    await expect(promise).resolves.toEqual({
      annotations: [{ source_id: "annotation-id" }],
    });
  });

  it("rejects pending work when the worker crashes", async () => {
    const worker = new FakeWorker();
    const client = createAfterbookWorkerClient({ worker });
    const promise = client.catalogAnnotations({ readerId: KOBO_READER_ID, files: [] });

    worker.emitError({ message: "worker exploded", filename: "worker.js", lineno: 10 });

    await expect(promise).rejects.toThrow(/worker exploded/);
    await expect(
      client.generateAnnotationEpub({ readerId: KOBO_READER_ID, bookId: "x", coverFile: null }),
    ).rejects.toThrow(/not available/);
  });
});

type MessageListener = (event: MessageEvent) => void;
type ErrorListener = (event: ErrorEvent) => void;

class FakeWorker {
  readonly messages: Array<{ id: number; type: string; payload: unknown }> = [];
  readonly transfers: Transferable[][] = [];
  private readonly messageListeners = new Set<MessageListener>();
  private readonly errorListeners = new Set<ErrorListener>();
  private readonly messageErrorListeners = new Set<() => void>();

  addEventListener(type: "message", listener: MessageListener): void;
  addEventListener(type: "error", listener: ErrorListener): void;
  addEventListener(type: "messageerror", listener: () => void): void;
  addEventListener(
    type: "message" | "error" | "messageerror",
    listener: MessageListener | ErrorListener | (() => void),
  ) {
    if (type === "message") {
      this.messageListeners.add(listener as MessageListener);
      return;
    }
    if (type === "error") {
      this.errorListeners.add(listener as ErrorListener);
      return;
    }
    this.messageErrorListeners.add(listener as () => void);
  }

  postMessage(message: { id: number; type: string; payload: unknown }, transfer: Transferable[]) {
    this.messages.push(message);
    this.transfers.push(transfer);
  }

  reply(data: unknown) {
    for (const listener of this.messageListeners) {
      listener({ data } as MessageEvent);
    }
  }

  emitError(event: { message?: string; filename?: string; lineno?: number }) {
    for (const listener of this.errorListeners) {
      listener(event as ErrorEvent);
    }
  }

  terminate() {}
}

function bytes(values: number[]) {
  return new Uint8Array(values);
}
