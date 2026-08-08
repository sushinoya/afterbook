from __future__ import annotations

from pathlib import Path
import sqlite3

import pytest


@pytest.fixture
def kobo_database(tmp_path: Path) -> Path:
    database = tmp_path / "KoboReader.sqlite"
    connection = sqlite3.connect(database)
    connection.executescript(
        """
        CREATE TABLE content (
            ContentID TEXT PRIMARY KEY,
            BookID TEXT,
            Title TEXT,
            Attribution TEXT,
            Subtitle TEXT,
            ISBN TEXT,
            Language TEXT,
            Publisher TEXT,
            Description TEXT,
            Series TEXT,
            SeriesNumber TEXT,
            ImageId TEXT,
            MimeType TEXT,
            DateCreated TEXT,
            ExternalId TEXT,
            ReadStatus INTEGER,
            ___PercentRead REAL,
            DateLastRead TEXT,
            TimeSpentReading INTEGER,
            RestOfBookEstimate INTEGER,
            TimesStartedReading INTEGER,
            LastTimeStartedReading TEXT,
            LastTimeFinishedReading TEXT,
            StorePages INTEGER,
            StoreWordCount INTEGER,
            StoreTimeToReadLowerEstimate INTEGER,
            StoreTimeToReadUpperEstimate INTEGER,
            Rating INTEGER,
            RatingDateModified TEXT,
            SpineIndex REAL,
            VolumeIndex REAL
        );

        CREATE TABLE Bookmark (
            BookmarkID TEXT,
            UUID TEXT,
            VolumeID TEXT,
            ContentID TEXT,
            Text TEXT,
            Annotation TEXT,
            ContextString TEXT,
            Color INTEGER,
            DateCreated TEXT,
            DateModified TEXT,
            Version TEXT,
            Type TEXT,
            ChapterProgress REAL,
            StartContainerPath TEXT,
            StartContainerChildIndex INTEGER,
            StartOffset INTEGER,
            EndContainerPath TEXT,
            EndContainerChildIndex INTEGER,
            EndOffset INTEGER,
            Hidden TEXT
        );
        """
    )

    book_id = "da59e6e5-b10a-409a-b476-94fa8c654816"
    connection.execute(
        """
        INSERT INTO content (
            ContentID, Title, Attribution, Subtitle, ISBN, Language, Publisher,
            Description, Series, SeriesNumber, ImageId, MimeType, DateCreated,
            ExternalId, ReadStatus, ___PercentRead, DateLastRead, TimeSpentReading,
            RestOfBookEstimate, TimesStartedReading, LastTimeStartedReading,
            LastTimeFinishedReading, StorePages, StoreWordCount,
            StoreTimeToReadLowerEstimate, StoreTimeToReadUpperEstimate, Rating,
            RatingDateModified
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            book_id,
            "Why Fish Don't Exist",
            "Lulu Miller",
            "A Story of Loss, Love, and the Hidden Order of Life",
            "9781501160370",
            "en",
            "Simon & Schuster",
            "Description",
            "Series Name",
            "2",
            "image-1",
            "application/x-kobo-epub+zip",
            "2024-01-20T10:00:00.000",
            "external-1",
            1,
            67.5,
            "2024-01-25T16:27:37.000",
            14400,
            3600,
            5,
            "2024-01-25T15:00:00.000",
            None,
            256,
            72500,
            18000,
            22000,
            5,
            "2024-01-25T16:30:00.000",
        ),
    )
    connection.executemany(
        "INSERT INTO content (ContentID, BookID, Title, SpineIndex) VALUES (?, ?, ?, ?)",
        [
            (f"{book_id}/chapter-1.xhtml", book_id, "The First Chapter", 1.0),
            (f"{book_id}/chapter-2.xhtml", book_id, "The Second Chapter", 2.0),
        ],
    )

    bookmark_rows = [
        (
            "bookmark-blue",
            "uuid-blue",
            book_id,
            f"{book_id}/chapter-2.xhtml#kobo.2.1",
            "A blue passage from chapter two.",
            "This is my note.",
            "Surrounding context for chapter two.",
            2,
            "2024-01-22T16:27:37.000",
            "2024-01-25T16:30:00.000",
            "1",
            "Highlight",
            0.25,
            "span#kobo.2.1",
            0,
            4,
            "span#kobo.2.1",
            0,
            38,
            "false",
        ),
        (
            "bookmark-yellow",
            "uuid-yellow",
            book_id,
            f"{book_id}/chapter-1.xhtml#kobo.1.1",
            "A yellow passage from chapter one.",
            "",
            None,
            0,
            "2024-01-25T16:27:37.000",
            None,
            "1",
            "Highlight",
            0.80,
            "span#kobo.1.1",
            0,
            10,
            "span#kobo.1.1",
            0,
            44,
            "false",
        ),
        (
            "bookmark-pink",
            "uuid-pink",
            book_id,
            f"{book_id}/chapter-1.xhtml#kobo.1.2",
            "A pink passage.",
            "",
            None,
            1,
            "2024-01-23T12:00:00.000",
            None,
            "1",
            "Highlight",
            0.90,
            "span#kobo.1.2",
            0,
            2,
            "span#kobo.1.2",
            0,
            17,
            "false",
        ),
        (
            "bookmark-green",
            "uuid-green",
            book_id,
            f"{book_id}/chapter-2.xhtml#kobo.2.2",
            "A green passage.",
            "",
            None,
            3,
            "2024-01-24T12:00:00.000",
            None,
            "1",
            "Highlight",
            0.75,
            "span#kobo.2.2",
            0,
            0,
            "span#kobo.2.2",
            0,
            16,
            "false",
        ),
        (
            "hidden",
            "uuid-hidden",
            book_id,
            f"{book_id}/chapter-1.xhtml#kobo.1.3",
            "Do not export this.",
            "",
            None,
            0,
            "2024-01-25T17:00:00.000",
            None,
            "1",
            "Highlight",
            0.95,
            None,
            None,
            None,
            None,
            None,
            None,
            "true",
        ),
    ]
    connection.executemany(
        """
        INSERT INTO Bookmark (
            BookmarkID, UUID, VolumeID, ContentID, Text, Annotation, ContextString,
            Color, DateCreated, DateModified, Version, Type, ChapterProgress,
            StartContainerPath, StartContainerChildIndex, StartOffset,
            EndContainerPath, EndContainerChildIndex, EndOffset, Hidden
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        bookmark_rows,
    )

    sideloaded_id = "file:///mnt/onboard/Walker, Matthew/Why We Sleep - Matthew Walker.kepub.epub"
    connection.execute(
        "INSERT INTO content (ContentID, Title, Attribution, Language) VALUES (?, ?, ?, ?)",
        (sideloaded_id, "Why We Sleep", "Matthew Walker", "en"),
    )
    connection.execute(
        """
        INSERT INTO Bookmark (
            BookmarkID, VolumeID, ContentID, Text, Annotation, Color, ChapterProgress, Hidden
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            "sleep-highlight",
            sideloaded_id,
            "chapter.xhtml#kobo.1.1",
            "Sleep passage.",
            "",
            0,
            0.5,
            "false",
        ),
    )

    connection.commit()
    connection.close()
    return database
