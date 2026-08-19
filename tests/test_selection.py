from __future__ import annotations

import pytest

from kobokeeps.errors import KoboKeepsError
from kobokeeps.models import Book
from kobokeeps.selection import book_by_number, book_by_title


def books() -> list[Book]:
    return [
        Book("one", "Why Fish Don't Exist", "Lulu Miller", highlight_count=246),
        Book("two", "Why We Sleep", "Matthew Walker", highlight_count=2),
    ]


def test_selects_book_by_number() -> None:
    assert book_by_number(books(), 2).title == "Why We Sleep"


def test_selects_book_by_exact_title() -> None:
    assert book_by_title(books(), "why fish don't exist").content_id == "one"


def test_rejects_invalid_book_number() -> None:
    with pytest.raises(KoboKeepsError):
        book_by_number(books(), 3)


def test_cli_version_does_not_require_device(capsys: pytest.CaptureFixture[str]) -> None:
    from kobokeeps.cli import run

    with pytest.raises(SystemExit, match="0"):
        run(["--version"])

    assert capsys.readouterr().out.strip() == "kobokeeps 1.0.0"
