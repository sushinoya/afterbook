"""Create standalone EPUB books from Kobo annotations."""

from __future__ import annotations

import re
import unicodedata
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from kobokeeps.archive import archive_json
from kobokeeps.epub_documents import (
    STYLESHEET,
    chapter_document,
    container_document,
    cover_document,
    navigation_document,
    ncx_document,
    package_document,
    title_document,
)
from kobokeeps.models import Annotation, Book, CoverImage

EPUB_MIMETYPE = "application/epub+zip"
CONTENT_DIRECTORY = "OEBPS"
CONTAINER_PATH = "META-INF/container.xml"
PACKAGE_PATH = f"{CONTENT_DIRECTORY}/content.opf"
STYLESHEET_PATH = f"{CONTENT_DIRECTORY}/styles.css"
TITLE_PATH = f"{CONTENT_DIRECTORY}/title.xhtml"
NAVIGATION_PATH = f"{CONTENT_DIRECTORY}/nav.xhtml"
NCX_PATH = f"{CONTENT_DIRECTORY}/toc.ncx"
ANNOTATION_ARCHIVE_PATH = f"{CONTENT_DIRECTORY}/archive/kobo-annotations.json"
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
    if cleaned.upper() in WINDOWS_RESERVED_NAMES:
        cleaned = f"{cleaned} Book"
    cleaned = cleaned[:MAX_FILENAME_LENGTH].rstrip(" .")
    return cleaned or "My Clippings"


def grouped_annotations(annotations: list[Annotation]) -> list[tuple[str, list[Annotation]]]:
    """Group adjacent annotations by source chapter without changing their order."""
    groups: list[tuple[str, list[Annotation]]] = []
    previous_key: tuple[float, str] | None = None

    for annotation in annotations:
        key = (annotation.location.spine_index, annotation.location.chapter)
        if key != previous_key:
            groups.append((annotation.location.chapter, []))
            previous_key = key
        groups[-1][1].append(annotation)

    return groups


def content_path(filename: str) -> str:
    """Return a ZIP path inside the EPUB content directory."""
    return f"{CONTENT_DIRECTORY}/{filename}"


def write_epub(
    book: Book,
    annotations: list[Annotation],
    output_directory: Path,
    cover: CoverImage | None = None,
) -> Path:
    """Write a standalone clipping EPUB and return its path."""
    output_title = f"{book.title} - My Clippings"
    language = book.language or "en"
    output_directory.mkdir(parents=True, exist_ok=True)
    output_path = output_directory / f"{safe_filename(output_title)}.epub"

    groups = grouped_annotations(annotations)
    chapters = [
        (title, f"chapter-{index}.xhtml")
        for index, (title, _) in enumerate(groups, start=1)
    ]
    identifier = f"urn:uuid:{uuid.uuid5(uuid.NAMESPACE_URL, book.content_id + ':kobokeeps')}"
    modified = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as epub:
        # EPUB requires mimetype to be the first ZIP entry and stored without compression.
        epub.writestr("mimetype", EPUB_MIMETYPE, compress_type=zipfile.ZIP_STORED)
        epub.writestr(CONTAINER_PATH, container_document())
        epub.writestr(STYLESHEET_PATH, STYLESHEET)
        epub.writestr(TITLE_PATH, title_document(book, output_title, language))
        epub.writestr(NAVIGATION_PATH, navigation_document(chapters, language))
        epub.writestr(NCX_PATH, ncx_document(output_title, identifier, chapters))
        epub.writestr(ANNOTATION_ARCHIVE_PATH, archive_json(book, annotations))

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

    return output_path
