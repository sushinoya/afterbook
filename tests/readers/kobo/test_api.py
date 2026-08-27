from __future__ import annotations

import io
import shutil
import zipfile
from pathlib import Path

import pytest

from afterbook.api import (
    generate_kobo_epub,
    list_kobo_book_annotations,
    list_kobo_books,
    validate_kobo_directory,
)
from afterbook.errors import AfterBookError
from afterbook.readers.kobo.cover import (
    COVER_VARIANT_PRIORITY,
    cover_cache_directory,
    cover_cache_filename,
    cover_cache_locator,
)


def png_bytes(width: int, height: int) -> bytes:
    return (
        b"\x89PNG\r\n\x1a\n"
        + b"\x00\x00\x00\x0dIHDR"
        + width.to_bytes(4, "big")
        + height.to_bytes(4, "big")
    )


@pytest.fixture
def kobo_root(kobo_database: Path, tmp_path: Path) -> Path:
    root = tmp_path / "KOBOeReader"
    database_directory = root / ".kobo"
    database_directory.mkdir(parents=True)
    shutil.copyfile(kobo_database, database_directory / "KoboReader.sqlite")
    return root


def test_validate_kobo_directory_requires_database(tmp_path: Path) -> None:
    with pytest.raises(AfterBookError, match="No Kobo database found"):
        validate_kobo_directory(tmp_path / "KOBOeReader")


def test_list_kobo_books_returns_browser_mappings(kobo_root: Path) -> None:
    books = list_kobo_books(kobo_root)

    assert books[0]["title"] == "Why Fish Don't Exist"
    assert books[0]["author"] == "Lulu Miller"
    assert books[0]["highlight_count"] == 4
    assert books[0]["note_count"] == 1
    assert books[0]["source_id"] == "da59e6e5-b10a-409a-b476-94fa8c654816"
    assert books[0]["cover"] == cover_cache_locator("image-1")


def test_list_kobo_book_annotations_returns_browser_mappings(kobo_root: Path) -> None:
    annotations = list_kobo_book_annotations(kobo_root, "da59e6e5-b10a-409a-b476-94fa8c654816")

    assert annotations[0]["source_id"] == "bookmark-yellow"
    assert annotations[0]["text"] == "A yellow passage from chapter one."
    assert annotations[0]["note"] == ""
    assert annotations[0]["color_name"] == "yellow"
    assert annotations[0]["color_hex"] == "#F8E98A"
    assert annotations[0]["location"] == {
        "chapter": "The First Chapter",
        "progress": 0.8,
        "locator": "da59e6e5-b10a-409a-b476-94fa8c654816/chapter-1.xhtml#kobo.1.1",
        "page": None,
    }
    assert annotations[1]["text"] == "A pink passage."
    assert any(annotation["note"] == "This is my note." for annotation in annotations)


def test_generate_kobo_epub_returns_filename_and_bytes(kobo_root: Path) -> None:
    image_id = "image-1"
    cover_directory = cover_cache_directory(kobo_root, image_id)
    cover_directory.mkdir(parents=True)
    cover_path = cover_directory / cover_cache_filename(image_id, COVER_VARIANT_PRIORITY[0])
    cover_path.write_bytes(png_bytes(1264, 1680))
    book_id = "da59e6e5-b10a-409a-b476-94fa8c654816"

    generated = generate_kobo_epub(kobo_root, book_id)

    assert generated.filename == "Why Fish Don't Exist - My Clippings.epub"
    with zipfile.ZipFile(io.BytesIO(generated.data)) as epub:
        assert epub.read("mimetype") == b"application/epub+zip"
        assert epub.read("OEBPS/cover.png") == png_bytes(1264, 1680)
        assert "A yellow passage from chapter one." in epub.read("OEBPS/chapter-1.xhtml").decode()
