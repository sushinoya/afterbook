"""Read annotation data from a local copy of KoboReader.sqlite."""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path

from kobokeeps.errors import KoboKeepsError
from kobokeeps.models import (
    Annotation,
    AnnotationLocation,
    Book,
    ReadingStatistics,
)

ANNOTATION_COLUMNS = {
    "bookmark_id": "BookmarkID",
    "uuid": "UUID",
    "text": "Text",
    "note": "Annotation",
    "context_string": "ContextString",
    "color_code": "Color",
    "date_created": "DateCreated",
    "date_modified": "DateModified",
    "version": "Version",
    "annotation_type": "Type",
    "content_id": "ContentID",
    "chapter_progress": "ChapterProgress",
    "start_container_path": "StartContainerPath",
    "start_container_child_index": "StartContainerChildIndex",
    "start_offset": "StartOffset",
    "end_container_path": "EndContainerPath",
    "end_container_child_index": "EndContainerChildIndex",
    "end_offset": "EndOffset",
}


def optional_text(value: object) -> str | None:
    """Return a string value from SQLite, preserving empty strings."""
    if value is None:
        return None
    return str(value)


def optional_int(value: object) -> int | None:
    """Return an integer from SQLite's dynamically typed values."""
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value) if value.is_integer() else None
    if not isinstance(value, str):
        return None
    try:
        return int(value)
    except ValueError:
        return None


def optional_float(value: object) -> float | None:
    """Return a float from SQLite's dynamically typed values."""
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if not isinstance(value, str):
        return None
    try:
        return float(value)
    except ValueError:
        return None


def optional_number(value: object) -> float | int | None:
    """Return an int when possible, otherwise a float, from SQLite values."""
    integer_value = optional_int(value)
    if integer_value is not None:
        return integer_value
    return optional_float(value)


@dataclass(frozen=True, slots=True)
class ChapterRecord:
    """A chapter row used to resolve annotation positions."""

    title: str | None
    content_id: str
    spine_index: float


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
    "description": "Description",
    "mime_type": "MimeType",
    "external_id": "ExternalId",
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
    "rest_of_book_estimate": "RestOfBookEstimate",
    "store_time_to_read_lower_estimate": "StoreTimeToReadLowerEstimate",
    "store_time_to_read_upper_estimate": "StoreTimeToReadUpperEstimate",
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


