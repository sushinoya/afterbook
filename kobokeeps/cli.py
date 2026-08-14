"""Command line interface for KoboKeeps."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from kobokeeps.cover import load_cover
from kobokeeps.database import KoboRepository, open_database
from kobokeeps.device import database_snapshot, local_output_directory, select_device
from kobokeeps.epub import write_epub
from kobokeeps.errors import KoboKeepsError
from kobokeeps.models import Book
from kobokeeps.selection import book_by_id, book_by_number, book_by_title, interactive_book


def default_output_directory() -> Path:
    """Return the default directory used for generated books."""
    return Path.home() / "Documents" / "KoboKeeps"


def parser() -> argparse.ArgumentParser:
    """Build the command line parser."""
    argument_parser = argparse.ArgumentParser(
        prog="kobokeeps",
        description="Turn Kobo highlights and notes into personal books you can keep.",
    )
    argument_parser.add_argument("--device", type=Path, help="Path to a mounted Kobo eReader")
    subparsers = argument_parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("list", help="List books with highlights or notes")

    export_parser = subparsers.add_parser("export", help="Create a clipping EPUB")
    export_parser.add_argument("number", nargs="?", type=int, help="Book number from the list")
    export_parser.add_argument("--book", help="Exact book title")
    export_parser.add_argument("--book-id", help="Kobo content identifier")
    export_parser.add_argument("--output", type=Path, default=default_output_directory())
    return argument_parser


def choose_book(arguments: argparse.Namespace, books: list[Book]) -> Book:
    """Resolve CLI selection arguments to one book."""
    selectors = [arguments.number is not None, bool(arguments.book), bool(arguments.book_id)]
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
        print(
            f"{index:>3}. {book.title}{author} "
            f"[{book.highlight_count} highlights, {book.note_count} notes]"
        )
        print(f"     {book.content_id}")


def run(arguments: list[str] | None = None) -> int:
    """Run the KoboKeeps CLI."""
    parsed = parser().parse_args(arguments)
    device = select_device(parsed.device)

    with database_snapshot(device.database_path) as snapshot_path:
        connection = open_database(snapshot_path)
        try:
            repository = KoboRepository(connection)
            books = repository.list_books()
            if not books:
                raise KoboKeepsError("No books with highlights or notes were found")

            if parsed.command == "list":
                print_books(books)
                return 0

            book = choose_book(parsed, books)
            annotations = repository.annotations_for(book)
        finally:
            connection.close()

    cover = load_cover(device.root, book.image_id)
    output_directory = local_output_directory(parsed.output, device.root)
    output_path = write_epub(book, annotations, output_directory, cover)
    print(output_path)
    return 0


def main() -> int:
    """Run the CLI and turn expected failures into concise messages."""
    try:
        return run()
    except KoboKeepsError as error:
        print(f"kobokeeps: {error}", file=sys.stderr)
        return 1
