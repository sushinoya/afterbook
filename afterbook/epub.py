"""Create standalone EPUB books from reader annotations."""

from __future__ import annotations

import re
import unicodedata
import uuid
import zipfile
from contextlib import suppress
from datetime import datetime, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile

from afterbook.archive import archive_json
from afterbook.epub_utils import (
    STYLESHEET,
    chapter_document,
    container_document,
    cover_document,
    navigation_document,
    ncx_document,
    package_document,
    title_document,
)
from afterbook.models import Annotation
from afterbook.readers.base import ReaderExport

EPUB_MIMETYPE = "application/epub+zip"
CONTENT_DIRECTORY = "OEBPS"
CONTAINER_PATH = "META-INF/container.xml"
PACKAGE_PATH = f"{CONTENT_DIRECTORY}/content.opf"
STYLESHEET_PATH = f"{CONTENT_DIRECTORY}/styles.css"
TITLE_PATH = f"{CONTENT_DIRECTORY}/title.xhtml"
NAVIGATION_PATH = f"{CONTENT_DIRECTORY}/nav.xhtml"
NCX_PATH = f"{CONTENT_DIRECTORY}/toc.ncx"
ANNOTATION_ARCHIVE_PATH = f"{CONTENT_DIRECTORY}/archive/annotations.json"
COVER_PAGE_PATH = f"{CONTENT_DIRECTORY}/cover.xhtml"

MAX_FILENAME_LENGTH = 180
WINDOWS_RESERVED_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{number}" for number in range(1, 10)),
    *(f"LPT{number}" for number in range(1, 10)),
}


def safe_filename(value: str) -> str:
    """Create a portable filename from a book title."""
    normalized = unicodedata.normalize("NFC", value)
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", normalized)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" .")
    cleaned = truncate_filename(cleaned)
    if cleaned.upper() in WINDOWS_RESERVED_NAMES:
        cleaned = f"{cleaned} Book"
    cleaned = truncate_filename(cleaned)
    return cleaned or "My Clippings"


def truncate_filename(value: str) -> str:
    """Truncate a filename stem by bytes without splitting UTF-8 codepoints."""
    encoded = value.encode("utf-8")
    if len(encoded) <= MAX_FILENAME_LENGTH:
        return value.rstrip(" .")
    return encoded[:MAX_FILENAME_LENGTH].decode("utf-8", errors="ignore").rstrip(" .")


def grouped_annotations(
    annotations: list[Annotation],
) -> list[tuple[str, list[Annotation]]]:
    """Group adjacent annotations by source chapter without changing their order."""
    groups: list[tuple[str, list[Annotation]]] = []
    previous_key: tuple[float, str] | None = None

    for annotation in annotations:
        key = (annotation.location.chapter_index, annotation.location.chapter)
        if key != previous_key:
            groups.append((annotation.location.chapter, []))
            previous_key = key
        groups[-1][1].append(annotation)

    return groups


def content_path(filename: str) -> str:
    """Return a ZIP path inside the EPUB content directory."""
    return f"{CONTENT_DIRECTORY}/{filename}"


def write_epub(
    export: ReaderExport,
    output_directory: Path,
) -> Path:
    """Write a standalone clipping EPUB and return its path."""
    book = export.book
    annotations = export.annotations
    cover = export.cover
    output_title = f"{book.title} - My Clippings"
    language = book.language or "en"
    output_directory.mkdir(parents=True, exist_ok=True)
    output_path = output_directory / f"{safe_filename(output_title)}.epub"

    groups = grouped_annotations(annotations)
    chapters = [
        (title, f"chapter-{index}.xhtml") for index, (title, _) in enumerate(groups, start=1)
    ]
    identifier = f"urn:uuid:{uuid.uuid5(uuid.NAMESPACE_URL, book.source_id + ':afterbook')}"
    modified = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    temporary_path: Path | None = None
    try:
        with NamedTemporaryFile(
            prefix=".afterbook-",
            suffix=".epub.tmp",
            dir=output_directory,
            delete=False,
        ) as temporary_file:
            temporary_path = Path(temporary_file.name)

        with zipfile.ZipFile(temporary_path, "w", compression=zipfile.ZIP_DEFLATED) as epub:
            # EPUB requires mimetype to be the first ZIP entry and stored without compression.
            epub.writestr("mimetype", EPUB_MIMETYPE, compress_type=zipfile.ZIP_STORED)
            epub.writestr(CONTAINER_PATH, container_document())
            epub.writestr(STYLESHEET_PATH, STYLESHEET)
            epub.writestr(TITLE_PATH, title_document(book, output_title, language))
            epub.writestr(NAVIGATION_PATH, navigation_document(chapters, language))
            epub.writestr(NCX_PATH, ncx_document(output_title, identifier, chapters))
            epub.writestr(ANNOTATION_ARCHIVE_PATH, archive_json(export))

            for (chapter_title, chapter_annotations), (_, filename) in zip(
                groups, chapters, strict=True
            ):
                epub.writestr(
                    content_path(filename),
                    chapter_document(chapter_title, chapter_annotations, language),
                )

            if cover is not None:
                epub.writestr(content_path(f"cover.{cover.extension}"), cover.data)
                epub.writestr(COVER_PAGE_PATH, cover_document(cover))

            # content.opf is written last because it describes every resource above.
            epub.writestr(
                PACKAGE_PATH,
                package_document(
                    book,
                    output_title,
                    identifier,
                    language,
                    chapters,
                    cover,
                    modified,
                ),
            )

        temporary_path.replace(output_path)
    finally:
        if temporary_path is not None and temporary_path.exists():
            with suppress(OSError):
                temporary_path.unlink()

    return output_path
