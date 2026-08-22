"""Command line interface for KoboKeeps."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from kobokeeps import __version__
from kobokeeps.epub import write_epub
from kobokeeps.errors import KoboKeepsError
from kobokeeps.models import Book
from kobokeeps.readers import default_reader_id, open_reader, supported_reader_ids
from kobokeeps.selection import (
    book_by_id,
    book_by_number,
    book_by_title,
    interactive_book,
)


def parser() -> argparse.ArgumentParser:
    """Build the command line parser."""
    argument_parser = argparse.ArgumentParser(
        prog="kobokeeps",
        description="Turn ebook reader highlights and notes into personal books you can keep.",
    )
    argument_parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    argument_parser.add_argument(
        "--reader",
        choices=supported_reader_ids(),
        default=default_reader_id(),
        help="ebook reader backend",
    )
    argument_parser.add_argument(
        "--source",
        type=Path,
        help="Path to reader data source",
    )
    subparsers = argument_parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("list", help="List books with highlights or notes")

    export_parser = subparsers.add_parser("export", help="Create a clipping EPUB")
    export_parser.add_argument("number", nargs="?", type=int, help="Book number from the list")
    export_parser.add_argument("--book", help="Exact book title")
    export_parser.add_argument("--book-id", help="Reader content identifier")
    export_parser.add_argument(
        "--output", type=Path, default=Path.home() / "Documents" / "KoboKeeps"
    )
    return argument_parser


def choose_book(arguments: argparse.Namespace, books: list[Book]) -> Book:
    """Resolve CLI selection arguments to one book."""
    selectors = [
        arguments.number is not None,
        bool(arguments.book),
        bool(arguments.book_id),
    ]
    if sum(selectors) > 1:
        raise KoboKeepsError("Choose only one of a book number, --book, or --book-id")
    if arguments.number is not None:
        return book_by_number(books, arguments.number)
    if arguments.book:
        return book_by_title(books, arguments.book)
    if arguments.book_id:
        return book_by_id(books, arguments.book_id)
    return interactive_book(books)


def print_books(books: list[Book]) -> None:
    """Print annotated books in a stable numbered list."""
    for index, book in enumerate(books, start=1):
        author = f" - {book.author}" if book.author else ""
        highlight_word = "highlight" if book.highlight_count == 1 else "highlights"
        note_word = "note" if book.note_count == 1 else "notes"
        print(
            f"{index:>3}. {book.title}{author} "
            f"[{book.highlight_count} {highlight_word}, {book.note_count} {note_word}]"
        )
        print(f"     {book.source_id}")


def run(arguments: list[str] | None = None) -> int:
    """Run the KoboKeeps CLI."""
    parsed = parser().parse_args(arguments)

    with open_reader(parsed.reader, parsed.source) as reader:
        books = reader.list_books()
        if not books:
            raise KoboKeepsError("No books with highlights or notes were found")

        if parsed.command == "list":
            print_books(books)
            return 0

        book = choose_book(parsed, books)
        export = reader.export_for(book)
        output_directory = reader.resolve_output_directory(parsed.output)

    output_path = write_epub(export, output_directory)
    print(output_path)
    return 0


def main() -> int:
    """Run the CLI and turn expected failures into concise messages."""
    try:
        return run()
    except KoboKeepsError as error:
        print(f"kobokeeps: {error}", file=sys.stderr)
        return 1
