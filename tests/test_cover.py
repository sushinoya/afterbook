from __future__ import annotations

from pathlib import Path

from kobokeeps.cover import (
    KOBO_COVER_VARIANTS,
    cached_cover_path,
    cover_cache_shard,
    image_metadata,
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
    cache = cover_cache_shard(tmp_path / ".kobo-images", image_id)
    cache.mkdir(parents=True)
    cover_path = cache / f"{image_id} - {KOBO_COVER_VARIANTS[0]}.parsed"
    cover_path.write_bytes(png_bytes(1264, 1680))

    cover = load_cover(tmp_path, image_id)

    assert cover is not None
    assert cover.media_type == "image/png"
    assert cover.extension == "png"
    assert (cover.width, cover.height) == (1264, 1680)


def test_prefers_full_size_cached_cover(tmp_path: Path) -> None:
    image_id = "cover-id"
    cache = cover_cache_shard(tmp_path / ".kobo-images", image_id)
    cache.mkdir(parents=True)
    grid = cache / f"{image_id} - N3_LIBRARY_GRID.parsed"
    full = cache / f"{image_id} - N3_FULL.parsed"
    grid.write_bytes(png_bytes(400, 600))
    full.write_bytes(png_bytes(1200, 1800))

    assert cached_cover_path(tmp_path, image_id) == full


def test_unknown_cached_image_format_is_not_guessed() -> None:
    assert image_metadata(b"not an image") is None
