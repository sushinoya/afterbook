"""Machine-readable annotation archive embedded in generated EPUBs."""

from __future__ import annotations

from dataclasses import asdict
import json

from kobokeeps.models import Annotation, Book

ARCHIVE_SCHEMA_VERSION = 1


def archive_data(book: Book, annotations: list[Annotation]) -> dict[str, object]:
    """Return the allowlisted Kobo data preserved with an export."""
    return {
        "schema_version": ARCHIVE_SCHEMA_VERSION,
        "book": asdict(book),
        "annotations": [asdict(annotation) for annotation in annotations],
    }


def archive_json(book: Book, annotations: list[Annotation]) -> bytes:
    """Serialize the annotation archive as readable UTF-8 JSON."""
    return json.dumps(
        archive_data(book, annotations),
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    ).encode("utf-8")
