import { READER_CAPABILITIES, type ReaderDefinition } from "../../domain/readers.js";
import { KoboBrowserReaderAdapter } from "./kobo/browser-reader-adapter.js";
import { KOBO_READER_ID } from "./kobo/types.js";

export function createReaderRegistry(): readonly ReaderDefinition[] {
  return [
    {
      id: KOBO_READER_ID,
      name: "Kobo eReader",
      vendor: "Kobo",
      connectionLabel: "Kobo eReader folder",
      capabilities: [READER_CAPABILITIES.annotationExport],
      adapter: new KoboBrowserReaderAdapter(),
    },
  ];
}
