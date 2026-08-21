"""Identify cached cover image formats without decoding the image."""

from __future__ import annotations

from struct import unpack

JPEG_MEDIA_TYPE = "image/jpeg"
PNG_MEDIA_TYPE = "image/png"
GIF_MEDIA_TYPE = "image/gif"

JPEG_SIGNATURE = b"\xff\xd8"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
GIF_SIGNATURES = (b"GIF87a", b"GIF89a")

JPEG_MARKER_PREFIX = 0xFF
JPEG_STANDALONE_MARKERS = {0x01, 0xD8, 0xD9}
JPEG_RESTART_MARKERS = range(0xD0, 0xD8)
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


def png_dimensions(data: bytes) -> tuple[int, int] | None:
    """Read width and height from a PNG IHDR header."""
    if len(data) < 24 or not data.startswith(PNG_SIGNATURE):
        return None

    width, height = unpack(">II", data[16:24])
    return (width, height) if width and height else None


def gif_dimensions(data: bytes) -> tuple[int, int] | None:
    """Read width and height from a GIF logical screen descriptor."""
    if len(data) < 10 or not data.startswith(GIF_SIGNATURES):
        return None

    width, height = unpack("<HH", data[6:10])
    return (width, height) if width and height else None


def jpeg_dimensions(data: bytes) -> tuple[int, int] | None:
    """Read dimensions from the first JPEG Start Of Frame segment."""
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
            return None

        marker = data[position]
        position += 1
        if marker in JPEG_STANDALONE_MARKERS or marker in JPEG_RESTART_MARKERS:
            continue
        if position + 2 > len(data):
            return None

        segment_length = int.from_bytes(data[position : position + 2], "big")
        segment_end = position + segment_length
        if segment_length < 2 or segment_end > len(data):
            return None

        # Start Of Frame payloads begin with precision, height, then width.
        if marker in JPEG_START_OF_FRAME_MARKERS and segment_length >= 7:
            height = int.from_bytes(data[position + 3 : position + 5], "big")
            width = int.from_bytes(data[position + 5 : position + 7], "big")
            return (width, height) if width and height else None

        position = segment_end

    return None


def image_metadata(data: bytes) -> tuple[str, str, int, int] | None:
    """Return media type, extension, width, and height for a supported image."""
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
