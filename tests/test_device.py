from __future__ import annotations

from pathlib import Path

from kobokeeps.device import database_snapshot, discover_kobos


def test_database_snapshot_copies_database_and_sidecar(kobo_database: Path) -> None:
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
