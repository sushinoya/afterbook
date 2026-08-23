from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

from afterbook.readers.kobo.database import (
    KOBO_HIGHLIGHT_PALETTE,
    KoboRepository,
    open_database,
)


def test_lists_books_with_annotation_counts(kobo_database: Path) -> None:
    with closing(open_database(kobo_database)) as connection:
        books = KoboRepository(connection).list_books()

    assert [book.title for book in books] == [
        "Why Fish Don't Exist",
        "Why We Sleep",
    ]
    assert books[0].highlight_count == 4
    assert books[0].note_count == 1


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
    assert annotations[2].location.locator_type == "kobo-content-id"
    assert annotations[2].location.locator == f"{book.source_id}/chapter-2.xhtml#kobo.2.1"
    assert annotations[2].color_name == "blue"
    assert annotations[2].kind == "Highlight"


def test_raw_kobo_rows_preserve_reader_specific_metadata(kobo_database: Path) -> None:
    with closing(open_database(kobo_database)) as connection:
        repository = KoboRepository(connection)
        book = repository.list_books()[0]
        raw_book = repository.raw_book_for(book)
        raw_annotations = repository.raw_annotations_for(book)
        raw_chapters = repository.raw_chapters_for(book)

    raw_annotations_by_id = {annotation["BookmarkID"]: annotation for annotation in raw_annotations}

    assert raw_book["Rating"] == 5
    assert raw_book["RestOfBookEstimate"] == 3600
    assert raw_book["StoreTimeToReadLowerEstimate"] == 18000
    assert raw_book["StoreTimeToReadUpperEstimate"] == 22000
    assert [chapter["Title"] for chapter in raw_chapters] == [
        "The First Chapter",
        "The Second Chapter",
    ]
    assert raw_annotations_by_id["bookmark-blue"]["ContextString"] == (
        "Surrounding context for chapter two."
    )
    assert raw_annotations_by_id["bookmark-blue"]["StartOffset"] == 4


def test_kobo_color_codes_use_reference_palette() -> None:
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
    assert annotations[0].color_name is None


def test_chapter_order_uses_volume_index_when_spine_index_is_null(tmp_path: Path) -> None:
    database = tmp_path / "nullable-spine.sqlite"
    connection = sqlite3.connect(database)
    connection.executescript("""
        CREATE TABLE content (
            ContentID TEXT PRIMARY KEY,
            BookID TEXT,
            Title TEXT,
            VolumeIndex REAL,
            SpineIndex REAL
        );
        CREATE TABLE Bookmark (
            VolumeID TEXT,
            ContentID TEXT,
            Text TEXT,
            Annotation TEXT,
            ChapterProgress REAL
        );
        INSERT INTO content (ContentID, Title) VALUES ('book-id', 'Book');
        INSERT INTO content (ContentID, BookID, Title, VolumeIndex, SpineIndex)
            VALUES ('book-id/chapter-1.xhtml', 'book-id', 'Chapter 1', 1, NULL);
        INSERT INTO content (ContentID, BookID, Title, VolumeIndex, SpineIndex)
            VALUES ('book-id/chapter-2.xhtml', 'book-id', 'Chapter 2', 2, NULL);
        INSERT INTO Bookmark VALUES (
            'book-id', 'book-id/chapter-1.xhtml#kobo.1', 'first chapter', '', 0.90
        );
        INSERT INTO Bookmark VALUES (
            'book-id', 'book-id/chapter-2.xhtml#kobo.2', 'second chapter', '', 0.10
        );
        """)
    connection.commit()
    connection.close()

    with closing(open_database(database)) as copied:
        repository = KoboRepository(copied)
        book = repository.list_books()[0]
        annotations = repository.annotations_for(book)

    assert [annotation.text for annotation in annotations] == ["first chapter", "second chapter"]
    assert [annotation.location.chapter_index for annotation in annotations] == [1.0, 2.0]


def test_dynamic_sqlite_numeric_values_are_normalized(tmp_path: Path) -> None:
    database = tmp_path / "string-numerics.sqlite"
    connection = sqlite3.connect(database)
    connection.executescript("""
        CREATE TABLE content (
            ContentID TEXT PRIMARY KEY,
            BookID TEXT,
            Title TEXT,
            VolumeIndex TEXT
        );
        CREATE TABLE Bookmark (
            VolumeID TEXT,
            ContentID TEXT,
            Text TEXT,
            Annotation TEXT,
            Color TEXT,
            ChapterProgress TEXT,
            StartContainerChildIndex TEXT,
            StartOffset TEXT
        );
        INSERT INTO content (ContentID, Title) VALUES ('book-id', 'Book');
        INSERT INTO content VALUES ('book-id/chapter.xhtml', 'book-id', 'Chapter', '3');
        INSERT INTO Bookmark VALUES (
            'book-id', 'book-id/chapter.xhtml#kobo.1', 'blue', '', '2', '0.5', '4', '12'
        );
        """)
    connection.commit()
    connection.close()

    with closing(open_database(database)) as copied:
        repository = KoboRepository(copied)
        book = repository.list_books()[0]
        annotation = repository.annotations_for(book)[0]

    assert annotation.color_name == "blue"
    assert annotation.location.chapter_index == 3.0
    assert annotation.location.progress == 0.5
    assert annotation.location.sort_hint == 4_000_012


def test_rows_without_volume_id_do_not_create_phantom_books(tmp_path: Path) -> None:
    database = tmp_path / "empty-volume.sqlite"
    connection = sqlite3.connect(database)
    connection.executescript("""
        CREATE TABLE content (ContentID TEXT PRIMARY KEY);
        CREATE TABLE Bookmark (VolumeID TEXT, Text TEXT, Annotation TEXT);
        INSERT INTO Bookmark VALUES (NULL, 'orphaned highlight', '');
        INSERT INTO Bookmark VALUES ('', 'empty id highlight', '');
        """)
    connection.commit()
    connection.close()

    with closing(open_database(database)) as copied:
        books = KoboRepository(copied).list_books()

    assert books == []
