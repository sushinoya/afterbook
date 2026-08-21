from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

from kobokeeps.database import KoboRepository, open_database


def test_lists_books_with_annotation_counts(kobo_database: Path) -> None:
    with closing(open_database(kobo_database)) as connection:
        books = KoboRepository(connection).list_books()

    assert [book.title for book in books] == [
        "Why Fish Don't Exist",
        "Why We Sleep",
    ]
    assert books[0].highlight_count == 4
    assert books[0].note_count == 1
    assert books[0].reading_statistics.rating == 5


def test_annotations_follow_book_order(kobo_database: Path) -> None:
    with closing(open_database(kobo_database)) as connection:
        repository = KoboRepository(connection)
        book = repository.list_books()[0]
        annotations = repository.annotations_for(book)

    assert [annotation.text for annotation in annotations] == [
        "A yellow passage from chapter one.",
        "A pink passage.",
        "A blue passage from chapter two.",
        "A green passage.",
    ]
    assert annotations[2].location.chapter == "The Second Chapter"
    assert annotations[2].context_string == "Surrounding context for chapter two."


def test_kobo_color_codes_use_reference_palette() -> None:
    from kobokeeps.models import KOBO_HIGHLIGHT_PALETTE

    assert [KOBO_HIGHLIGHT_PALETTE[index].name for index in range(4)] == [
        "yellow",
        "pink",
        "blue",
        "green",
    ]


def test_missing_optional_columns_are_tolerated(tmp_path: Path) -> None:
    database = tmp_path / "minimal.sqlite"
    connection = sqlite3.connect(database)
    connection.executescript("""
        CREATE TABLE content (ContentID TEXT PRIMARY KEY);
        CREATE TABLE Bookmark (VolumeID TEXT, Text TEXT);
        INSERT INTO content VALUES ('book-id');
        INSERT INTO Bookmark VALUES ('book-id', 'A passage');
        """)
    connection.commit()
    connection.close()

    with closing(open_database(database)) as copied:
        repository = KoboRepository(copied)
        book = repository.list_books()[0]
        annotations = repository.annotations_for(book)

    assert book.title == "Untitled"
    assert book.author is None
    assert book.highlight_count == 1
    assert annotations[0].text == "A passage"
    assert annotations[0].color_code is None
