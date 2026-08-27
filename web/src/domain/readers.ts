import type { LocalFile } from "../infrastructure/file-system/local-files.js";

export type ReaderId = string;

export const READER_CAPABILITIES = {
  annotationExport: "annotation-export",
} as const;

export type ReaderCapabilityId =
  (typeof READER_CAPABILITIES)[keyof typeof READER_CAPABILITIES];

export interface ReaderDefinition {
  id: ReaderId;
  name: string;
  vendor: string;
  connectionLabel: string;
  capabilities: readonly ReaderCapabilityId[];
  adapter: BrowserReaderAdapter;
}

export interface BrowserReaderAdapter {
  connect(): Promise<ReaderConnection>;
}

export interface ReaderConnection {
  id: string;
  readerId: ReaderId;
  label: string;
  connectedAt: Date;
  capabilities: {
    annotationExport: AnnotationExportCapability;
  };
}

export interface AnnotationExportCapability {
  listBooks(): Promise<ReaderBook[]>;
  listAnnotations(book: ReaderBook): Promise<ReaderAnnotation[]>;
  findCover(book: ReaderBook): Promise<LocalFile | null>;
  exportBook(book: ReaderBook, coverFile: LocalFile | null): Promise<GeneratedEpub>;
}

export interface ReaderBook {
  id: string;
  readerId: ReaderId;
  title: string;
  author: string | null;
  subtitle: string | null;
  metrics: AnnotationMetrics;
  coverHint: unknown;
  source: {
    id: string;
    format: string;
  };
}

export interface AnnotationMetrics {
  highlights: number;
  notes: number;
}

export interface ReaderAnnotation {
  id: string;
  text: string;
  note: string;
  colorName: string | null;
  colorHex: string | null;
  kind: string | null;
  createdAt: string | null;
  modifiedAt: string | null;
  location: {
    chapter: string;
    progress: number;
    locator: string | null;
    page: string | number | null;
  };
}

export interface GeneratedEpub {
  filename: string;
  data: Uint8Array;
}
