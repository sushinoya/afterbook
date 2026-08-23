from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from afterbook.errors import AfterBookError
from afterbook.readers import open_reader, supported_reader_ids


def test_kobo_reader_backend_lists_books(kobo_database: Path, tmp_path: Path) -> None:
    device_root = tmp_path / "KOBOeReader"
    database_directory = device_root / ".kobo"
    database_directory.mkdir(parents=True)
    shutil.copyfile(kobo_database, database_directory / "KoboReader.sqlite")

    with open_reader("kobo", device_root) as reader:
        books = reader.list_books()
        export = reader.export_for(books[0])

    assert reader.id == "kobo"
    assert reader.name == "Kobo"
    assert [book.title for book in books] == ["Why Fish Don't Exist", "Why We Sleep"]
    assert export.reader_id == "kobo"
    assert export.book.source_id == books[0].source_id
    assert [annotation.text for annotation in export.annotations][:2] == [
        "A yellow passage from chapter one.",
        "A pink passage.",
    ]
    assert export.raw_book["ImageId"] == "image-1"
    assert len(export.raw_annotations) == 4
    assert len(export.raw_context["chapters"]) == 2


def test_supported_reader_ids_start_with_kobo() -> None:
    assert supported_reader_ids() == ("kobo",)


def test_rejects_unsupported_reader_backend(tmp_path: Path) -> None:
    with pytest.raises(AfterBookError, match="Unsupported ebook reader"):
        open_reader("kindle", tmp_path)
