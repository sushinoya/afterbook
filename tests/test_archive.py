from __future__ import annotations

import json

from afterbook.archive import archive_json
from afterbook.models import Annotation, AnnotationLocation, Book
from afterbook.readers.base import ReaderExport


def test_archive_preserves_normalized_and_raw_reader_data() -> None:
    book = Book("reader-book-id", "Book", author="Author", language="en")
    annotation = Annotation(
        source_id="reader-annotation-id",
        text="Highlighted text",
        note="My note",
        location=AnnotationLocation(
            chapter="Chapter",
            chapter_index=2,
            progress=0.5,
            locator="reader-location",
            locator_type="reader-locator",
        ),
        color_name="reader-color",
        color_hex="#AABBCC",
        kind="highlight",
        created_at="2024-01-25T22:00:00",
    )
    export = ReaderExport(
        reader_id="reader",
        reader_name="Reader",
        book=book,
        annotations=[annotation],
        raw_book={"raw_book_id": "reader-book-id", "reader_field": 7},
        raw_annotations=[{"raw_annotation_id": "reader-annotation-id"}],
        raw_context={"chapters": [{"raw_chapter_id": "chapter-id"}]},
    )

    archive = json.loads(archive_json(export))
    normalized_book = archive["normalized"]["book"]
    normalized_annotations = archive["normalized"]["annotations"]

    assert archive["schema_version"] == 2
    assert archive["reader"] == {"id": "reader", "name": "Reader"}
    assert normalized_book["source_id"] == "reader-book-id"
    assert normalized_annotations[0]["location"]["locator_type"] == "reader-locator"
    assert normalized_annotations[0]["color_hex"] == "#AABBCC"
    assert archive["raw"]["book"]["reader_field"] == 7
    assert archive["raw"]["annotations"] == [{"raw_annotation_id": "reader-annotation-id"}]
    assert archive["raw"]["context"] == {"chapters": [{"raw_chapter_id": "chapter-id"}]}
