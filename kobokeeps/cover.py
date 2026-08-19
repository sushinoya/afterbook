"""Read cover images from Kobo's local image cache."""

from __future__ import annotations

from pathlib import Path

from kobokeeps.models import CoverImage

KOBO_IMAGE_CACHE_DIRECTORY = ".kobo-images"
KOBO_PARSED_IMAGE_SUFFIX = ".parsed"
KOBO_COVER_VARIANTS = (
    "N3_FULL",
    "N3_LIBRARY_FULL",
    "N3_LIBRARY_GRID",
    "N3_LIBRARY_LIST",
)

HASH_BYTE_MASK = 0xFF
QT_HASH_HIGH_BITS_MASK = 0xF0000000
QT_HASH_VALUE_MASK = 0x0FFFFFFF
QT_HASH_SHIFT = 23

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
PNG_DIMENSIONS_OFFSET = 16
PNG_MINIMUM_HEADER_SIZE = 24
GIF_SIGNATURES = (b"GIF87a", b"GIF89a")
GIF_DIMENSIONS_OFFSET = 6
GIF_MINIMUM_HEADER_SIZE = 10
JPEG_SIGNATURE = b"\xff\xd8"
JPEG_MARKER_PREFIX = 0xFF
JPEG_STANDALONE_MARKERS = {0x01, 0xD8, 0xD9}
JPEG_RESTART_MARKERS = range(0xD0, 0xD8)
JPEG_FRAME_MINIMUM_SEGMENT_LENGTH = 7
JPEG_FRAME_HEIGHT_OFFSET = 3
JPEG_FRAME_WIDTH_OFFSET = 5
JPEG_DIMENSION_SIZE = 2
JPEG_START_OF_FRAME_MARKERS = {
    0xC0,
    0xC1,
    0xC2,
    0xC3,
    0xC5,
    0xC6,
    0xC7,
    0xC9,
    0xCA,
    0xCB,
    0xCD,
    0xCE,
    0xCF,
}

JPEG_MEDIA_TYPE = "image/jpeg"
PNG_MEDIA_TYPE = "image/png"
GIF_MEDIA_TYPE = "image/gif"


def qt_hash(data: bytes) -> int:
    """Return the Qt byte-array hash Kobo uses to shard cached images.

    Kobo's image cache is split into two numeric directory levels. The directory
    names are derived from this Qt hash rather than from the image ID directly.
    """
    value = 0
    for byte in data:
        value = (value << 4) + byte
        value ^= (value & QT_HASH_HIGH_BITS_MASK) >> QT_HASH_SHIFT
        value &= QT_HASH_VALUE_MASK
    return value


def png_dimensions(data: bytes) -> tuple[int, int] | None:
    """Read width and height from a PNG IHDR header."""
    if len(data) < PNG_MINIMUM_HEADER_SIZE or not data.startswith(PNG_SIGNATURE):
        return None

    width_start = PNG_DIMENSIONS_OFFSET
    height_start = width_start + 4
    width = int.from_bytes(data[width_start:height_start], "big")
    height = int.from_bytes(data[height_start : height_start + 4], "big")
    return (width, height) if width and height else None


def gif_dimensions(data: bytes) -> tuple[int, int] | None:
    """Read width and height from a GIF logical screen descriptor."""
    if len(data) < GIF_MINIMUM_HEADER_SIZE or not data.startswith(GIF_SIGNATURES):
        return None

    width_start = GIF_DIMENSIONS_OFFSET
    height_start = width_start + 2
    width = int.from_bytes(data[width_start:height_start], "little")
    height = int.from_bytes(data[height_start : height_start + 2], "little")
    return (width, height) if width and height else None


