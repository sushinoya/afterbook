"""Build the XML and XHTML documents stored inside a KoboKeeps EPUB."""

from __future__ import annotations

import xml.etree.ElementTree as ET

from kobokeeps.models import Annotation, Book, CoverImage, highlight_color

XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml"
EPUB_NAMESPACE = "http://www.idpf.org/2007/ops"
SVG_NAMESPACE = "http://www.w3.org/2000/svg"
XLINK_NAMESPACE = "http://www.w3.org/1999/xlink"
OPF_NAMESPACE = "http://www.idpf.org/2007/opf"
DC_NAMESPACE = "http://purl.org/dc/elements/1.1/"
NCX_NAMESPACE = "http://www.daisy.org/z3986/2005/ncx/"
CONTAINER_NAMESPACE = "urn:oasis:names:tc:opendocument:xmlns:container"
DCTERMS_PREFIX = "dcterms: http://purl.org/dc/terms/"

# All reading documents share one stylesheet. Highlight colors stay inline on the
# selected text because Kobo's renderer has historically been more reliable with
# inline background colors than with semantic mark styling alone.
STYLESHEET = """
body { font-family: serif; line-height: 1.5; margin: 5%; }
h1 { margin-bottom: 1.5em; }
.clipping { margin: 1.5em 0; }
.highlight { margin: 0; }
.highlight-text {
  padding: 0.08em 0.12em;
  white-space: pre-wrap;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}
.note {
  margin: 0.8em 1.5em;
  padding-left: 0.8em;
  border-left: 0.15em solid #999;
  white-space: pre-wrap;
}
""".strip()

# The cover page deliberately has no margins. An SVG viewport lets Kobo scale a
# cached portrait or landscape cover to the screen while preserving its aspect ratio.
COVER_STYLESHEET = """
@page { margin: 0; padding: 0; }
html, body { width: 100%; height: 100%; margin: 0; padding: 0; }
body { overflow: hidden; }
svg { display: block; width: 100%; height: 100%; margin: 0; padding: 0; }
""".strip()


def xml_bytes(root: ET.Element) -> bytes:
    """Serialize an XML tree with the declaration EPUB readers expect."""
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def xhtml_page(title: str, language: str) -> tuple[ET.Element, ET.Element]:
    """Create the common XHTML shell and return its root and body."""
    root = ET.Element(
        "html",
        {
            "xmlns": XHTML_NAMESPACE,
            "xml:lang": language,
            "lang": language,
        },
    )
    head = ET.SubElement(root, "head")
    ET.SubElement(head, "title").text = title
    ET.SubElement(
        head,
        "link",
        {"rel": "stylesheet", "type": "text/css", "href": "styles.css"},
    )
    return root, ET.SubElement(root, "body")


def title_document(book: Book, output_title: str, language: str) -> bytes:
    """Build the minimal title page shown before the clippings."""
    root, body = xhtml_page(output_title, language)
    ET.SubElement(body, "h1").text = output_title
    if book.author:
        ET.SubElement(body, "p").text = book.author

    highlight_word = "highlight" if book.highlight_count == 1 else "highlights"
    note_word = "note" if book.note_count == 1 else "notes"
    ET.SubElement(body, "p").text = (
        f"{book.highlight_count} {highlight_word}, {book.note_count} {note_word}"
    )
    return xml_bytes(root)


def chapter_document(chapter: str, annotations: list[Annotation], language: str) -> bytes:
    """Build one source chapter containing its highlights and notes."""
    root, body = xhtml_page(chapter, language)
    ET.SubElement(body, "h1").text = chapter

    for annotation in annotations:
        clipping = ET.SubElement(body, "section", {"class": "clipping"})
        if annotation.text:
            paragraph = ET.SubElement(clipping, "p", {"class": "highlight"})
            color = highlight_color(annotation.color_code)
            highlight = ET.SubElement(
                paragraph,
                "span",
                {
                    "class": "highlight-text",
                    "style": f"background-color: {color.hex_value};",
                },
            )
            highlight.text = annotation.text
        if annotation.note:
            ET.SubElement(clipping, "blockquote", {"class": "note"}).text = annotation.note

    return xml_bytes(root)


