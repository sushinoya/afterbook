from __future__ import annotations

import json
from contextlib import closing
from pathlib import Path

from kobokeeps.archive import archive_json
from kobokeeps.database import KoboRepository, open_database


def test_archive_preserves_context_and_locations(kobo_database: Path) -> None:
    with closing(open_database(kobo_database)) as connection:
        repository = KoboRepository(connection)
        book = repository.list_books()[0]
        annotations = repository.annotations_for(book)

    archive = json.loads(archive_json(book, annotations))

    assert archive["schema_version"] == 1
    assert archive["book"]["isbn"] == "9781501160370"
    assert archive["book"]["description"] == "Description"
    assert archive["book"]["mime_type"] == "application/x-kobo-epub+zip"
    assert archive["book"]["external_id"] == "external-1"
    statistics = archive["book"]["reading_statistics"]
    assert statistics["rest_of_book_estimate"] == 3600
    assert statistics["store_time_to_read_lower_estimate"] == 18000
    assert statistics["store_time_to_read_upper_estimate"] == 22000
    assert statistics["rating"] == 5
    assert archive["annotations"][2]["context_string"] == "Surrounding context for chapter two."
    assert archive["annotations"][2]["version"] == "1"
    assert archive["annotations"][2]["annotation_type"] == "Highlight"
    assert archive["annotations"][2]["location"]["start_offset"] == 4
