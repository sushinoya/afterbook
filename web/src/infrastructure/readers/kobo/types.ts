export const KOBO_READER_ID = "kobo" as const;
export const KOBO_DATABASE_PATH = ".kobo/KoboReader.sqlite";
export const KOBO_DATABASE_SIDECAR_PATHS = [
  ".kobo/KoboReader.sqlite-wal",
  ".kobo/KoboReader.sqlite-shm",
] as const;

export interface KoboCoverLocator {
  directory: string;
  priority_candidates?: readonly string[];
  fallback_prefix: string;
  parsed_suffix: string;
}

export interface KoboBookRecord {
  source_id: string;
  title: string;
  author: string | null;
  subtitle: string | null;
  highlight_count: number;
  note_count: number;
  cover: KoboCoverLocator | null;
}

export interface KoboAnnotationRecord {
  source_id: string | null;
  text: string;
  note: string;
  color_name: string | null;
  color_hex: string | null;
  kind: string | null;
  created_at: string | null;
  modified_at: string | null;
  location: {
    chapter: string;
    progress: number;
    locator: string | null;
    page: string | number | null;
  };
}
