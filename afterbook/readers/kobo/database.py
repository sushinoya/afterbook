"""Read annotation data from a local copy of KoboReader.sqlite."""

from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass
from math import isfinite
from pathlib import Path, PurePosixPath

from afterbook.errors import AfterBookError
from afterbook.models import (
    Annotation,
    AnnotationLocation,
    Book,
    JsonValue,
)


@dataclass(frozen=True, slots=True)
class KoboHighlightColor:
    """Display color for one Kobo highlight color code."""

    name: str
    hex_value: str


KOBO_HIGHLIGHT_PALETTE = {
    0: KoboHighlightColor("yellow", "#F8E98A"),
    1: KoboHighlightColor("pink", "#ECA6C4"),
    2: KoboHighlightColor("blue", "#9DD9E2"),
    3: KoboHighlightColor("green", "#C4DC88"),
}

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
        result = float(value)
        return result if isfinite(result) else None
    if not isinstance(value, str):
        return None
    try:
        result = float(value)
    except ValueError:
        return None
    return result if isfinite(result) else None


def optional_number(value: object) -> float | int | None:
    """Return an int when possible, otherwise a float, from SQLite values."""
    integer_value = optional_int(value)
    if integer_value is not None:
        return integer_value
    return optional_float(value)


def optional_series_number(value: object) -> str | float | int | None:
    """Return a series position without allowing unsupported SQLite values."""
    number = optional_number(value)
    if number is not None:
        return number
    text = optional_text(value)
    return text or None


def raw_json_value(value: object) -> JsonValue:
    """Convert SQLite values to JSON-compatible archive values."""
    if isinstance(value, float):
        return value if isfinite(value) else str(value)
    if value is None or isinstance(value, (str, int, bool)):
        return value
    if isinstance(value, bytes):
        return value.hex()
    return str(value)


def raw_json_row(row: sqlite3.Row) -> dict[str, JsonValue]:
    """Convert a SQLite row to a JSON-compatible raw archive mapping."""
    return {key: raw_json_value(row[key]) for key in list(row.keys())}


def kobo_sort_hint(child_index: int | None, offset: int | None) -> int:
    """Build a sortable hint from Kobo's nested DOM position fields."""
    return (child_index or 0) * 1_000_000 + (offset or 0)


@dataclass(frozen=True, slots=True)
class ChapterRecord:
    """A chapter row used to resolve annotation positions."""

    title: str | None
    content_id: str
    spine_index: float


PATH_LIKE_CHAPTER_SUFFIXES = frozenset({".htm", ".html", ".xhtml"})
CHAPTER_FILENAME_TITLES = {
    "acknowledgments": "Acknowledgments",
    "acknowledgements": "Acknowledgements",
    "afterword": "Afterword",
    "appendix": "Appendix",
    "authorbio": "Author Bio",
    "bibliography": "Bibliography",
    "copyright": "Copyright",
    "cover": "Cover",
    "dedication": "Dedication",
    "endnotes": "Endnotes",
    "epilogue": "Epilogue",
    "foreword": "Foreword",
    "index": "Index",
    "introduction": "Introduction",
    "notes": "Notes",
    "praise": "Praise",
    "preface": "Preface",
    "prologue": "Prologue",
    "title": "Title Page",
}


def looks_like_chapter_path(value: str) -> bool:
    """Return whether Kobo stored an EPUB resource path instead of a display title."""
    normalized = value.strip().replace("\\", "/")
    suffix = PurePosixPath(normalized).suffix.casefold()
    return suffix in PATH_LIKE_CHAPTER_SUFFIXES


def usable_chapter_title(value: str | None) -> str | None:
    """Return a reader-facing chapter title, ignoring internal resource paths."""
    if value is None:
        return None
    title = value.strip()
    if not title or looks_like_chapter_path(title):
        return None
    return title


def filename_stem(value: str) -> str | None:
    """Return the filename stem from a Kobo content ID or path."""
    normalized = normalized_content_id(value).replace("\\", "/")
    if "!!" in normalized:
        normalized = normalized.split("!!", 1)[1]
    stem = PurePosixPath(normalized).stem.strip()
    return stem or None


def title_from_filename(value: str) -> str | None:
    """Derive a readable fallback from a Kobo XHTML resource name."""
    stem = filename_stem(value)
    if stem is None:
        return None

    normalized = re.sub(r"[^a-z0-9]+", "", stem.casefold())
    if normalized in CHAPTER_FILENAME_TITLES:
        return CHAPTER_FILENAME_TITLES[normalized]

    chapter_match = re.fullmatch(r"(?:ch|chapter)0*(\d+)", normalized)
    if chapter_match:
        return f"Chapter {int(chapter_match.group(1))}"

    back_matter_match = re.fullmatch(r"bm0*(\d+)", normalized)
    if back_matter_match:
        return f"Back Matter {int(back_matter_match.group(1))}"

    words = re.sub(r"[_-]+", " ", stem).strip()
    return words.title() if words else None


