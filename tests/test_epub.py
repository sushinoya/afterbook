from __future__ import annotations

import zipfile
from contextlib import closing
from pathlib import Path

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


def test_cover_page_is_full_page_and_centered() -> None:
    from kobokeeps.epub import cover_document
    from kobokeeps.models import CoverImage

    cover = CoverImage(b"image", "image/jpeg", "jpg", 1264, 1680)
    page = cover_document(cover).decode()

    assert '@page { margin: 0; padding: 0; }' in page
    assert 'viewBox="0 0 1264 1680"' in page
    assert 'preserveAspectRatio="xMidYMid meet"' in page
    assert 'margin: 0 auto' in page


def test_epub_does_not_show_annotation_timestamps(kobo_database: Path, tmp_path: Path) -> None:
    book, annotations = load_book(kobo_database)
    output = write_epub(book, annotations, tmp_path)

    with zipfile.ZipFile(output) as epub:
        visible_content = "\n".join(
            epub.read(name).decode()
            for name in epub.namelist()
            if name.endswith(".xhtml")
        )
        archive = epub.read("OEBPS/archive/kobo-annotations.json").decode()

    assert "2024-01-25T16:27:37.000" not in visible_content
    assert "2024-01-25T16:27:37.000" in archive


def test_notes_are_unlabelled_blockquotes(kobo_database: Path, tmp_path: Path) -> None:
    book, annotations = load_book(kobo_database)
    output = write_epub(book, annotations, tmp_path)

    with zipfile.ZipFile(output) as epub:
        chapter = epub.read("OEBPS/chapter-2.xhtml").decode()

    assert '<blockquote class="note">This is my note.</blockquote>' in chapter
    assert "My note" not in chapter
