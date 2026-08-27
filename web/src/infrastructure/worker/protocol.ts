import type { GeneratedEpub, ReaderId } from "../../domain/readers.js";
import type { LocalFile } from "../file-system/local-files.js";

export const AFTERBOOK_WORKER_NAME = "afterbook-annotation-engine";

export const WORKER_REQUESTS = {
  catalogAnnotations: "annotationExport.catalog",
  generateAnnotationEpub: "annotationExport.generateEpub",
} as const;

export const WORKER_RESPONSES = {
  success: "success",
  error: "error",
} as const;

export interface CatalogAnnotationsInput {
  readerId: ReaderId;
  files: LocalFile[];
}

export interface CatalogAnnotationsOutput {
  books: unknown[];
}

export interface GenerateAnnotationEpubInput {
  readerId: ReaderId;
  bookId: string;
  coverFile: LocalFile | null;
}

export type GenerateAnnotationEpubOutput = GeneratedEpub;

export type WorkerRequestType = (typeof WORKER_REQUESTS)[keyof typeof WORKER_REQUESTS];
export type WorkerResponseType = (typeof WORKER_RESPONSES)[keyof typeof WORKER_RESPONSES];

export interface WorkerRequest {
  id: number;
  type: WorkerRequestType;
  payload: unknown;
}

export interface WorkerResponse {
  id?: number;
  type?: WorkerResponseType;
  payload?: unknown;
  error?: {
    name?: string;
    message?: string;
    stack?: string;
  };
}