def display_chapter_title(
    title: str | None,
    content_id: str,
    linked_title: str | None = None,
) -> str:
    """Return the best reader-facing chapter title for a Kobo content row."""
    return (
        usable_chapter_title(title)
        or usable_chapter_title(linked_title)
        or title_from_filename(content_id)
        or "Unknown chapter"
    )


def bookmark_value(row: sqlite3.Row, bookmark_columns: set[str], column: str) -> object | None:
    """Return a Bookmark row value only when the source schema contains it."""
    return row[column] if column in bookmark_columns else None


def raw_annotation_sort_key(
    row: sqlite3.Row,
    bookmark_columns: set[str],
    chapters: list[ChapterRecord],
) -> tuple[float, float, int, str, str]:
    """Return the normalized export-order key for a raw Bookmark row."""
    content_id = optional_text(bookmark_value(row, bookmark_columns, "ContentID")) or ""
    _, spine_index = resolve_chapter(chapters, content_id)
    start_child_index = optional_int(
        bookmark_value(row, bookmark_columns, "StartContainerChildIndex")
    )
    start_offset = optional_int(bookmark_value(row, bookmark_columns, "StartOffset"))
    source_id = optional_text(bookmark_value(row, bookmark_columns, "BookmarkID")) or optional_text(
        bookmark_value(row, bookmark_columns, "UUID")
    )
    return (
        spine_index,
        optional_float(bookmark_value(row, bookmark_columns, "ChapterProgress")) or 0.0,
        kobo_sort_hint(start_child_index, start_offset),
        optional_text(bookmark_value(row, bookmark_columns, "DateCreated")) or "",
        source_id or "",
    )


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


def bookmark_text_expression(bookmark_columns: set[str], column: str) -> str:
    """Return a SQL expression for a trimmed text-like Bookmark column."""
    if column not in bookmark_columns:
        return "''"
    return f"TRIM(COALESCE(b.\"{column}\", ''))"


def nonempty_annotation_condition(bookmark_columns: set[str]) -> str:
    """Return the shared SQL predicate for exportable bookmark content."""
    text_value = bookmark_text_expression(bookmark_columns, "Text")
    note_value = bookmark_text_expression(bookmark_columns, "Annotation")
    return f"({text_value} <> '' OR {note_value} <> '')"


def visible_bookmark_condition(bookmark_columns: set[str]) -> str | None:
    """Return the shared SQL predicate for non-hidden bookmarks."""
    if "Hidden" not in bookmark_columns:
        return None
    return "LOWER(TRIM(COALESCE(CAST(b.\"Hidden\" AS TEXT), 'false'))) NOT IN ('true', '1')"


BOOKMARK_ORDER_COLUMNS = (
    "ContentID",
    "ChapterProgress",
    "StartContainerChildIndex",
    "StartOffset",
    "DateCreated",
    "BookmarkID",
    "UUID",
)


def bookmark_order_clause(bookmark_columns: set[str]) -> str:
    """Return a deterministic ORDER BY clause for Bookmark rows."""
    order_terms = [
        f'b."{column}"' for column in BOOKMARK_ORDER_COLUMNS if column in bookmark_columns
    ]
    return f" ORDER BY {', '.join(order_terms)}" if order_terms else ""


def chapter_index_expression(columns: set[str]) -> str:
    """Return the Kobo content-table expression that best approximates spine order."""
    if "SpineIndex" in columns and "VolumeIndex" in columns:
        return 'COALESCE("SpineIndex", "VolumeIndex", 0)'
    if "SpineIndex" in columns:
        return 'COALESCE("SpineIndex", 0)'
    if "VolumeIndex" in columns:
        return 'COALESCE("VolumeIndex", 0)'
    return "0"


def chapter_order_clause(columns: set[str]) -> str:
    """Return a deterministic ORDER BY clause for chapter content rows."""
    order_terms: list[str] = []
    if "SpineIndex" in columns or "VolumeIndex" in columns:
        order_terms.append(chapter_index_expression(columns))
    if "ContentID" in columns:
        order_terms.append('"ContentID"')
    return f" ORDER BY {', '.join(order_terms)}" if order_terms else ""