def cover_document(cover: CoverImage) -> bytes:
    """Build a full-page cover that centers and scales the cached Kobo image."""
    root = ET.Element(
        "html",
        {
            "xmlns": XHTML_NAMESPACE,
            "xmlns:epub": EPUB_NAMESPACE,
        },
    )
    head = ET.SubElement(root, "head")
    ET.SubElement(head, "title").text = "Cover"
    ET.SubElement(
        head,
        "meta",
        {
            "name": "viewport",
            "content": f"width={cover.width}, height={cover.height}",
        },
    )
    ET.SubElement(head, "style", {"type": "text/css"}).text = COVER_STYLESHEET

    body = ET.SubElement(root, "body", {"epub:type": "cover"})
    svg = ET.SubElement(
        body,
        "svg",
        {
            "xmlns": SVG_NAMESPACE,
            "xmlns:xlink": XLINK_NAMESPACE,
            "width": "100%",
            "height": "100%",
            "viewBox": f"0 0 {cover.width} {cover.height}",
            "preserveAspectRatio": "xMidYMid meet",
        },
    )
    cover_filename = f"cover.{cover.extension}"
    ET.SubElement(
        svg,
        "image",
        {
            "x": "0",
            "y": "0",
            "width": str(cover.width),
            "height": str(cover.height),
            "preserveAspectRatio": "xMidYMid meet",
            "href": cover_filename,
            "xlink:href": cover_filename,
        },
    )
    return xml_bytes(root)


def navigation_document(chapters: list[tuple[str, str]], language: str) -> bytes:
    """Build the EPUB 3 navigation document used by modern Kobo readers."""
    root, body = xhtml_page("Contents", language)
    navigation = ET.SubElement(
        body,
        "nav",
        {
            "xmlns:epub": EPUB_NAMESPACE,
            "epub:type": "toc",
            "id": "toc",
        },
    )
    ET.SubElement(navigation, "h1").text = "Contents"
    ordered_list = ET.SubElement(navigation, "ol")

    title_item = ET.SubElement(ordered_list, "li")
    ET.SubElement(title_item, "a", {"href": "title.xhtml"}).text = "Clippings"
    for title, filename in chapters:
        item = ET.SubElement(ordered_list, "li")
        ET.SubElement(item, "a", {"href": filename}).text = title

    return xml_bytes(root)


def ncx_document(
    output_title: str,
    identifier: str,
    chapters: list[tuple[str, str]],
) -> bytes:
    """Build the legacy NCX table of contents still understood by Kobo."""
    root = ET.Element("ncx", {"xmlns": NCX_NAMESPACE, "version": "2005-1"})
    head = ET.SubElement(root, "head")
    ET.SubElement(head, "meta", {"name": "dtb:uid", "content": identifier})
    title = ET.SubElement(root, "docTitle")
    ET.SubElement(title, "text").text = output_title
    navigation = ET.SubElement(root, "navMap")

    add_ncx_point(navigation, "title", 1, "Clippings", "title.xhtml")
    for play_order, (chapter_title, filename) in enumerate(chapters, start=2):
        add_ncx_point(
            navigation,
            f"chapter-{play_order - 1}",
            play_order,
            chapter_title,
            filename,
        )

    return xml_bytes(root)


def add_ncx_point(
    navigation: ET.Element,
    point_id: str,
    play_order: int,
    label: str,
    source: str,
) -> None:
    """Append one NCX navigation point."""
    point = ET.SubElement(
        navigation,
        "navPoint",
        {"id": point_id, "playOrder": str(play_order)},
    )
    label_element = ET.SubElement(point, "navLabel")
    ET.SubElement(label_element, "text").text = label
    ET.SubElement(point, "content", {"src": source})


def add_manifest_item(
    manifest: ET.Element,
    item_id: str,
    href: str,
    media_type: str,
    *,
    properties: str | None = None,
    fallback: str | None = None,
) -> None:
    """Append one resource to the EPUB package manifest."""
    attributes = {"id": item_id, "href": href, "media-type": media_type}
    if properties:
        attributes["properties"] = properties
    if fallback:
        attributes["fallback"] = fallback
    ET.SubElement(manifest, "item", attributes)


