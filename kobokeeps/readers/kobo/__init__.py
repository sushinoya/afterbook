"""Kobo reader backend."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import cast

from kobokeeps.models import Book, JsonValue
from kobokeeps.readers.base import ReaderExport
from kobokeeps.readers.kobo.cover import load_cover
from kobokeeps.readers.kobo.database import KoboRepository, open_database, optional_text
from kobokeeps.readers.kobo.device import (
    KoboDevice,
    database_snapshot,
    local_output_directory,
    select_device,
)


@dataclass(slots=True)
class KoboReader:
    """A Kobo device exposed through the generic reader interface."""

    device: KoboDevice
    repository: KoboRepository

    id = "kobo"
    name = "Kobo"

    @property
    def root(self) -> Path:
        """Return the device mount root."""
        return self.device.root

    def list_books(self) -> list[Book]:
        """Return Kobo books with highlights or notes."""
        return self.repository.list_books()

    def export_for(self, book: Book) -> ReaderExport:
        """Return normalized Kobo export data plus raw SQLite rows."""
        raw_book = self.repository.raw_book_for(book)
        annotations = self.repository.annotations_for(book)
        raw_annotations = self.repository.raw_annotations_for(book)
        raw_context: dict[str, JsonValue] = {
            "chapters": cast(JsonValue, self.repository.raw_chapters_for(book))
        }
        image_id = optional_text(raw_book.get("ImageId"))
        return ReaderExport(
            reader_id=self.id,
            reader_name=self.name,
            book=book,
            annotations=annotations,
            raw_book=raw_book,
            raw_annotations=raw_annotations,
            raw_context=raw_context,
            cover=load_cover(self.device.root, image_id),
        )

    def resolve_output_directory(self, output_directory: Path) -> Path:
        """Resolve an output path that is not on the Kobo device."""
        return local_output_directory(output_directory, self.device.root)


@contextmanager
def open_kobo_reader(source_path: Path | None = None) -> Iterator[KoboReader]:
    """Open a Kobo reader backend against a local database snapshot."""
    device = select_device(source_path)
    with database_snapshot(device.database_path) as snapshot_path:
        connection = open_database(snapshot_path)
        try:
            yield KoboReader(device, KoboRepository(connection))
        finally:
            connection.close()
