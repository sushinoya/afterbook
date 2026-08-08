from __future__ import annotations

from contextlib import closing
from pathlib import Path

from kobokeeps.database import KoboRepository, open_database


def test_lists_books_with_annotation_counts(kobo_database: Path) -> None:
    with closing(open_database(kobo_database)) as connection:
        books = KoboRepository(connection).list_books()

    assert [book.title for book in books] == ["Why Fish Don't Exist", "Why We Sleep"]
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