def add_book_metadata(metadata: ET.Element, book: Book) -> None:
    """Preserve source-book metadata without displaying it in the reading flow."""
    if book.author:
        ET.SubElement(metadata, "dc:creator").text = book.author
    if book.publisher:
        ET.SubElement(metadata, "dc:publisher").text = book.publisher
    if book.isbn:
        ET.SubElement(metadata, "dc:identifier").text = book.isbn
    if book.description:
        ET.SubElement(metadata, "dc:description").text = book.description
    if not book.series:
        return

    collection = ET.SubElement(
        metadata,
        "meta",
        {"property": "belongs-to-collection", "id": "series"},
    )
    collection.text = book.series
    collection_type = ET.SubElement(
        metadata,
        "meta",
        {"refines": "#series", "property": "collection-type"},
    )
    collection_type.text = "series"
    if book.series_number is not None:
        position = ET.SubElement(
            metadata,
            "meta",
            {"refines": "#series", "property": "group-position"},
        )
        position.text = str(book.series_number)


def package_document(
    book: Book,
    output_title: str,
    identifier: str,
    language: str,
    chapters: list[tuple[str, str]],
    cover: CoverImage | None,
    modified: str,
) -> bytes:
    """Build content.opf, the package manifest, metadata, and reading order."""
    package = ET.Element(
        "package",
        {
            "xmlns": OPF_NAMESPACE,
            "version": "3.0",
            "unique-identifier": "book-id",
            "prefix": DCTERMS_PREFIX,
        },
    )
    metadata = ET.SubElement(package, "metadata", {"xmlns:dc": DC_NAMESPACE})
    ET.SubElement(metadata, "dc:identifier", {"id": "book-id"}).text = identifier
    ET.SubElement(metadata, "dc:title").text = output_title
    ET.SubElement(metadata, "dc:language").text = language
    ET.SubElement(metadata, "dc:source").text = book.title
    ET.SubElement(metadata, "meta", {"property": "dcterms:modified"}).text = modified
    add_book_metadata(metadata, book)

    manifest = ET.SubElement(package, "manifest")
    add_manifest_item(manifest, "css", "styles.css", "text/css")
    add_manifest_item(manifest, "title", "title.xhtml", "application/xhtml+xml")
    add_manifest_item(
        manifest,
        "nav",
        "nav.xhtml",
        "application/xhtml+xml",
        properties="nav",
    )
    add_manifest_item(manifest, "ncx", "toc.ncx", "application/x-dtbncx+xml")
    add_manifest_item(
        manifest,
        "archive",
        "archive/kobo-annotations.json",
        "application/json",
        fallback="title",
    )

    spine = ET.SubElement(package, "spine", {"toc": "ncx"})
    if cover is not None:
        ET.SubElement(metadata, "meta", {"name": "cover", "content": "cover-image"})
        add_manifest_item(
            manifest,
            "cover-image",
            f"cover.{cover.extension}",
            cover.media_type,
            properties="cover-image",
        )
        add_manifest_item(
            manifest,
            "cover-page",
            "cover.xhtml",
            "application/xhtml+xml",
            properties="svg",
        )
        ET.SubElement(spine, "itemref", {"idref": "cover-page"})

    ET.SubElement(spine, "itemref", {"idref": "title"})
    for index, (_, filename) in enumerate(chapters, start=1):
        item_id = f"chapter-{index}"
        add_manifest_item(manifest, item_id, filename, "application/xhtml+xml")
        ET.SubElement(spine, "itemref", {"idref": item_id})

    return xml_bytes(package)


def container_document() -> bytes:
    """Build META-INF/container.xml, which points EPUB readers at content.opf."""
    container = ET.Element(
        "container",
        {"xmlns": CONTAINER_NAMESPACE, "version": "1.0"},
    )
    rootfiles = ET.SubElement(container, "rootfiles")
    ET.SubElement(
        rootfiles,
        "rootfile",
        {
            "full-path": "OEBPS/content.opf",
            "media-type": "application/oebps-package+xml",
        },
    )
    return xml_bytes(container)
