# KoboKeeps

Turn Kobo highlights and notes into personal books you can keep.

KoboKeeps reads the annotations stored on a Kobo eReader and builds a standalone EPUB for each book. It is especially useful for library loans and other temporary books: when the source book leaves your Kobo, the passages and notes you chose to keep can remain as a small personal book in your library.

KoboKeeps does not copy or decrypt the source ebook. It only reads annotation data, book metadata, and the cached cover already stored by Kobo.

<details>
<summary>Disclaimer</summary>

KoboKeeps was built with assistance from both Sonnet and GPT-5.5, without which this would have taken much longer to complete. Any generated code has still been thoroughly reviewed and tested.

PRs are welcome, AI-assisted or not. Please review and test your changes before sending them, and open an Issue if you find something broken or unclear.

</details>

## Features

- Export highlights and notes as a standalone EPUB
- Keep the original reading order and chapter grouping
- Preserve Kobo highlight colors
- Reuse the cached book cover when available
- Preserve source metadata and annotation locations in a hidden JSON archive
- Select a book interactively with arrow keys or by number
- Read the Kobo database through a local temporary snapshot
- Never modify the Kobo database

## Installation

KoboKeeps requires Python 3.10 or newer. `pipx` is recommended for installing the command line application.

```console
pipx install .
```

For development:

```console
python -m pip install -e ".[dev]"
```

## Usage

Connect the Kobo by USB and choose **Connect** on the eReader.

List books with highlights or notes:

```console
kobokeeps list
```

Example:

```text
  1. Why Fish Don't Exist - Lulu Miller [246 highlights, 17 notes]
     da59e6e5-b10a-409a-b476-94fa8c654816
  2. Why We Sleep - Matthew Walker [2 highlights, 0 notes]
     file:///mnt/onboard/Walker, Matthew/Why We Sleep - Matthew Walker.kepub.epub
```

Export a book with the interactive picker:

```console
kobokeeps export
```

You can also select a book directly:

```console
kobokeeps export 2
kobokeeps export --book "Why We Sleep"
kobokeeps export --book-id "file:///mnt/onboard/Walker, Matthew/Why We Sleep - Matthew Walker.kepub.epub"
```

Generated books are written to `~/Documents/KoboKeeps` by default.

## Library loans

KoboKeeps is designed to work with annotation records for books currently present on the Kobo, including OverDrive and Libby loans. Export the annotations before the loan is removed from the device.

The generated EPUB contains only the passages you highlighted, your notes, and descriptive metadata. It does not contain the rest of the borrowed ebook.

## Read-only device access

KoboKeeps never opens `KoboReader.sqlite` with SQLite while the database is on the Kobo. It performs a binary read of the database and any existing WAL or SHM sidecars, copies them to temporary storage on the computer, and runs all SQLite queries against that local snapshot.

The Kobo is treated as a source only. KoboKeeps does not write EPUBs, database changes, journals, or any other files to the device.

## Annotation archive

Every generated EPUB contains:

```text
OEBPS/archive/kobo-annotations.json
```

The archive is not included in the table of contents or reading spine. It preserves the source metadata and annotation information needed for future migrations, including:

- selected text and notes
- original Kobo color code
- annotation identifiers
- creation and modification timestamps
- chapter and book position
- exact start and end container paths and offsets
- `ContextString` when Kobo stores it
- reading statistics and rating when available

KoboKeeps uses an allowlisted data model. Account credentials, sync tokens, DRM data, and other private Kobo state are not copied into the archive.

## Highlight colors

`KoboReader.sqlite` stores highlight colors as integer codes rather than RGB or hex values. KoboKeeps preserves that original integer in the archive and uses a reference yellow, pink, blue, and green palette chosen to resemble Kobo's native reader interface.

## Development

Run the tests:

```console
python -m pytest
```

Run the linter and formatter checks:

```console
ruff check .
ruff format --check .
```

Run type checking:

```console
mypy kobokeeps
```

## License

MIT
