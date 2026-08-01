"""Read annotation data from a local copy of KoboReader.sqlite."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import sqlite3

from kobokeeps.errors import KoboKeepsError
from kobokeeps.models import Book, ReadingStatistics

BOOK_COLUMNS = {
    "title": "Title",
    "author": "Attribution",
    "subtitle": "Subtitle",
    "isbn": "ISBN",
    "language": "Language",
    "publisher": "Publisher",
    "series": "Series",
    "series_number": "SeriesNumber",
    "image_id": "ImageId",
    "date_created": "DateCreated",
    "read_status": "ReadStatus",
    "percent_read": "___PercentRead",
    "date_last_read": "DateLastRead",
    "time_spent_reading": "TimeSpentReading",
    "times_started_reading": "TimesStartedReading",
    "last_time_started_reading": "LastTimeStartedReading",
    "last_time_finished_reading": "LastTimeFinishedReading",
    "store_pages": "StorePages",
    "store_word_count": "StoreWordCount",
    "rating": "Rating",
    "rating_date_modified": "RatingDateModified",
}


def open_database(database_path: Path) -> sqlite3.Connection:
    """Open a local database snapshot for read-only queries."""
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only = ON")
    return connection


def table_columns(connection: sqlite3.Connection, table: str) -> set[str]:
    """Return the columns available in a table."""
    rows = connection.execute(f'PRAGMA table_info("{table}")').fetchall()
    return {str(row[1]) for row in rows}


def optional_text(value: object) -> str | None:
    """Normalize an optional text value."""
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def optional_int(value: object) -> int | None:
    """Convert an optional value to int when possible."""
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def optional_number(value: object) -> float | int | None:
    """Convert an optional value to a numeric type when possible."""
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        return value
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return int(number) if number.is_integer() else number


def optional_float(value: object) -> float | None:
    """Convert an optional value to float when possible."""
    number = optional_number(value)
    return float(number) if number is not None else None


def select_column(columns: set[str], column: str, alias: str) -> str:
    """Select a column when present and NULL otherwise."""
    if column in columns:
        return f'c."{column}" AS "{alias}"'
    return f'NULL AS "{alias}"'


@dataclass(slots=True)
class KoboRepository:
    """Queries Kobo annotation data from a local database snapshot."""

    connection: sqlite3.Connection

    def list_books(self) -> list[Book]:
        bookmark_columns = table_columns(self.connection, "Bookmark")
        content_columns = table_columns(self.connection, "content")
        if "VolumeID" not in bookmark_columns:
            raise KoboKeepsError("Unsupported Kobo database: Bookmark.VolumeID is missing")

        text_value = 'TRIM(COALESCE(b."Text", \'\'))' if "Text" in bookmark_columns else "''"
        note_value = (
            'TRIM(COALESCE(b."Annotation", \'\'))'
            if "Annotation" in bookmark_columns
            else "''"
        )
        visible_condition = ""
        if "Hidden" in bookmark_columns:
            visible_condition = (
                ' AND LOWER(COALESCE(CAST(b."Hidden" AS TEXT), \'false\')) '
                "NOT IN ('true', '1')"
            )

        book_fields = [
            select_column(content_columns, column, alias)
            for alias, column in BOOK_COLUMNS.items()
        ]
        query = f"""
            WITH annotated_books AS (
                SELECT b."VolumeID" AS content_id,
                       SUM(CASE WHEN {text_value} <> '' THEN 1 ELSE 0 END) AS highlight_count,
                       SUM(CASE WHEN {note_value} <> '' THEN 1 ELSE 0 END) AS note_count
                FROM Bookmark b
                WHERE ({text_value} <> '' OR {note_value} <> ''){visible_condition}
                GROUP BY b."VolumeID"
            )
            SELECT a.content_id, a.highlight_count, a.note_count, {', '.join(book_fields)}
            FROM annotated_books a
            LEFT JOIN content c ON c."ContentID" = a.content_id
            ORDER BY COALESCE(c."Title", a.content_id) COLLATE NOCASE
        """
        return [self.book_from_row(row) for row in self.connection.execute(query).fetchall()]

    def book_from_row(self, row: sqlite3.Row) -> Book:
        statistics = ReadingStatistics(
            read_status=optional_int(row["read_status"]),
            percent_read=optional_float(row["percent_read"]),
            date_last_read=optional_text(row["date_last_read"]),
            time_spent_reading=optional_number(row["time_spent_reading"]),
            times_started_reading=optional_int(row["times_started_reading"]),
            last_time_started_reading=optional_text(row["last_time_started_reading"]),
            last_time_finished_reading=optional_text(row["last_time_finished_reading"]),
            store_pages=optional_int(row["store_pages"]),
            store_word_count=optional_int(row["store_word_count"]),
            rating=optional_number(row["rating"]),
            rating_date_modified=optional_text(row["rating_date_modified"]),
        )
        return Book(
            content_id=str(row["content_id"]),
            title=optional_text(row["title"]) or "Untitled",
            author=optional_text(row["author"]),
            subtitle=optional_text(row["subtitle"]),
            isbn=optional_text(row["isbn"]),
            language=optional_text(row["language"]),
            publisher=optional_text(row["publisher"]),
            series=optional_text(row["series"]),
            series_number=optional_number(row["series_number"]),
            image_id=optional_text(row["image_id"]),
            date_created=optional_text(row["date_created"]),
            highlight_count=optional_int(row["highlight_count"]) or 0,
            note_count=optional_int(row["note_count"]) or 0,
            reading_statistics=statistics,
        )
