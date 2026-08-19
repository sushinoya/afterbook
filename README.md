# KoboKeeps

[![CI](https://github.com/sushinoya/kobo-keeps/actions/workflows/ci.yml/badge.svg)](https://github.com/sushinoya/kobo-keeps/actions/workflows/ci.yml)

Keep the parts of a Kobo book that mattered to you.

KoboKeeps turns your Kobo highlights and notes into a small personal book that you can keep in your library. It is particularly useful for OverDrive and Libby loans: export your annotations before the loan disappears, then keep the generated EPUB for as long as you want.

KoboKeeps does not copy or decrypt the source ebook. It reads annotation data, book metadata, and the cached cover already stored by Kobo.

<details>
<summary>Disclaimer</summary>

KoboKeeps was built with assistance from both Sonnet and GPT-5.5, without which this would have taken much longer to complete. Any generated code has still been thoroughly reviewed and tested.

PRs are welcome, AI-assisted or not. Please review and test your changes before sending them, and open an Issue if you find something broken or unclear.

</details>

## Features

- Creates a standalone EPUB from highlights and notes
- Preserves the source book's chapter order
- Renders highlights using the corresponding Kobo color slot
- Reuses the original cached cover when available
- Keeps notes directly with the passage they belong to
- Embeds a machine-readable archive of Kobo annotation metadata
- Offers an interactive arrow-key book picker
- Supports macOS, Linux, and Windows
- Never writes to the connected Kobo

## Install

KoboKeeps requires Python 3.10 or newer. [pipx](https://pipx.pypa.io/) is recommended for command line applications.

Install directly from GitHub:

```console
pipx install git+https://github.com/sushinoya/kobo-keeps.git
```

Or clone the repository and install locally:

```console
git clone https://github.com/sushinoya/kobo-keeps.git
cd kobo-keeps
pipx install .
```

## Usage

Connect your Kobo over USB and tap **Connect** on the eReader.

The simplest workflow is:

```console
kobokeeps export
```

KoboKeeps shows the annotated books on the device. Use the arrow keys to choose one and press Enter.

You can also inspect the numbered list first:

```console
kobokeeps list
```

```text
  1. Why Fish Don't Exist - Lulu Miller [246 highlights, 17 notes]
     da59e6e5-b10a-409a-b476-94fa8c654816
  2. Why We Sleep - Matthew Walker [2 highlights, 0 notes]
     file:///mnt/onboard/Walker, Matthew/Why We Sleep - Matthew Walker.kepub.epub
```

Then export by number:

```console
kobokeeps export 2
```

For scripts, exact title and Kobo content ID selectors are also available:

```console
kobokeeps export --book "Why We Sleep"
kobokeeps export --book-id "file:///mnt/onboard/Walker, Matthew/Why We Sleep - Matthew Walker.kepub.epub"
```

Books are written to `~/Documents/KoboKeeps` by default. Choose another local directory with `--output`:

```console
kobokeeps export --output ~/Books/KoboKeeps
```

If automatic device discovery does not find your Kobo, provide its mount point explicitly:

```console
kobokeeps --device /Volumes/KOBOeReader export
```

## What the generated book contains

A generated book is named `<Book Title> - My Clippings.epub` and contains:

- the cached source cover, when available
- a minimal title page
- chapter headings in source order
- the exact passages you highlighted
- the original highlight color slot
- your notes, directly below their passage
- a navigation table of contents

Visible clipping pages intentionally omit annotation timestamps and percentage-through-chapter information.

## Library loans

KoboKeeps works from annotation records that are still present on the device, including records for OverDrive and Libby loans. Export before returning the book or before Kobo removes the expired loan.

The resulting EPUB contains the passages you selected and the notes you wrote. It does not contain the rest of the borrowed ebook.

## Read-only device access

KoboKeeps treats the Kobo as a source only.

`KoboReader.sqlite` is never opened with SQLite while it is on the device. KoboKeeps copies the database and any existing WAL or SHM sidecars into temporary storage on your computer, then runs all database queries against that local snapshot.

The output path is also checked so an export cannot be written inside the mounted Kobo filesystem.

## Annotation archive

Each generated EPUB contains a hidden machine-readable file at:

```text
OEBPS/archive/kobo-annotations.json
```

It is not part of the reading spine or table of contents. The archive preserves useful source information for future migration or reprocessing, including:

- selected text and notes
- the original Kobo color integer
- annotation identifiers
- creation and modification timestamps
- chapter and book position
- exact start and end container paths and offsets
- `ContextString` when Kobo provides it
- reading statistics and rating when available
- source book metadata

The archive is built from an explicit data model. Kobo account credentials, authentication state, sync tokens, DRM data, and other unrelated device state are not copied.

## Highlight colors

Kobo stores highlight colors in `KoboReader.sqlite` as integer slots rather than RGB or hex values. KoboKeeps preserves the original integer in the archive and maps the four color slots to a reference yellow, pink, blue, and green palette for the generated EPUB.

The reference palette is intended to resemble Kobo's native reader colors. It is not claimed to be an RGB value extracted from the Kobo database.

## Platform support

| Platform | Automatic discovery |
| --- | --- |
| macOS | Mounted volumes under `/Volumes` |
| Linux | Common mounts under `/media`, `/run/media`, and `/mnt` |
| Windows | Mounted drive letters |

Use `--device` on any platform when your Kobo is mounted somewhere else.

## Development

Create an environment and install the development dependencies:

```console
python -m pip install -e ".[dev]"
```

Run the quality checks:

```console
python -m pytest
ruff check .
ruff format --check .
mypy kobokeeps
python -m build
```

The test suite uses synthetic Kobo databases and never requires a connected eReader.

## License

[MIT](LICENSE)
