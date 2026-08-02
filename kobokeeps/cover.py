from __future__ import annotations

import mimetypes
from pathlib import Path

from kobokeeps.models import CoverImage

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


def qt_hash(data: bytes) -> int:
    value = 0
    for byte in data:
        value = (value << 4) + byte
        value ^= (value & 0xF0000000) >> 23
        value &= 0x0FFFFFFF
    return value


def png_dimensions(data: bytes) -> tuple[int, int] | None:
    if len(data) < 24 or not data.startswith(b"\x89PNG\r\n\x1a\n"):
        return None
    width = int.from_bytes(data[16:20], "big")
    height = int.from_bytes(data[20:24], "big")
    return (width, height) if width and height else None


def gif_dimensions(data: bytes) -> tuple[int, int] | None:
    if len(data) < 10 or not data.startswith((b"GIF87a", b"GIF89a")):
        return None
    width = int.from_bytes(data[6:8], "little")
    height = int.from_bytes(data[8:10], "little")
    return (width, height) if width and height else None


def jpeg_dimensions(data: bytes) -> tuple[int, int] | None:
    if len(data) < 4 or not data.startswith(b"\xff\xd8"):
        return None

    position = 2
    while position + 4 <= len(data):
        if data[position] != 0xFF:
            position += 1
            continue

        while position < len(data) and data[position] == 0xFF:
            position += 1
        if position >= len(data):
            break

        marker = data[position]
        position += 1
        if marker in {0x01, 0xD8, 0xD9} or 0xD0 <= marker <= 0xD7:
            continue
        if position + 2 > len(data):
            break

        segment_length = int.from_bytes(data[position : position + 2], "big")
        if segment_length < 2 or position + segment_length > len(data):
            break
        if marker in JPEG_START_OF_FRAME_MARKERS and segment_length >= 7:
            height = int.from_bytes(data[position + 3 : position + 5], "big")
            width = int.from_bytes(data[position + 5 : position + 7], "big")
            return (width, height) if width and height else None
        position += segment_length

    return None


def image_metadata(data: bytes, filename: str) -> tuple[str, str, int, int]:
    dimensions = jpeg_dimensions(data)
    if dimensions is not None:
        return "image/jpeg", "jpg", *dimensions

    dimensions = png_dimensions(data)
    if dimensions is not None:
        return "image/png", "png", *dimensions

    dimensions = gif_dimensions(data)
    if dimensions is not None:
        return "image/gif", "gif", *dimensions

    media_type = mimetypes.guess_type(filename)[0] or "image/jpeg"
    extension = "png" if media_type == "image/png" else "jpg"
    return media_type, extension, 1000, 1600


def cached_cover_path(kobo_root: Path, image_id: str) -> Path | None:
    cache_root = kobo_root / ".kobo-images"
    if not cache_root.is_dir():
        return None

    image_hash = qt_hash(image_id.encode("utf-8"))
    shard = cache_root / str(image_hash & 0xFF) / str((image_hash & 0xFF00) >> 8)
    preferred_names = (
        f"{image_id} - N3_FULL.parsed",
        f"{image_id} - N3_LIBRARY_FULL.parsed",
        f"{image_id} - N3_LIBRARY_GRID.parsed",
        f"{image_id} - N3_LIBRARY_LIST.parsed",
    )
    for name in preferred_names:
        candidate = shard / name
        if candidate.is_file():
            return candidate

    matches = [
        candidate
        for candidate in cache_root.rglob("*.parsed")
        if candidate.name.startswith(f"{image_id} - ")
    ]
    return max(matches, key=lambda path: path.stat().st_size) if matches else None


def load_cover(kobo_root: Path, image_id: str | None) -> CoverImage | None:
    if not image_id:
        return None

    path = cached_cover_path(kobo_root, image_id)
    if path is None:
        return None

    with path.open("rb") as cover_file:
        data = cover_file.read()
    media_type, extension, width, height = image_metadata(data, path.name)
    return CoverImage(
        data=data,
        media_type=media_type,
        extension=extension,
        width=width,
        height=height,
    )
