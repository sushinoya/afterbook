"""Locate book covers in Kobo's local image cache."""

from __future__ import annotations

from pathlib import Path, PureWindowsPath

from afterbook.images import image_metadata
from afterbook.models import CoverImage

KOBO_IMAGE_CACHE_DIRECTORY = ".kobo-images"
KOBO_PARSED_IMAGE_SUFFIX = ".parsed"
COVER_VARIANT_PRIORITY = (
    "N3_FULL",
    "N3_LIBRARY_FULL",
    "N3_LIBRARY_GRID",
    "N3_LIBRARY_LIST",
)

QT_HASH_HIGH_BITS_MASK = 0xF0000000
QT_HASH_VALUE_MASK = 0x0FFFFFFF
QT_HASH_SHIFT = 23
HASH_DIRECTORY_MASK = 0xFF


def is_cover_cache_image_id(image_id: str) -> bool:
    """Return whether an image ID can be used as one cache filename component."""
    windows_path = PureWindowsPath(image_id)
    return (
        image_id != ""
        and "/" not in image_id
        and "\\" not in image_id
        and windows_path.drive == ""
        and windows_path.root == ""
    )


def qt_hash(data: bytes) -> int:
    """Return the Qt byte-array hash Kobo uses to shard cached images."""
    value = 0
    for byte in data:
        value = (value << 4) + byte
        value ^= (value & QT_HASH_HIGH_BITS_MASK) >> QT_HASH_SHIFT
        value &= QT_HASH_VALUE_MASK
    return value


def cover_cache_directory(kobo_root: Path, image_id: str) -> Path:
    """Return the two-level cache directory used for a Kobo image ID."""
    image_hash = qt_hash(image_id.encode("utf-8"))
    first_directory = image_hash & HASH_DIRECTORY_MASK
    second_directory = (image_hash >> 8) & HASH_DIRECTORY_MASK
    return kobo_root / KOBO_IMAGE_CACHE_DIRECTORY / str(first_directory) / str(second_directory)


def cover_cache_filename(image_id: str, variant: str) -> str:
    """Return Kobo's cached filename for one cover variant."""
    return f"{image_id} - {variant}{KOBO_PARSED_IMAGE_SUFFIX}"


def cached_cover_path(kobo_root: Path, image_id: str) -> Path | None:
    """Find the highest-priority cached cover available for a book."""
    if not is_cover_cache_image_id(image_id):
        return None

    cache_directory = cover_cache_directory(kobo_root, image_id)
    if not cache_directory.is_dir():
        return None

    # Kobo caches several sizes for an image ID. Prefer known full-size variants,
    # then use the largest remaining variant in the same hash directory.
    for variant in COVER_VARIANT_PRIORITY:
        candidate = cache_directory / cover_cache_filename(image_id, variant)
        if candidate.is_file():
            return candidate

    prefix = f"{image_id} - "
    candidates = [
        path
        for path in cache_directory.iterdir()
        if path.is_file()
        and path.name.startswith(prefix)
        and path.name.endswith(KOBO_PARSED_IMAGE_SUFFIX)
    ]
    return max(candidates, key=lambda path: path.stat().st_size) if candidates else None


def load_cover(kobo_root: Path, image_id: str | None) -> CoverImage | None:
    """Read a supported cached cover without modifying the Kobo device."""
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
