from __future__ import annotations

from contextlib import closing
from pathlib import Path
import zipfile

from kobokeeps.database import KoboRepository, open_database
from kobokeeps.epub import write_epub
from kobokeeps.models import KOBO_HIGHLIGHT_PALETTE


def load_book(kobo_database: Path):
    with closing(open_database(kobo_database)) as connection:
        repository = KoboRepository(connection)
        book = repository.list_books()[0]
        annotations = repository.annotations_for(book)
    return book, annotations


def test_epub_contains_colored_highlights(kobo_database: Path, tmp_path: Path) -> None:
    book, annotations = load_book(kobo_database)
    output = write_epub(book, annotations, tmp_path)

    with zipfile.ZipFile(output) as epub:
        chapter_one = epub.read("OEBPS/chapter-1.xhtml").decode()
        chapter_two = epub.read("OEBPS/chapter-2.xhtml").decode()

    assert KOBO_HIGHLIGHT_PALETTE[0].hex_value in chapter_one
    assert KOBO_HIGHLIGHT_PALETTE[1].hex_value in chapter_one
    assert KOBO_HIGHLIGHT_PALETTE[2].hex_value in chapter_two
    assert KOBO_HIGHLIGHT_PALETTE[3].hex_value in chapter_two


def test_epub_stores_mimetype_first_and_uncompressed(kobo_database: Path, tmp_path: Path) -> None:
    book, annotations = load_book(kobo_database)
    output = write_epub(book, annotations, tmp_path)

    with zipfile.ZipFile(output) as epub:
        first_entry = epub.infolist()[0]
        assert first_entry.filename == "mimetype"
        assert first_entry.compress_type == zipfile.ZIP_STORED
