from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

import pytest

from afterbook.models import Book
from afterbook.readers.kobo.database import (
    KOBO_HIGHLIGHT_PALETTE,
    ChapterRecord,
    KoboRepository,
    open_database,
    optional_float,
    raw_json_value,
    resolve_chapter,
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


def test_open_database_uses_query_only_mode(kobo_database: Path) -> None:
    with (
        closing(open_database(kobo_database)) as connection,
        pytest.raises(sqlite3.OperationalError, match="readonly"),
    ):
        connection.execute("CREATE TABLE should_not_write (value TEXT)")


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


def test_raw_kobo_rows_follow_export_order(kobo_database: Path) -> None:
    with closing(open_database(kobo_database)) as connection:
        repository = KoboRepository(connection)
        book = repository.list_books()[0]
        raw_annotations = repository.raw_annotations_for(book)
        raw_chapters = repository.raw_chapters_for(book)

    assert [annotation["BookmarkID"] for annotation in raw_annotations] == [
        "bookmark-yellow",
        "bookmark-pink",
        "bookmark-blue",
        "bookmark-green",
    ]
    assert [chapter["Title"] for chapter in raw_chapters] == [
        "The First Chapter",
        "The Second Chapter",
    ]


def test_raw_kobo_rows_use_spine_order_before_lexical_content_id(tmp_path: Path) -> None:
    database = tmp_path / "chapter-numbering.sqlite"
    connection = sqlite3.connect(database)
    connection.executescript("""
        CREATE TABLE content (
            ContentID TEXT PRIMARY KEY,
            BookID TEXT,
            Title TEXT,
            SpineIndex REAL
        );
        CREATE TABLE Bookmark (
            BookmarkID TEXT,
            VolumeID TEXT,
            ContentID TEXT,
            Text TEXT,
            Annotation TEXT,
            ChapterProgress REAL
        );
        INSERT INTO content (ContentID, Title) VALUES ('book-id', 'Book');
        INSERT INTO content VALUES ('book-id/chapter-2', 'book-id', 'Chapter 2', 2);
        INSERT INTO content VALUES ('book-id/chapter-10', 'book-id', 'Chapter 10', 10);
        INSERT INTO Bookmark VALUES (
            'ten', 'book-id', 'book-id/chapter-10#kobo.1', 'chapter ten', '', 0.1
        );
        INSERT INTO Bookmark VALUES (
            'two', 'book-id', 'book-id/chapter-2#kobo.1', 'chapter two', '', 0.1
        );
        """)
    connection.commit()
    connection.close()

    with closing(open_database(database)) as copied:
        repository = KoboRepository(copied)
        book = repository.list_books()[0]
        raw_annotations = repository.raw_annotations_for(book)

    assert [annotation["BookmarkID"] for annotation in raw_annotations] == ["two", "ten"]


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


def test_annotation_text_strips_surrounding_whitespace(tmp_path: Path) -> None:
    database = tmp_path / "highlight-whitespace.sqlite"
    connection = sqlite3.connect(database)
    connection.executescript("""
        CREATE TABLE content (ContentID TEXT PRIMARY KEY, Title TEXT);
        CREATE TABLE Bookmark (VolumeID TEXT, Text TEXT, Annotation TEXT);
        INSERT INTO content VALUES ('book-id', 'Book');
        INSERT INTO Bookmark VALUES ('book-id', '  highlighted passage  ', '');
        """)
    connection.commit()
    connection.close()

    with closing(open_database(database)) as copied:
        repository = KoboRepository(copied)
        book = repository.list_books()[0]
        annotations = repository.annotations_for(book)
        raw_annotations = repository.raw_annotations_for(book)

    assert annotations[0].text == "highlighted passage"
    assert raw_annotations[0]["Text"] == "  highlighted passage  "


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


def test_chapter_titles_use_linked_kobo_navigation_rows(tmp_path: Path) -> None:
    database = tmp_path / "linked-chapter-title.sqlite"
    connection = sqlite3.connect(database)
    connection.executescript("""
        CREATE TABLE content (
            ContentID TEXT PRIMARY KEY,
            BookID TEXT,
            Title TEXT,
            VolumeIndex REAL,
            ChapterIDBookmarked TEXT
        );
        CREATE TABLE Bookmark (
            VolumeID TEXT,
            ContentID TEXT,
            Text TEXT,
            Annotation TEXT,
            ChapterProgress REAL
        );
        INSERT INTO content (ContentID, Title) VALUES ('book-id', 'Book');
        INSERT INTO content VALUES (
            'book-id!!e9781501160370/xhtml/ch01.xhtml',
            'book-id',
            'e9781501160370/xhtml/ch01.xhtml',
            6,
            NULL
        );
        INSERT INTO content VALUES (
            'book-id!!e9781501160370/xhtml/ch01.xhtml-1',
            'book-id',
            'Chapter 1: A Boy with His Head in the Stars',
            4,
            'book-id!!e9781501160370/xhtml/ch01.xhtml'
        );
        INSERT INTO Bookmark VALUES (
            'book-id',
            'book-id!!e9781501160370/xhtml/ch01.xhtml#kobo.1',
            'highlight',
            '',
            0.25
        );
        """)
    connection.commit()
    connection.close()

    with closing(open_database(database)) as copied:
        repository = KoboRepository(copied)
        book = repository.list_books()[0]
        annotation = repository.annotations_for(book)[0]

    assert annotation.location.chapter == "Chapter 1: A Boy with His Head in the Stars"


def test_path_like_chapter_titles_fall_back_to_readable_names(tmp_path: Path) -> None:
    database = tmp_path / "path-chapter-title.sqlite"
    connection = sqlite3.connect(database)
    connection.executescript("""
        CREATE TABLE content (
            ContentID TEXT PRIMARY KEY,
            BookID TEXT,
            Title TEXT,
            VolumeIndex REAL
        );
        CREATE TABLE Bookmark (
            VolumeID TEXT,
            ContentID TEXT,
            Text TEXT,
            Annotation TEXT
        );
        INSERT INTO content (ContentID, Title) VALUES ('book-id', 'Book');
        INSERT INTO content VALUES (
            'book-id!!e9781501160370/xhtml/prologue.xhtml',
            'book-id',
            'e9781501160370/xhtml/prologue.xhtml',
            3
        );
        INSERT INTO content VALUES (
            'book-id!!e9781501160370/xhtml/ch02.xhtml',
            'book-id',
            'e9781501160370/xhtml/ch02.xhtml',
            4
        );
        INSERT INTO Bookmark VALUES (
            'book-id',
            'book-id!!e9781501160370/xhtml/prologue.xhtml#kobo.1',
            'prologue highlight',
            ''
        );
        INSERT INTO Bookmark VALUES (
            'book-id',
            'book-id!!e9781501160370/xhtml/ch02.xhtml#kobo.1',
            'chapter highlight',
            ''
        );
        """)
    connection.commit()
    connection.close()

    with closing(open_database(database)) as copied:
        repository = KoboRepository(copied)
        book = repository.list_books()[0]
        annotations = repository.annotations_for(book)

    assert [annotation.location.chapter for annotation in annotations] == ["Prologue", "Chapter 2"]


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


def test_raw_chapters_tolerate_missing_order_columns(tmp_path: Path) -> None:
    database = tmp_path / "sparse-chapters.sqlite"
    connection = sqlite3.connect(database)
    connection.executescript("""
        CREATE TABLE content (BookID TEXT, Title TEXT);
        INSERT INTO content VALUES ('book-id', 'Loose chapter');
        """)
    connection.commit()
    connection.close()

    with closing(open_database(database)) as copied:
        chapters = KoboRepository(copied).raw_chapters_for(Book("book-id", "Book"))

    assert chapters == [{"BookID": "book-id", "Title": "Loose chapter"}]


def test_hidden_filter_trims_text_values(tmp_path: Path) -> None:
    database = tmp_path / "hidden-whitespace.sqlite"
    connection = sqlite3.connect(database)
    connection.executescript("""
        CREATE TABLE content (ContentID TEXT PRIMARY KEY, Title TEXT);
        CREATE TABLE Bookmark (VolumeID TEXT, Text TEXT, Annotation TEXT, Hidden TEXT);
        INSERT INTO content VALUES ('book-id', 'Book');
        INSERT INTO Bookmark VALUES ('book-id', 'visible highlight', '', ' false ');
        INSERT INTO Bookmark VALUES ('book-id', 'hidden highlight', '', ' TRUE ');
        """)
    connection.commit()
    connection.close()

    with closing(open_database(database)) as copied:
        repository = KoboRepository(copied)
        book = repository.list_books()[0]
        annotations = repository.annotations_for(book)
        raw_annotations = repository.raw_annotations_for(book)

    assert book.highlight_count == 1
    assert [annotation.text for annotation in annotations] == ["visible highlight"]
    assert [annotation["Text"] for annotation in raw_annotations] == ["visible highlight"]


def test_non_finite_sqlite_numbers_do_not_reach_models_or_raw_json() -> None:
    assert optional_float("NaN") is None
    assert optional_float("inf") is None
    assert raw_json_value(float("nan")) == "nan"


def test_chapter_matching_requires_a_prefix_boundary() -> None:
    records = [ChapterRecord("Chapter 1", "book/chapter-1", 1.0)]

    assert resolve_chapter(records, "book/chapter-10#kobo.1") == ("Unknown chapter", 0.0)


def test_chapter_matching_allows_extension_boundaries() -> None:
    records = [ChapterRecord("Chapter", "book/chapter", 1.0)]

    assert resolve_chapter(records, "book/chapter.xhtml#kobo.1") == ("Chapter", 1.0)