@dataclass(slots=True)
class KoboRepository:
    """Queries Kobo annotation data from a local database snapshot."""

    connection: sqlite3.Connection

    def list_books(self) -> list[Book]:
        bookmark_columns = table_columns(self.connection, "Bookmark")
        content_columns = table_columns(self.connection, "content")
        if "VolumeID" not in bookmark_columns:
            raise KoboKeepsError("Unsupported Kobo database: Bookmark.VolumeID is missing")
        if "ContentID" not in content_columns:
            raise KoboKeepsError("Unsupported Kobo database: content.ContentID is missing")

        text_value = "TRIM(COALESCE(b.\"Text\", ''))" if "Text" in bookmark_columns else "''"
        note_value = (
            "TRIM(COALESCE(b.\"Annotation\", ''))" if "Annotation" in bookmark_columns else "''"
        )
        visible_condition = ""
        if "Hidden" in bookmark_columns:
            visible_condition = (
                " AND LOWER(COALESCE(CAST(b.\"Hidden\" AS TEXT), 'false')) NOT IN ('true', '1')"
            )

        book_fields = [
            (f'c."{column}" AS "{alias}"' if column in content_columns else f'NULL AS "{alias}"')
            for alias, column in BOOK_COLUMNS.items()
        ]
        title_sort = 'c."Title"' if "Title" in content_columns else "a.content_id"
        query = f"""
            WITH annotated_books AS (
                SELECT b."VolumeID" AS content_id,
                       SUM(CASE WHEN {text_value} <> '' THEN 1 ELSE 0 END) AS highlight_count,
                       SUM(CASE WHEN {note_value} <> '' THEN 1 ELSE 0 END) AS note_count
                FROM Bookmark b
                WHERE b."VolumeID" IS NOT NULL
                  AND TRIM(CAST(b."VolumeID" AS TEXT)) <> ''
                  AND ({text_value} <> '' OR {note_value} <> ''){visible_condition}
                GROUP BY b."VolumeID"
            )
            SELECT a.content_id, a.highlight_count, a.note_count, {", ".join(book_fields)}
            FROM annotated_books a
            LEFT JOIN content c ON c."ContentID" = a.content_id
            ORDER BY COALESCE({title_sort}, a.content_id) COLLATE NOCASE
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
            rest_of_book_estimate=optional_number(row["rest_of_book_estimate"]),
            store_time_to_read_lower_estimate=optional_number(
                row["store_time_to_read_lower_estimate"]
            ),
            store_time_to_read_upper_estimate=optional_number(
                row["store_time_to_read_upper_estimate"]
            ),
            rating=optional_number(row["rating"]),
            rating_date_modified=optional_text(row["rating_date_modified"]),
        )
        title = optional_text(row["title"])
        content_id = optional_text(row["content_id"]) or ""
        return Book(
            content_id=content_id,
            title=title or "Untitled",
            author=optional_text(row["author"]),
            subtitle=optional_text(row["subtitle"]),
            isbn=optional_text(row["isbn"]),
            language=optional_text(row["language"]),
            publisher=optional_text(row["publisher"]),
            series=optional_text(row["series"]),
            series_number=row["series_number"],
            image_id=optional_text(row["image_id"]),
            description=optional_text(row["description"]),
            mime_type=optional_text(row["mime_type"]),
            external_id=optional_text(row["external_id"]),
            date_created=optional_text(row["date_created"]),
            highlight_count=optional_int(row["highlight_count"]) or 0,
            note_count=optional_int(row["note_count"]) or 0,
            reading_statistics=statistics,
        )

    def annotations_for(self, book: Book) -> list[Annotation]:
        bookmark_columns = table_columns(self.connection, "Bookmark")
        fields = [
            (f'b."{column}" AS "{alias}"' if column in bookmark_columns else f'NULL AS "{alias}"')
            for alias, column in ANNOTATION_COLUMNS.items()
        ]
        text_value = "TRIM(COALESCE(b.\"Text\", ''))" if "Text" in bookmark_columns else "''"
        note_value = (
            "TRIM(COALESCE(b.\"Annotation\", ''))" if "Annotation" in bookmark_columns else "''"
        )
        conditions = [
            'b."VolumeID" = ?',
            f"({text_value} <> '' OR {note_value} <> '')",
        ]
        if "Hidden" in bookmark_columns:
            conditions.append(
                "LOWER(COALESCE(CAST(b.\"Hidden\" AS TEXT), 'false')) NOT IN ('true', '1')"
            )
        query = f"SELECT {', '.join(fields)} FROM Bookmark b WHERE {' AND '.join(conditions)}"
        chapters = self.chapter_records(book.content_id)
        annotations = [
            self.annotation_from_row(row, chapters)
            for row in self.connection.execute(query, (book.content_id,)).fetchall()
        ]
        return sorted(annotations, key=lambda annotation: annotation.sort_key)

    def chapter_records(self, book_id: str) -> list[ChapterRecord]:
        columns = table_columns(self.connection, "content")
        if "BookID" not in columns or "ContentID" not in columns:
            return []
        title_expression = '"Title"' if "Title" in columns else "NULL"
        if "SpineIndex" in columns and "VolumeIndex" in columns:
            index_expression = 'COALESCE("SpineIndex", "VolumeIndex", 0)'
        elif "SpineIndex" in columns:
            index_expression = 'COALESCE("SpineIndex", 0)'
        elif "VolumeIndex" in columns:
            index_expression = 'COALESCE("VolumeIndex", 0)'
        else:
            index_expression = "0"
        query = (
            f'SELECT {title_expression} AS title, "ContentID" AS content_id, '
            f'{index_expression} AS spine_index FROM content WHERE "BookID" = ?'
        )
        records: list[ChapterRecord] = []
        for row in self.connection.execute(query, (book_id,)).fetchall():
            content_id = normalized_content_id(optional_text(row["content_id"]) or "")
            if not content_id:
                continue
            records.append(
                ChapterRecord(
                    title=optional_text(row["title"]),
                    content_id=content_id,
                    spine_index=optional_float(row["spine_index"]) or 0.0,
                )
            )
        return records

    def annotation_from_row(
        self,
        row: sqlite3.Row,
        chapters: list[ChapterRecord],
    ) -> Annotation:
        content_id = optional_text(row["content_id"]) or ""
        chapter, spine_index = resolve_chapter(chapters, content_id)
        return Annotation(
            bookmark_id=optional_text(row["bookmark_id"]),
            uuid=optional_text(row["uuid"]),
            text=optional_text(row["text"]) or "",
            note=optional_text(row["note"]) or "",
            context_string=optional_text(row["context_string"]),
            color_code=optional_int(row["color_code"]),
            date_created=optional_text(row["date_created"]),
            date_modified=optional_text(row["date_modified"]),
            version=optional_text(row["version"]),
            annotation_type=optional_text(row["annotation_type"]),
            location=AnnotationLocation(
                content_id=content_id,
                chapter=chapter,
                spine_index=spine_index,
                chapter_progress=optional_float(row["chapter_progress"]) or 0.0,
                start_container_path=optional_text(row["start_container_path"]),
                start_container_child_index=optional_int(row["start_container_child_index"]),
                start_offset=optional_int(row["start_offset"]),
                end_container_path=optional_text(row["end_container_path"]),
                end_container_child_index=optional_int(row["end_container_child_index"]),
                end_offset=optional_int(row["end_offset"]),
            ),
        )


def normalized_content_id(content_id: str) -> str:
    """Normalize an annotation content identifier for chapter matching."""
    return content_id.replace("\\", "/").split("#", 1)[0]


def resolve_chapter(records: list[ChapterRecord], content_id: str) -> tuple[str, float]:
    """Resolve an annotation content identifier to a chapter."""
    normalized_id = normalized_content_id(content_id)
    if not normalized_id:
        return "Unknown chapter", 0.0
    matches = [
        record
        for record in records
        if normalized_id.startswith(record.content_id)
        or record.content_id.startswith(normalized_id)
    ]
    if not matches:
        return "Unknown chapter", 0.0
    best_match = max(matches, key=lambda record: len(record.content_id))
    return best_match.title or "Unknown chapter", best_match.spine_index
