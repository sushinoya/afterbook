"""Domain models used by KoboKeeps."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class ReadingStatistics:
    """Reading statistics stored by Kobo for a book."""

    read_status: int | None = None
    percent_read: float | None = None
    date_last_read: str | None = None
    time_spent_reading: float | int | None = None
    times_started_reading: int | None = None
    last_time_started_reading: str | None = None
    last_time_finished_reading: str | None = None
    store_pages: int | None = None
    store_word_count: int | None = None
    rating: float | int | None = None
    rating_date_modified: str | None = None


@dataclass(frozen=True, slots=True)
class Book:
    """A Kobo book with annotations."""

    content_id: str
    title: str
    author: str | None = None
    subtitle: str | None = None
    isbn: str | None = None
    language: str | None = None
    publisher: str | None = None
    series: str | None = None
    series_number: str | float | int | None = None
    image_id: str | None = None
    date_created: str | None = None
    highlight_count: int = 0
    note_count: int = 0
    reading_statistics: ReadingStatistics = field(default_factory=ReadingStatistics)
