from __future__ import annotations

import pytest

from afterbook import __version__
from afterbook.errors import AfterBookError
from afterbook.models import Book
from afterbook.selection import book_by_number, book_by_title


def books() -> list[Book]:
    return [
        Book("one", "Why Fish Don't Exist", "Lulu Miller", highlight_count=246),
        Book("two", "Why We Sleep", "Matthew Walker", highlight_count=2),
    ]


def test_selects_book_by_number() -> None:
    assert book_by_number(books(), 2).title == "Why We Sleep"


def test_selects_book_by_exact_title() -> None:
    assert book_by_title(books(), "why fish don't exist").source_id == "one"


def test_rejects_invalid_book_number() -> None:
    with pytest.raises(AfterBookError):
        book_by_number(books(), 3)


def test_print_books_pluralizes_counts(capsys: pytest.CaptureFixture[str]) -> None:
    from afterbook.cli import print_books

    print_books([Book("one", "One Note", highlight_count=1, note_count=1)])

    assert "[1 highlight, 1 note]" in capsys.readouterr().out


def test_cli_version_does_not_require_reader_source(
    capsys: pytest.CaptureFixture[str],
) -> None:
    from afterbook.cli import run

    with pytest.raises(SystemExit, match="0"):
        run(["--version"])

    assert capsys.readouterr().out.strip() == f"afterbook {__version__}"
