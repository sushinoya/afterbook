"""Programmatic AfterBook helpers for browser and embedded callers."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import TypedDict

from afterbook.epub import epub_bytes, epub_filename
from afterbook.errors import AfterBookError
from afterbook.models import Annotation, Book
from afterbook.readers.kobo import open_kobo_reader
from afterbook.readers.kobo.cover import CoverCacheLocator
from afterbook.readers.kobo.device import DATABASE_RELATIVE_PATH
from afterbook.selection import book_by_id


class KoboBookMapping(TypedDict):
    """JSON-compatible book metadata returned to browser callers."""

    source_id: str
    title: str
    author: str | None
    subtitle: str | None
    highlight_count: int
    note_count: int
    cover: CoverCacheLocator | None


class KoboAnnotationLocationMapping(TypedDict):
    """JSON-compatible annotation location returned to browser callers."""

    chapter: str
    progress: float
    locator: str | None
    page: str | int | None


class KoboAnnotationMapping(TypedDict):
    """JSON-compatible annotation details returned to browser callers."""

    source_id: str | None
    text: str
    note: str
    color_name: str | None
    color_hex: str | None
    kind: str | None
    created_at: str | None
    modified_at: str | None
    location: KoboAnnotationLocationMapping


@dataclass(frozen=True, slots=True)
class GeneratedEpub:
    """A generated clipping EPUB that has not been written to local storage."""

    filename: str
    data: bytes


def validate_kobo_directory(source_path: str | Path) -> Path:
    """Return a Kobo root containing the reader database."""
    root = Path(source_path)
    database_path = root / DATABASE_RELATIVE_PATH
    if not database_path.is_file():
        raise AfterBookError(f"No Kobo database found at {root}")
    return root


def book_to_mapping(
    book: Book,
    *,
    cover_locator: CoverCacheLocator | None = None,
) -> KoboBookMapping:
    """Return a JSON-compatible browser view of a book."""
    return {
        "source_id": book.source_id,
        "title": book.title,
        "author": book.author,
        "subtitle": book.subtitle,
        "highlight_count": book.highlight_count,
        "note_count": book.note_count,
        "cover": cover_locator,
    }


def annotation_to_mapping(annotation: Annotation) -> KoboAnnotationMapping:
    """Return a JSON-compatible browser view of an annotation."""
    return {
        "source_id": annotation.source_id,
        "text": annotation.text,
        "note": annotation.note,
        "color_name": annotation.color_name,
        "color_hex": annotation.color_hex,
        "kind": annotation.kind,
        "created_at": annotation.created_at,
        "modified_at": annotation.modified_at,
        "location": {
            "chapter": annotation.location.chapter,
            "progress": annotation.location.progress,
            "locator": annotation.location.locator,
            "page": annotation.location.page,
        },
    }


def list_kobo_books(source_path: str | Path) -> list[KoboBookMapping]:
    """List Kobo books with highlights or notes from a staged Kobo root."""
    root = validate_kobo_directory(source_path)
    with open_kobo_reader(root) as reader:
        books = reader.list_books()
        return [
            book_to_mapping(
                book,
                cover_locator=reader.cover_locator_for(book),
            )
            for book in books
        ]


def list_kobo_book_annotations(
    source_path: str | Path,
    book_source_id: str,
) -> list[KoboAnnotationMapping]:
    """List normalized Kobo annotations for one book from a staged Kobo root."""
    root = validate_kobo_directory(source_path)
    with open_kobo_reader(root) as reader:
        book = book_by_id(reader.list_books(), book_source_id)
        return [annotation_to_mapping(annotation) for annotation in reader.export_for(book).annotations]


def generate_kobo_epub(source_path: str | Path, book_source_id: str) -> GeneratedEpub:
    """Generate one Kobo clipping EPUB from a staged Kobo root."""
    root = validate_kobo_directory(source_path)
    with open_kobo_reader(root) as reader:
        book = book_by_id(reader.list_books(), book_source_id)
        export = reader.export_for(book)
    return GeneratedEpub(filename=epub_filename(export), data=epub_bytes(export))
