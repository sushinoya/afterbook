"""Shared reader interfaces."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from kobokeeps.models import Annotation, Book, CoverImage, JsonValue


@dataclass(frozen=True, slots=True)
class ReaderExport:
    """Normalized export data plus source-reader raw data."""

    reader_id: str
    reader_name: str
    book: Book
    annotations: list[Annotation]
    raw_book: dict[str, JsonValue] = field(default_factory=dict)
    raw_annotations: list[dict[str, JsonValue]] = field(default_factory=list)
    raw_context: dict[str, JsonValue] = field(default_factory=dict)
    cover: CoverImage | None = None


class EbookReader(Protocol):
    """An ebook reader backend that can provide annotated books."""

    id: str
    name: str

    def list_books(self) -> list[Book]:
        """Return books with exported annotations."""

    def export_for(self, book: Book) -> ReaderExport:
        """Return normalized and raw export data for one book."""

    def resolve_output_directory(self, output_directory: Path) -> Path:
        """Resolve a safe output directory for exports."""
