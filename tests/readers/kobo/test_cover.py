from __future__ import annotations

from pathlib import Path

from afterbook.readers.kobo.cover import (
    COVER_VARIANT_PRIORITY,
    cached_cover_path,
    cover_cache_directory,
    cover_cache_filename,
    load_cover,
)


def png_bytes(width: int, height: int) -> bytes:
    return (
        b"\x89PNG\r\n\x1a\n"
        + b"\x00\x00\x00\x0dIHDR"
        + width.to_bytes(4, "big")
        + height.to_bytes(4, "big")
    )


def test_loads_cached_kobo_cover(tmp_path: Path) -> None:
    image_id = "cover-id"
    cache_directory = cover_cache_directory(tmp_path, image_id)
    cache_directory.mkdir(parents=True)
    cover_path = cache_directory / cover_cache_filename(image_id, COVER_VARIANT_PRIORITY[0])
    cover_path.write_bytes(png_bytes(1264, 1680))

    cover = load_cover(tmp_path, image_id)

    assert cover is not None
    assert cover.media_type == "image/png"
    assert cover.extension == "png"
    assert (cover.width, cover.height) == (1264, 1680)


def test_prefers_full_size_cached_cover(tmp_path: Path) -> None:
    image_id = "cover-id"
    cache_directory = cover_cache_directory(tmp_path, image_id)
    cache_directory.mkdir(parents=True)
    grid = cache_directory / cover_cache_filename(image_id, "N3_LIBRARY_GRID")
    full = cache_directory / cover_cache_filename(image_id, "N3_FULL")
    grid.write_bytes(png_bytes(400, 600))
    full.write_bytes(png_bytes(1200, 1800))

    assert cached_cover_path(tmp_path, image_id) == full


def test_uses_largest_unknown_variant_as_fallback(tmp_path: Path) -> None:
    image_id = "cover-id"
    cache_directory = cover_cache_directory(tmp_path, image_id)
    cache_directory.mkdir(parents=True)
    small = cache_directory / cover_cache_filename(image_id, "UNKNOWN_SMALL")
    large = cache_directory / cover_cache_filename(image_id, "UNKNOWN_LARGE")
    small.write_bytes(png_bytes(400, 600))
    large.write_bytes(png_bytes(1200, 1800) + b"larger cached variant")

    assert cached_cover_path(tmp_path, image_id) == large


def test_fallback_cover_lookup_treats_image_id_as_literal_text(tmp_path: Path) -> None:
    image_id = "cover[id]"
    cache_directory = cover_cache_directory(tmp_path, image_id)
    cache_directory.mkdir(parents=True)
    cover_path = cache_directory / cover_cache_filename(image_id, "UNKNOWN")
    cover_path.write_bytes(png_bytes(1200, 1800))

    assert cached_cover_path(tmp_path, image_id) == cover_path
