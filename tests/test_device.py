from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

import pytest

from kobokeeps.database import open_database
from kobokeeps.device import (
    database_snapshot,
    discover_kobos,
    local_output_directory,
)
from kobokeeps.errors import KoboKeepsError


def test_database_snapshot_copies_database_and_sidecar(
    kobo_database: Path,
) -> None:
    source_contents = kobo_database.read_bytes()
    source_wal = Path(f"{kobo_database}-wal")
    source_wal.write_bytes(b"wal-data")

    with database_snapshot(kobo_database) as snapshot:
        assert snapshot != kobo_database
        assert snapshot.read_bytes() == source_contents
        assert Path(f"{snapshot}-wal").read_bytes() == b"wal-data"

    assert kobo_database.read_bytes() == source_contents
    assert source_wal.read_bytes() == b"wal-data"


def test_discovers_kobo_in_volumes_directory(tmp_path: Path) -> None:
    kobo = tmp_path / "KOBOeReader"
    (kobo / ".kobo").mkdir(parents=True)
    (kobo / ".kobo" / "KoboReader.sqlite").touch()

    devices = discover_kobos(tmp_path)

    assert [device.root for device in devices] == [kobo]


def test_linux_mounts_find_user_media_directories(tmp_path: Path) -> None:
    from kobokeeps.device import linux_mounts

    home = tmp_path / "home" / "reader"
    media_root = tmp_path / "media"
    run_media_root = tmp_path / "run" / "media"
    first = media_root / "reader" / "KOBOeReader"
    second = run_media_root / "reader" / "USB"
    first.mkdir(parents=True)
    second.mkdir(parents=True)

    mounts = linux_mounts(home, media_root, run_media_root, tmp_path / "mnt")

    assert mounts == [first, second]


def test_linux_mounts_include_mnt(tmp_path: Path) -> None:
    from kobokeeps.device import linux_mounts

    home = tmp_path / "home" / "reader"
    media_root = tmp_path / "media"
    run_media_root = tmp_path / "run" / "media"
    mnt_root = tmp_path / "mnt"
    mounted = mnt_root / "KOBOeReader"
    mounted.mkdir(parents=True)

    mounts = linux_mounts(home, media_root, run_media_root, mnt_root)

    assert mounted in mounts


def test_windows_mounts_filter_existing_drive_roots(tmp_path: Path) -> None:
    from kobokeeps.device import windows_mounts

    mounted = tmp_path / "E"
    missing = tmp_path / "F"
    mounted.mkdir()

    assert windows_mounts([mounted, missing]) == [mounted]


def test_rejects_output_on_kobo(tmp_path: Path) -> None:
    device = tmp_path / "KOBOeReader"
    device.mkdir()

    with pytest.raises(KoboKeepsError, match="cannot be on the Kobo"):
        local_output_directory(device / "Books", device)


def test_allows_output_outside_kobo(tmp_path: Path) -> None:
    device = tmp_path / "KOBOeReader"
    output = tmp_path / "KoboKeeps"
    device.mkdir()

    assert local_output_directory(output, device) == output.resolve()


def test_database_snapshot_includes_uncheckpointed_wal(tmp_path: Path) -> None:
    database = tmp_path / "KoboReader.sqlite"
    source = sqlite3.connect(database)
    source.execute("PRAGMA journal_mode = WAL")
    source.execute("PRAGMA wal_autocheckpoint = 0")
    source.execute("CREATE TABLE annotations (text TEXT)")
    source.commit()
    source.execute("INSERT INTO annotations VALUES ('kept in wal')")
    source.commit()

    try:
        assert Path(f"{database}-wal").is_file()
        with (
            database_snapshot(database) as snapshot,
            closing(open_database(snapshot)) as copied,
        ):
            row = copied.execute("SELECT text FROM annotations").fetchone()
        assert row is not None
        assert row[0] == "kept in wal"
    finally:
        source.close()
