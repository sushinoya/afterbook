"""Machine-readable annotation archive embedded in generated EPUBs."""

from __future__ import annotations

import json
from dataclasses import asdict

from afterbook.readers.base import ReaderExport

ARCHIVE_SCHEMA_VERSION = 2


def archive_json(export: ReaderExport) -> bytes:
    """Serialize the annotation archive as readable UTF-8 JSON."""
    return json.dumps(
        {
            "schema_version": ARCHIVE_SCHEMA_VERSION,
            "reader": {
                "id": export.reader_id,
                "name": export.reader_name,
            },
            "normalized": {
                "book": asdict(export.book),
                "annotations": [asdict(annotation) for annotation in export.annotations],
            },
            "raw": {
                "book": export.raw_book,
                "annotations": export.raw_annotations,
                "context": export.raw_context,
            },
        },
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    ).encode("utf-8")
