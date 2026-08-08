from __future__ import annotations

from contextlib import closing
import json
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
    assert archive["book"]["reading_statistics"]["rating"] == 5
    assert archive["annotations"][2]["context_string"] == "Surrounding context for chapter two."
    assert archive["annotations"][2]["location"]["start_offset"] == 4
