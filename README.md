# AfterBook

[![CI](https://github.com/sushinoya/afterbook/actions/workflows/ci.yml/badge.svg)](https://github.com/sushinoya/afterbook/actions/workflows/ci.yml)

Keep the parts of an eBook that mattered to you!

AfterBook turns highlights and notes from supported ebook readers into a small personal ePub book that you can keep on your device itself.

For Kobo, it is particularly useful for OverDrive and Libby loans: export your annotations before the loan disappears, then keep the generated ePub on your Kobo.

AfterBook does not copy or decrypt the source ebook. It reads annotation data, book metadata, and cached covers already stored by the reader.

<details>
<summary>Disclaimer</summary>

AfterBook was built with assistance from both Sonnet and GPT-5.5, without which this would have taken much longer to complete. Any generated code has still been thoroughly reviewed and tested.

PRs are welcome, AI-assisted or not. Please review and test your changes before sending them, and open an Issue if you find something broken or unclear.

</details>

## Features

- Creates a standalone ePub from highlights and notes
- Preserves the source book's chapter order
- Renders reader highlight colors when available
- Reuses the original cached cover when available
- Keeps notes directly with the passage they belong to
- Embeds normalized annotations and source-reader raw data in a machine-readable archive

## Supported ebook readers

Currently supported:

- Kobo eReaders (`--reader kobo`, the default)

## Install

AfterBook requires Python 3.10 or newer. [pipx](https://pipx.pypa.io/) is recommended for command line applications.

Install directly from GitHub:

```console
pipx install git+https://github.com/sushinoya/afterbook.git
```

Or clone the repository and install locally:

```console
git clone https://github.com/sushinoya/afterbook.git
cd afterbook
pipx install .
```

## Usage

Connect your ebook reader. For Kobo, connect over USB and tap "Connect" on the device.

The simplest workflow is:

```console
afterbook export
```

AfterBook shows the annotated books from the selected reader. Use the arrow keys to choose one and press Enter.

You can also inspect the numbered list first:

```console
afterbook list
```

```text
  1. Why Fish Don't Exist - Lulu Miller [246 highlights, 17 notes]
     da59e6e5-b10a-409a-b476-94fa8c654816
  2. Why We Sleep - Matthew Walker [2 highlights, 0 notes]
     file:///mnt/onboard/Walker, Matthew/Why We Sleep - Matthew Walker.kePub.ePub
```

Then export by number:

```console
afterbook export 2
```

For scripts, exact title and reader book ID selectors are also available:

```console
afterbook export --book "Why We Sleep"
afterbook export --book-id "file:///mnt/onboard/Walker, Matthew/Why We Sleep - Matthew Walker.kePub.ePub"
```

Books are written to `~/Documents/AfterBook` by default. Choose another local directory with `--output`:

```console
afterbook export --output ~/Books/AfterBook
```

If automatic discovery does not find your reader source, provide its path explicitly:

```console
afterbook --source /Volumes/KOBOeReader export
```

## What the generated book contains

A generated book is named `<Book Title> - My Clippings.epub` and contains:

- the cached source cover, when available
- a minimal title page
- a navigation table of contents
- chapter headings in source order
- the exact passages you highlighted
- the original highlight color, when available
- your notes, directly below their passage

## Library loans

For Kobo, AfterBook works from annotation records that are still present on the device, including records for OverDrive and Libby loans. Export before returning the book or before Kobo removes the expired loan.

The resulting ePub contains the passages you selected and the notes you wrote. It does not contain the rest of the borrowed ebook.

## Annotation archive

Each generated ePub contains a hidden machine-readable file at:

```text
OEBPS/archive/annotations.json
```

It is not part of the reading spine or table of contents. The archive preserves useful source information for future migration or reprocessing, including:

- normalized selected text and notes
- normalized annotation identifiers, color, timestamps, and book position
- normalized source book metadata
- raw source-reader book data
- raw source-reader annotation data
- raw source-reader context data used during normalization

For Kobo, the raw archive data includes the exported `content` and `Bookmark` rows that AfterBook used. Kobo account credentials, authentication state, sync tokens, DRM data, and other unrelated device state are not copied.

## Kobo platform support

| Platform | Automatic discovery |
| --- | --- |
| macOS | Mounted volumes under `/Volumes` |
| Linux | Common mounts under `/media`, `/run/media`, and `/mnt` |
| Windows | Mounted drive letters |

Use `--source` on any platform when your Kobo is mounted somewhere else.

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
mypy afterbook
python -m build
```

The test suite uses synthetic Kobo databases and never requires a connected eReader.

## License

[MIT](LICENSE)
