"""Book selection for interactive and scripted exports."""

from __future__ import annotations

from afterbook.errors import AfterBookError
from afterbook.models import Book


def selection_label(book: Book) -> str:
    """Return a readable label for the interactive selector."""
    author = book.author or "Unknown author"
    highlight_word = "highlight" if book.highlight_count == 1 else "highlights"
    note_word = "note" if book.note_count == 1 else "notes"
    return (
        f"{book.title}  |  {author}  |  "
        f"{book.highlight_count} {highlight_word}, {book.note_count} {note_word}"
    )


def book_by_number(books: list[Book], number: int) -> Book:
    """Select a book by its one-based list index."""
    if number < 1 or number > len(books):
        raise AfterBookError(f"Book number must be between 1 and {len(books)}")
    return books[number - 1]


def book_by_title(books: list[Book], title: str) -> Book:
    """Select a book by case-insensitive exact title."""
    matches = [book for book in books if book.title.casefold() == title.casefold()]
    if not matches:
        raise AfterBookError(f'No annotated book named "{title}" was found')
    if len(matches) > 1:
        raise AfterBookError(f'Multiple annotated books are named "{title}". Use --book-id')
    return matches[0]


def book_by_id(books: list[Book], content_id: str) -> Book:
    """Select a book by its reader content identifier."""
    for book in books:
        if book.source_id == content_id:
            return book
    raise AfterBookError(f'No annotated book with id "{content_id}" was found')


def interactive_book(books: list[Book]) -> Book:
    """Select a book with an arrow-key terminal menu."""
    try:
        import questionary
    except ImportError as error:
        raise AfterBookError(
            "Interactive selection requires Questionary. Install AfterBook normally "
            "or use a book number"
        ) from error

    choices = [questionary.Choice(selection_label(book), value=book) for book in books]
    selected = questionary.select(
        "Select a book",
        choices=choices,
        use_shortcuts=True,
        use_arrow_keys=True,
    ).ask()
    if selected is None:
        raise AfterBookError("Book selection cancelled")
    if not isinstance(selected, Book):
        raise AfterBookError("Invalid book selection")
    return selected
