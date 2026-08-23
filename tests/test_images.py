from __future__ import annotations

from afterbook.images import image_metadata


def png_bytes(width: int, height: int) -> bytes:
    return (
        b"\x89PNG\r\n\x1a\n"
        + b"\x00\x00\x00\x0dIHDR"
        + width.to_bytes(4, "big")
        + height.to_bytes(4, "big")
    )


def test_reads_png_dimensions() -> None:
    assert image_metadata(png_bytes(1264, 1680)) == (
        "image/png",
        "png",
        1264,
        1680,
    )


def test_reads_gif_dimensions() -> None:
    data = b"GIF89a" + (400).to_bytes(2, "little") + (600).to_bytes(2, "little")
    assert image_metadata(data) == ("image/gif", "gif", 400, 600)


def test_reads_jpeg_dimensions() -> None:
    data = (
        b"\xff\xd8"
        + b"\xff\xc0"
        + b"\x00\x07"
        + b"\x08"
        + (1680).to_bytes(2, "big")
        + (1264).to_bytes(2, "big")
    )
    assert image_metadata(data) == ("image/jpeg", "jpg", 1264, 1680)


def test_rejects_unknown_image_format() -> None:
    assert image_metadata(b"not an image") is None


def test_rejects_png_without_ihdr_chunk() -> None:
    data = (
        b"\x89PNG\r\n\x1a\n"
        + b"\x00\x00\x00\x0dJUNK"
        + (1264).to_bytes(4, "big")
        + (1680).to_bytes(4, "big")
    )

    assert image_metadata(data) is None
