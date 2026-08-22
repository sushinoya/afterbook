"""Supported ebook reader backends."""

from __future__ import annotations

from collections.abc import Callable
from contextlib import AbstractContextManager
from pathlib import Path
from typing import cast

from kobokeeps.errors import KoboKeepsError
from kobokeeps.readers.base import EbookReader
from kobokeeps.readers.kobo import KoboReader, open_kobo_reader

ReaderOpener = Callable[[Path | None], AbstractContextManager[EbookReader]]


def _open_kobo(source_path: Path | None) -> AbstractContextManager[EbookReader]:
    return cast(AbstractContextManager[EbookReader], open_kobo_reader(source_path))


READER_OPENERS: dict[str, ReaderOpener] = {
    KoboReader.id: _open_kobo,
}


def supported_reader_ids() -> tuple[str, ...]:
    """Return reader backend identifiers accepted by the CLI."""
    return tuple(READER_OPENERS)


def default_reader_id() -> str:
    """Return the default reader backend identifier."""
    return supported_reader_ids()[0]


def open_reader(
    reader_id: str,
    source_path: Path | None = None,
) -> AbstractContextManager[EbookReader]:
    """Open a supported ebook reader backend."""
    opener = READER_OPENERS.get(reader_id)
    if opener is not None:
        return opener(source_path)
    raise KoboKeepsError(f'Unsupported ebook reader "{reader_id}"')