def jpeg_dimensions(data: bytes) -> tuple[int, int] | None:
    """Read JPEG dimensions without decoding the full image.

    JPEG stores dimensions in a Start Of Frame segment. The parser walks marker
    segments until it reaches one of those frame markers, then reads the height
    and width fields from that segment.
    """
    if len(data) < 4 or not data.startswith(JPEG_SIGNATURE):
        return None

    position = len(JPEG_SIGNATURE)
    while position + 4 <= len(data):
        if data[position] != JPEG_MARKER_PREFIX:
            position += 1
            continue

        while position < len(data) and data[position] == JPEG_MARKER_PREFIX:
            position += 1
        if position >= len(data):
            break

        marker = data[position]
        position += 1
        if marker in JPEG_STANDALONE_MARKERS or marker in JPEG_RESTART_MARKERS:
            continue
        if position + 2 > len(data):
            break

        segment_length = int.from_bytes(data[position : position + 2], "big")
        segment_end = position + segment_length
        if segment_length < 2 or segment_end > len(data):
            break

        if (
            marker in JPEG_START_OF_FRAME_MARKERS
            and segment_length >= JPEG_FRAME_MINIMUM_SEGMENT_LENGTH
        ):
            height_start = position + JPEG_FRAME_HEIGHT_OFFSET
            width_start = position + JPEG_FRAME_WIDTH_OFFSET
            height = int.from_bytes(
                data[height_start : height_start + JPEG_DIMENSION_SIZE], "big"
            )
            width = int.from_bytes(
                data[width_start : width_start + JPEG_DIMENSION_SIZE], "big"
            )
            return (width, height) if width and height else None

        position = segment_end

    return None


def image_metadata(data: bytes) -> tuple[str, str, int, int] | None:
    """Identify a cached image from its bytes and return EPUB metadata."""
    dimensions = jpeg_dimensions(data)
    if dimensions is not None:
        return JPEG_MEDIA_TYPE, "jpg", *dimensions

    dimensions = png_dimensions(data)
    if dimensions is not None:
        return PNG_MEDIA_TYPE, "png", *dimensions

    dimensions = gif_dimensions(data)
    if dimensions is not None:
        return GIF_MEDIA_TYPE, "gif", *dimensions

    return None


def cover_cache_shard(cache_root: Path, image_id: str) -> Path:
    """Return the two-level Kobo cache directory for an image ID."""
    image_hash = qt_hash(image_id.encode("utf-8"))
    first_level = image_hash & HASH_BYTE_MASK
    second_level = (image_hash >> 8) & HASH_BYTE_MASK
    return cache_root / str(first_level) / str(second_level)


def cached_cover_path(kobo_root: Path, image_id: str) -> Path | None:
    """Find the best cached cover Kobo has for a book."""
    cache_root = kobo_root / KOBO_IMAGE_CACHE_DIRECTORY
    if not cache_root.is_dir():
        return None

    # Kobo stores several resolutions of the same cover. Prefer the full-size
    # reader/library variants before falling back to the largest cached image.
    shard = cover_cache_shard(cache_root, image_id)
    for variant in KOBO_COVER_VARIANTS:
        candidate = shard / f"{image_id} - {variant}{KOBO_PARSED_IMAGE_SUFFIX}"
        if candidate.is_file():
            return candidate

    matches = [
        candidate
        for candidate in cache_root.rglob(f"*{KOBO_PARSED_IMAGE_SUFFIX}")
        if candidate.name.startswith(f"{image_id} - ")
    ]
    return max(matches, key=lambda path: path.stat().st_size) if matches else None


def load_cover(kobo_root: Path, image_id: str | None) -> CoverImage | None:
    """Load a supported cached Kobo cover without modifying the device."""
    if not image_id:
        return None

    path = cached_cover_path(kobo_root, image_id)
    if path is None:
        return None

    data = path.read_bytes()
    metadata = image_metadata(data)
    if metadata is None:
        return None

    media_type, extension, width, height = metadata
    return CoverImage(
        data=data,
        media_type=media_type,
        extension=extension,
        width=width,
        height=height,
    )
