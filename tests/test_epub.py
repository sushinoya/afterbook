from __future__ import annotations

import xml.etree.ElementTree as ET
import zipfile
from contextlib import closing
from pathlib import Path

from kobokeeps.database import KoboRepository, open_database
from kobokeeps.epub import safe_filename, write_epub
from kobokeeps.epub_utils import cover_document
from kobokeeps.models import KOBO_HIGHLIGHT_PALETTE


def load_book(kobo_database: Path):
    with closing(open_database(kobo_database)) as connection:
        repository = KoboRepository(connection)
        book = repository.list_books()[0]
        annotations = repository.annotations_for(book)
    return book, annotations


def test_epub_contains_colored_highlights(kobo_database: Path, tmp_path: Path) -> None:
    book, annotations = load_book(kobo_database)
    output = write_epub(book, annotations, tmp_path)

    with zipfile.ZipFile(output) as epub:
        chapter_one = epub.read("OEBPS/chapter-1.xhtml").decode()
        chapter_two = epub.read("OEBPS/chapter-2.xhtml").decode()

    assert (
        f'style="background-color: {KOBO_HIGHLIGHT_PALETTE[0].hex_value};">'
        "A yellow passage from chapter one.</span>"
    ) in chapter_one
    assert (
        f'style="background-color: {KOBO_HIGHLIGHT_PALETTE[1].hex_value};">'
        "A pink passage.</span>"
    ) in chapter_one
    assert (
        f'style="background-color: {KOBO_HIGHLIGHT_PALETTE[2].hex_value};">'
        "A blue passage from chapter two.</span>"
    ) in chapter_two
    assert (
        f'style="background-color: {KOBO_HIGHLIGHT_PALETTE[3].hex_value};">'
        "A green passage.</span>"
    ) in chapter_two


def test_title_page_is_minimal(kobo_database: Path, tmp_path: Path) -> None:
    book, annotations = load_book(kobo_database)
    output = write_epub(book, annotations, tmp_path)

    with zipfile.ZipFile(output) as epub:
        title_page = epub.read("OEBPS/title.xhtml").decode()

    assert "Why Fish Don't Exist - My Clippings" in title_page
    assert "Lulu Miller" in title_page
    assert "4 highlights, 1 note" in title_page
    assert "Simon &amp; Schuster" not in title_page
    assert "9781501160370" not in title_page
    assert "Personal clipping companion" not in title_page


def test_epub_stores_mimetype_first_and_uncompressed(kobo_database: Path, tmp_path: Path) -> None:
    book, annotations = load_book(kobo_database)
    output = write_epub(book, annotations, tmp_path)

    with zipfile.ZipFile(output) as epub:
        first_entry = epub.infolist()[0]
        assert first_entry.filename == "mimetype"
        assert first_entry.compress_type == zipfile.ZIP_STORED


def test_cover_page_is_full_page_and_centered() -> None:
    from kobokeeps.models import CoverImage

    cover = CoverImage(b"image", "image/jpeg", "jpg", 1264, 1680)
    page = cover_document(cover).decode()

    assert '@page { margin: 0; padding: 0; }' in page
    assert 'viewBox="0 0 1264 1680"' in page
    assert 'preserveAspectRatio="xMidYMid meet"' in page
    assert 'display: block; width: 100%; height: 100%' in page
    assert 'epub:type="cover"' in page
    assert 'meta name="viewport" content="width=1264, height=1680"' in page


def test_epub_does_not_show_annotation_timestamps(kobo_database: Path, tmp_path: Path) -> None:
    book, annotations = load_book(kobo_database)
    output = write_epub(book, annotations, tmp_path)

    with zipfile.ZipFile(output) as epub:
        visible_content = "\n".join(
            epub.read(name).decode()
            for name in epub.namelist()
            if name.endswith(".xhtml")
        )
        archive = epub.read("OEBPS/archive/kobo-annotations.json").decode()

    assert "2024-01-25T16:27:37.000" not in visible_content
    assert "2024-01-25T16:27:37.000" in archive


def test_notes_are_unlabelled_blockquotes(kobo_database: Path, tmp_path: Path) -> None:
    book, annotations = load_book(kobo_database)
    output = write_epub(book, annotations, tmp_path)

    with zipfile.ZipFile(output) as epub:
        chapter = epub.read("OEBPS/chapter-2.xhtml").decode()

    assert '<blockquote class="note">This is my note.</blockquote>' in chapter
    assert "My note" not in chapter


def test_epub_xml_documents_are_well_formed(kobo_database: Path, tmp_path: Path) -> None:
    book, annotations = load_book(kobo_database)
    output = write_epub(book, annotations, tmp_path)

    with zipfile.ZipFile(output) as epub:
        xml_files = [
            "META-INF/container.xml",
            "OEBPS/title.xhtml",
            "OEBPS/nav.xhtml",
            "OEBPS/toc.ncx",
            "OEBPS/content.opf",
            "OEBPS/chapter-1.xhtml",
            "OEBPS/chapter-2.xhtml",
        ]
        for filename in xml_files:
            ET.fromstring(epub.read(filename))


def test_epub_package_contains_compatibility_metadata(
    kobo_database: Path, tmp_path: Path
) -> None:
    book, annotations = load_book(kobo_database)
    output = write_epub(book, annotations, tmp_path)

    with zipfile.ZipFile(output) as epub:
        package = ET.fromstring(epub.read("OEBPS/content.opf"))

    namespaces = {
        "opf": "http://www.idpf.org/2007/opf",
        "dc": "http://purl.org/dc/elements/1.1/",
    }
    source = package.find("opf:metadata/dc:source", namespaces)
    assert source is not None
    assert source.text == "Why Fish Don't Exist"
    assert package.find("opf:manifest/opf:item[@id='ncx']", namespaces) is not None
    spine = package.find("opf:spine", namespaces)
    assert spine is not None
    assert spine.attrib["toc"] == "ncx"
    modified = package.find("opf:metadata/opf:meta[@property='dcterms:modified']", namespaces)
    assert modified is not None


def test_cover_manifest_marks_svg_page(kobo_database: Path, tmp_path: Path) -> None:
    from kobokeeps.models import CoverImage

    book, annotations = load_book(kobo_database)
    cover = CoverImage(b"fake jpeg", "image/jpeg", "jpg", 1264, 1680)
    output = write_epub(book, annotations, tmp_path, cover)

    with zipfile.ZipFile(output) as epub:
        package = ET.fromstring(epub.read("OEBPS/content.opf"))

    namespace = {"opf": "http://www.idpf.org/2007/opf"}
    cover_image = package.find("opf:manifest/opf:item[@id='cover-image']", namespace)
    cover_page = package.find("opf:manifest/opf:item[@id='cover-page']", namespace)
    assert cover_image is not None
    assert cover_image.attrib["properties"] == "cover-image"
    assert cover_page is not None
    assert cover_page.attrib["properties"] == "svg"


def test_safe_filename_is_portable() -> None:
    assert safe_filename('Bad: <book>?') == "Bad book"
    assert safe_filename("CON") == "CON Book"
    assert len(safe_filename("x" * 300)) == 180