@dataclass(slots=True)
class KoboRepository:
    """Queries Kobo annotation data from a local database snapshot."""

    connection: sqlite3.Connection

    def list_books(self) -> list[Book]:
        bookmark_columns = table_columns(self.connection, "Bookmark")
        content_columns = table_columns(self.connection, "content")
        if "VolumeID" not in bookmark_columns:
            raise AfterBookError("Unsupported Kobo database: Bookmark.VolumeID is missing")
        if "ContentID" not in content_columns:
            raise AfterBookError("Unsupported Kobo database: content.ContentID is missing")

        text_value = bookmark_text_expression(bookmark_columns, "Text")
        note_value = bookmark_text_expression(bookmark_columns, "Annotation")
        conditions = [
            'b."VolumeID" IS NOT NULL',
            "TRIM(CAST(b.\"VolumeID\" AS TEXT)) <> ''",
            nonempty_annotation_condition(bookmark_columns),
        ]
        visible_condition = visible_bookmark_condition(bookmark_columns)
        if visible_condition is not None:
            conditions.append(visible_condition)

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
                WHERE {" AND ".join(conditions)}
                GROUP BY b."VolumeID"
            )
            SELECT a.content_id, a.highlight_count, a.note_count, {", ".join(book_fields)}
            FROM annotated_books a
            LEFT JOIN content c ON c."ContentID" = a.content_id
            ORDER BY COALESCE({title_sort}, a.content_id) COLLATE NOCASE
        """
        return [self.book_from_row(row) for row in self.connection.execute(query).fetchall()]

    def book_from_row(self, row: sqlite3.Row) -> Book:
        title = optional_text(row["title"])
        content_id = optional_text(row["content_id"]) or ""
        return Book(
            source_id=content_id,
            title=title or "Untitled",
            author=optional_text(row["author"]),
            subtitle=optional_text(row["subtitle"]),
            isbn=optional_text(row["isbn"]),
            language=optional_text(row["language"]),
            publisher=optional_text(row["publisher"]),
            series=optional_text(row["series"]),
            series_number=optional_series_number(row["series_number"]),
            description=optional_text(row["description"]),
            highlight_count=optional_int(row["highlight_count"]) or 0,
            note_count=optional_int(row["note_count"]) or 0,
        )

    def annotations_for(self, book: Book) -> list[Annotation]:
        bookmark_columns = table_columns(self.connection, "Bookmark")
        fields = [
            (f'b."{column}" AS "{alias}"' if column in bookmark_columns else f'NULL AS "{alias}"')
            for alias, column in ANNOTATION_COLUMNS.items()
        ]
        conditions = [
            'b."VolumeID" = ?',
            nonempty_annotation_condition(bookmark_columns),
        ]
        visible_condition = visible_bookmark_condition(bookmark_columns)
        if visible_condition is not None:
            conditions.append(visible_condition)
        query = (
            f"SELECT {', '.join(fields)} FROM Bookmark b WHERE {' AND '.join(conditions)}"
            f"{bookmark_order_clause(bookmark_columns)}"
        )
        chapters = self.chapter_records(book.source_id)
        annotations = [
            self.annotation_from_row(row, chapters)
            for row in self.connection.execute(query, (book.source_id,)).fetchall()
        ]
        return sorted(annotations, key=lambda annotation: annotation.sort_key)

    def raw_book_for(self, book: Book) -> dict[str, JsonValue]:
        """Return the raw Kobo content row for a book."""
        content_columns = table_columns(self.connection, "content")
        if "ContentID" not in content_columns:
            return {"ContentID": book.source_id}
        row = self.connection.execute(
            'SELECT * FROM content WHERE "ContentID" = ? LIMIT 1',
            (book.source_id,),
        ).fetchone()
        if row is None:
            return {"ContentID": book.source_id}
        return raw_json_row(row)

    def raw_annotations_for(self, book: Book) -> list[dict[str, JsonValue]]:
        """Return the raw Kobo Bookmark rows exported for a book."""
        bookmark_columns = table_columns(self.connection, "Bookmark")
        if "VolumeID" not in bookmark_columns:
            return []
        conditions = [
            'b."VolumeID" = ?',
            nonempty_annotation_condition(bookmark_columns),
        ]
        visible_condition = visible_bookmark_condition(bookmark_columns)
        if visible_condition is not None:
            conditions.append(visible_condition)
        query = (
            f"SELECT b.* FROM Bookmark b WHERE {' AND '.join(conditions)}"
            f"{bookmark_order_clause(bookmark_columns)}"
        )
        rows = self.connection.execute(query, (book.source_id,)).fetchall()
        chapters = self.chapter_records(book.source_id)
        rows = sorted(
            rows,
            key=lambda row: raw_annotation_sort_key(row, bookmark_columns, chapters),
        )
        return [raw_json_row(row) for row in rows]

    def raw_chapters_for(self, book: Book) -> list[dict[str, JsonValue]]:
        """Return raw Kobo content rows used for chapter normalization."""
        content_columns = table_columns(self.connection, "content")
        if "BookID" not in content_columns:
            return []
        query = f'SELECT * FROM content WHERE "BookID" = ?{chapter_order_clause(content_columns)}'
        rows = self.connection.execute(query, (book.source_id,)).fetchall()
        return [raw_json_row(row) for row in rows]

    def chapter_records(self, book_id: str) -> list[ChapterRecord]:
        columns = table_columns(self.connection, "content")
        if "BookID" not in columns or "ContentID" not in columns:
            return []
        title_expression = '"Title"' if "Title" in columns else "NULL"
        bookmarked_expression = (
            '"ChapterIDBookmarked"' if "ChapterIDBookmarked" in columns else "NULL"
        )
        index_expression = chapter_index_expression(columns)
        query = (
            f"SELECT {title_expression} AS title, "
            f'"ContentID" AS content_id, '
            f"{bookmarked_expression} AS chapter_id_bookmarked, "
            f"{index_expression} AS spine_index "
            'FROM content WHERE "BookID" = ?'
            f"{chapter_order_clause(columns)}"
        )
        rows = self.connection.execute(query, (book_id,)).fetchall()
        linked_titles: dict[str, str] = {}
        for row in rows:
            parent_content_id = normalized_content_id(
                optional_text(row["chapter_id_bookmarked"]) or ""
            )
            title = usable_chapter_title(optional_text(row["title"]))
            if parent_content_id and title:
                linked_titles.setdefault(parent_content_id, title)

        records: list[ChapterRecord] = []
        for row in rows:
            content_id = normalized_content_id(optional_text(row["content_id"]) or "")
            if not content_id:
                continue
            records.append(
                ChapterRecord(
                    title=display_chapter_title(
                        optional_text(row["title"]),
                        content_id,
                        linked_titles.get(content_id),
                    ),
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
        color_code = optional_int(row["color_code"])
        color = KOBO_HIGHLIGHT_PALETTE.get(color_code) if color_code is not None else None
        bookmark_id = optional_text(row["bookmark_id"])
        uuid = optional_text(row["uuid"])
        start_child_index = optional_int(row["start_container_child_index"])
        start_offset = optional_int(row["start_offset"])
        return Annotation(
            source_id=bookmark_id or uuid,
            text=(optional_text(row["text"]) or "").strip(),
            note=optional_text(row["note"]) or "",
            location=AnnotationLocation(
                chapter=chapter,
                chapter_index=spine_index,
                progress=optional_float(row["chapter_progress"]) or 0.0,
                locator=content_id or None,
                locator_type="kobo-content-id" if content_id else None,
                sort_hint=kobo_sort_hint(start_child_index, start_offset),
            ),
            color_name=color.name if color else None,
            color_hex=color.hex_value if color else None,
            kind=optional_text(row["annotation_type"]),
            created_at=optional_text(row["date_created"]),
            modified_at=optional_text(row["date_modified"]),
        )


def normalized_content_id(content_id: str) -> str:
    """Normalize an annotation content identifier for chapter matching."""
    return content_id.replace("\\", "/").split("#", 1)[0]


CONTENT_ID_BOUNDARIES = frozenset({"/", "!", "?", "."})


def has_content_id_prefix(value: str, prefix: str) -> bool:
    """Return whether a content ID starts with a prefix at a path-like boundary."""
    if not value.startswith(prefix):
        return False
    if len(value) == len(prefix):
        return True
    return value[len(prefix)] in CONTENT_ID_BOUNDARIES


def content_ids_match(annotation_id: str, chapter_id: str) -> bool:
    """Return whether an annotation content ID belongs to a chapter content ID."""
    return has_content_id_prefix(annotation_id, chapter_id) or has_content_id_prefix(
        chapter_id, annotation_id
    )


def resolve_chapter(records: list[ChapterRecord], content_id: str) -> tuple[str, float]:
    """Resolve an annotation content identifier to a chapter."""
    normalized_id = normalized_content_id(content_id)
    if not normalized_id:
        return "Unknown chapter", 0.0
    matches = [record for record in records if content_ids_match(normalized_id, record.content_id)]
    if not matches:
        return "Unknown chapter", 0.0
    best_match = max(matches, key=lambda record: len(record.content_id))
    return best_match.title or "Unknown chapter", best_match.spine_index
