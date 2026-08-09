"""EPUB generation for personal clipping books."""

from __future__ import annotations

from collections import OrderedDict
from html import escape
from pathlib import Path
import re
import uuid
import zipfile

from kobokeeps.archive import archive_json
from kobokeeps.models import Annotation, Book, CoverImage, highlight_color

EPUB_CSS = """
body { font-family: serif; line-height: 1.5; margin: 5%; }
h1 { margin-bottom: 1.5em; }
h2 { margin-top: 1.8em; }
.clipping { margin: 1.5em 0; }
.highlight { margin: 0; }
.highlight-text { padding: 0.08em 0.12em; }
.note { margin: 0.6em 1.5em; font-style: italic; }
.cover { margin: 0; padding: 0; }
.cover img { max-width: 100%; max-height: 100%; }
""".strip()


def safe_filename(value: str) -> str:
    """Create a portable filename from a book title."""
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", value).strip().rstrip(".")
    return cleaned or "My Clippings"


def xhtml_document(title: str, body: str, language: str) -> bytes:
    """Build a small XHTML document."""
    document = f'''<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="{escape(language)}" lang="{escape(language)}">
<head>
  <title>{escape(title)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>{body}</body>
</html>
'''
    return document.encode("utf-8")


def grouped_annotations(annotations: list[Annotation]) -> OrderedDict[str, list[Annotation]]:
    """Group annotations by source chapter without changing their order."""
    groups: OrderedDict[str, list[Annotation]] = OrderedDict()
    for annotation in annotations:
        groups.setdefault(annotation.location.chapter, []).append(annotation)
    return groups


def chapter_document(chapter: str, annotations: list[Annotation], language: str) -> bytes:
    """Render one clipping chapter."""
    parts = [f"<h1>{escape(chapter)}</h1>"]
    for annotation in annotations:
        parts.append('<section class="clipping">')
        if annotation.text:
            color = highlight_color(annotation.color_code)
            parts.append(
                '<p class="highlight"><span class="highlight-text" '
                f'style="background-color: {color.hex_value};">'
                f'{escape(annotation.text)}</span></p>'
            )
        if annotation.note:
            parts.append(f'<blockquote class="note">{escape(annotation.note)}</blockquote>')
        parts.append("</section>")
    return xhtml_document(chapter, "".join(parts), language)


def title_document(book: Book, output_title: str, language: str) -> bytes:
    """Render the clipping book title page."""
    author = f"<p>{escape(book.author)}</p>" if book.author else ""
    counts = f"<p>{book.highlight_count} highlights | {book.note_count} notes</p>"
    return xhtml_document(output_title, f"<h1>{escape(output_title)}</h1>{author}{counts}", language)


def cover_document(cover: CoverImage) -> bytes:
    """Build a full-page centered EPUB cover."""
    document = f'''<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"
      xmlns:svg="http://www.w3.org/2000/svg"
      xmlns:xlink="http://www.w3.org/1999/xlink">
<head>
  <title>Cover</title>
  <style type="text/css">
    @page {{ margin: 0; padding: 0; }}
    html, body {{ width: 100%; height: 100%; margin: 0; padding: 0; }}
    body {{ overflow: hidden; text-align: center; }}
    svg {{ display: block; width: 100%; height: 100%; margin: 0 auto; padding: 0; }}
  </style>
</head>
<body>
  <svg:svg width="100%" height="100%" viewBox="0 0 {cover.width} {cover.height}"
           preserveAspectRatio="xMidYMid meet">
    <svg:image x="0" y="0" width="{cover.width}" height="{cover.height}"
               preserveAspectRatio="xMidYMid meet"
               href="cover.{cover.extension}"
               xlink:href="cover.{cover.extension}"/>
  </svg:svg>
</body>
</html>
'''
    return document.encode("utf-8")


def container_document() -> bytes:
    """Return the EPUB container document."""
    return b'''<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
'''


def navigation_document(chapters: list[tuple[str, str]], language: str) -> bytes:
    """Build the EPUB navigation document."""
    links = ['<li><a href="title.xhtml">Clippings</a></li>']
    links.extend(
        f'<li><a href="{filename}">{escape(title)}</a></li>' for title, filename in chapters
    )
    body = (
        '<nav xmlns:epub="http://www.idpf.org/2007/ops" epub:type="toc" id="toc">'
        "<h1>Contents</h1><ol>" + "".join(links) + "</ol></nav>"
    )
    return xhtml_document("Contents", body, language)


def package_document(
    book: Book,
    output_title: str,
    identifier: str,
    language: str,
    chapters: list[tuple[str, str]],
    cover: CoverImage | None,
) -> bytes:
    """Build the EPUB package document."""
    metadata = [
        f'<dc:identifier id="book-id">{escape(identifier)}</dc:identifier>',
        f"<dc:title>{escape(output_title)}</dc:title>",
        f"<dc:language>{escape(language)}</dc:language>",
    ]
    if book.author:
        metadata.append(f"<dc:creator>{escape(book.author)}</dc:creator>")
    if book.publisher:
        metadata.append(f"<dc:publisher>{escape(book.publisher)}</dc:publisher>")
    if book.isbn:
        metadata.append(f"<dc:identifier>{escape(book.isbn)}</dc:identifier>")

    manifest = [
        '<item id="css" href="styles.css" media-type="text/css"/>',
        '<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>',
        '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
        '<item id="archive" href="archive/kobo-annotations.json" media-type="application/json"/>',
    ]
    spine = ['<itemref idref="title"/>']
    if cover is not None:
        metadata.append('<meta name="cover" content="cover-image"/>')
        manifest.extend(
            [
                f'<item id="cover-image" href="cover.{cover.extension}" media-type="{cover.media_type}" properties="cover-image"/>',
                '<item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/>',
            ]
        )
        spine.insert(0, '<itemref idref="cover-page"/>')

    for index, (chapter, filename) in enumerate(chapters, start=1):
        item_id = f"chapter-{index}"
        manifest.append(
            f'<item id="{item_id}" href="{filename}" media-type="application/xhtml+xml"/>'
        )
        spine.append(f'<itemref idref="{item_id}"/>')

    document = f'''<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">{"".join(metadata)}</metadata>
  <manifest>{"".join(manifest)}</manifest>
  <spine>{"".join(spine)}</spine>
</package>
'''
    return document.encode("utf-8")


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
    chapters = [(title, f"chapter-{index}.xhtml") for index, title in enumerate(groups, 1)]
    identifier = f"urn:uuid:{uuid.uuid5(uuid.NAMESPACE_URL, book.content_id + ':kobokeeps')}"

    with zipfile.ZipFile(output_path, "w") as archive:
        archive.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        archive.writestr("META-INF/container.xml", container_document())
        archive.writestr("OEBPS/styles.css", EPUB_CSS)
        archive.writestr("OEBPS/title.xhtml", title_document(book, output_title, language))
        archive.writestr("OEBPS/nav.xhtml", navigation_document(chapters, language))
        archive.writestr("OEBPS/archive/kobo-annotations.json", archive_json(book, annotations))
        for (chapter_title, chapter_annotations), (_, filename) in zip(groups.items(), chapters):
            archive.writestr(
                f"OEBPS/{filename}",
                chapter_document(chapter_title, chapter_annotations, language),
            )
        if cover is not None:
            archive.writestr(f"OEBPS/cover.{cover.extension}", cover.data)
            archive.writestr("OEBPS/cover.xhtml", cover_document(cover))
        archive.writestr(
            "OEBPS/content.opf",
            package_document(book, output_title, identifier, language, chapters, cover),
        )

    return output_path
