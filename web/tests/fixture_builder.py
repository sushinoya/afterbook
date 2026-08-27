from __future__ import annotations

import base64
import json
import sqlite3
import tempfile
from pathlib import Path
from sys import path

ROOT = Path(__file__).resolve().parents[2]
path.insert(0, str(ROOT))

from afterbook.api import generate_kobo_epub, list_kobo_books  # noqa: E402
from afterbook.readers.kobo.cover import (  # noqa: E402
    COVER_VARIANT_PRIORITY,
    cover_cache_directory,
    cover_cache_filename,
)

BOOK_ID = "browser-fixture-book"
IMAGE_ID = "browser-cover"


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="afterbook-web-fixture-") as temporary_directory:
        root = Path(temporary_directory) / "KOBOeReader"
        database_path = root / ".kobo" / "KoboReader.sqlite"
        database_path.parent.mkdir(parents=True)
        connection = sqlite3.connect(database_path)
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute("PRAGMA wal_autocheckpoint = 0")
        create_schema(connection)
        insert_fixture_rows(connection)
        connection.commit()

        cover_path = cover_cache_directory(root, IMAGE_ID) / cover_cache_filename(
            IMAGE_ID,
            COVER_VARIANT_PRIORITY[0],
        )
        cover_path.parent.mkdir(parents=True)
        cover_path.write_bytes(png_bytes(600, 900))

        generated = generate_kobo_epub(root, BOOK_ID)
        files = {
            ".kobo/KoboReader.sqlite": encoded_file(database_path),
            cover_path.relative_to(root).as_posix(): encoded_file(cover_path),
        }
        for suffix in ("-wal", "-shm"):
            sidecar = Path(f"{database_path}{suffix}")
            if sidecar.is_file():
                files[f".kobo/{sidecar.name}"] = encoded_file(sidecar)

        print(
            json.dumps(
                {
                    "files": files,
                    "books": list_kobo_books(root),
                    "export": {
                        "filename": generated.filename,
                        "bytes": base64.b64encode(generated.data).decode("ascii"),
                    },
                },
                sort_keys=True,
            )
        )
        connection.close()
    return 0


def create_schema(connection: sqlite3.Connection) -> None:
    connection.executescript("""
        CREATE TABLE content (
            ContentID TEXT PRIMARY KEY,
            BookID TEXT,
            Title TEXT,
            Attribution TEXT,
            Language TEXT,
            ImageId TEXT,
            SpineIndex REAL
        );
        CREATE TABLE Bookmark (
            BookmarkID TEXT,
            VolumeID TEXT,
            ContentID TEXT,
            Text TEXT,
            Annotation TEXT,
            Color INTEGER,
            ChapterProgress REAL,
            StartContainerChildIndex INTEGER,
            StartOffset INTEGER,
            Hidden TEXT
        );
        """)


def insert_fixture_rows(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        INSERT INTO content (ContentID, Title, Attribution, Language, ImageId)
        VALUES (?, ?, ?, ?, ?)
        """,
        (BOOK_ID, "Browser Fixture", "Test Author", "en", IMAGE_ID),
    )
    connection.executemany(
        "INSERT INTO content (ContentID, BookID, Title, SpineIndex) VALUES (?, ?, ?, ?)",
        [
            (f"{BOOK_ID}/chapter-1.xhtml", BOOK_ID, "Opening", 1),
            (f"{BOOK_ID}/chapter-2.xhtml", BOOK_ID, "Ending", 2),
        ],
    )
    connection.executemany(
        """
        INSERT INTO Bookmark (
            BookmarkID, VolumeID, ContentID, Text, Annotation, Color, ChapterProgress,
            StartContainerChildIndex, StartOffset, Hidden
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                "fixture-highlight",
                BOOK_ID,
                f"{BOOK_ID}/chapter-1.xhtml#kobo.1",
                "A browser-tested highlight.",
                "",
                0,
                0.1,
                0,
                2,
                "false",
            ),
            (
                "fixture-note",
                BOOK_ID,
                f"{BOOK_ID}/chapter-2.xhtml#kobo.2",
                "",
                "A browser-tested note.",
                None,
                0.2,
                0,
                4,
                "false",
            ),
        ],
    )


def encoded_file(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")


def png_bytes(width: int, height: int) -> bytes:
    return (
        b"\x89PNG\r\n\x1a\n"
        + b"\x00\x00\x00\x0dIHDR"
        + width.to_bytes(4, "big")
        + height.to_bytes(4, "big")
    )


if __name__ == "__main__":
    raise SystemExit(main())
