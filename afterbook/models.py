"""Domain models used by AfterBook."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TypeAlias

JsonValue: TypeAlias = str | int | float | bool | list["JsonValue"] | dict[str, "JsonValue"] | None


@dataclass(frozen=True, slots=True)
class Book:
    """An ebook reader book with annotations."""

    source_id: str
    title: str
    author: str | None = None
    subtitle: str | None = None
    isbn: str | None = None
    language: str | None = None
    publisher: str | None = None
    series: str | None = None
    series_number: str | float | int | None = None
    description: str | None = None
    highlight_count: int = 0
    note_count: int = 0
    extra_metadata: dict[str, JsonValue] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class AnnotationLocation:
    """Position of an annotation in the source book."""

    chapter: str
    chapter_index: float = 0.0
    progress: float = 0.0
    locator: str | None = None
    locator_type: str | None = None
    page: str | int | None = None
    sort_hint: int | None = None


@dataclass(frozen=True, slots=True)
class Annotation:
    """A highlight or note exported from an ebook reader."""

    source_id: str | None
    text: str
    note: str
    location: AnnotationLocation
    color_name: str | None = None
    color_hex: str | None = None
    kind: str | None = None
    created_at: str | None = None
    modified_at: str | None = None

    @property
    def sort_key(self) -> tuple[float, float, int, str]:
        """Return a stable key that follows source book position."""
        return (
            self.location.chapter_index,
            self.location.progress,
            self.location.sort_hint or 0,
            self.created_at or "",
        )


@dataclass(frozen=True, slots=True)
class CoverImage:
    """A cached source book cover image."""

    data: bytes
    media_type: str
    extension: str
    width: int
    height: int
