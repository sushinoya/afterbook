# AfterBook

[![CI](https://github.com/sushinoya/afterbook/actions/workflows/ci.yml/badge.svg)](https://github.com/sushinoya/afterbook/actions/workflows/ci.yml)

Keep the parts of an eBook that mattered to you!

AfterBook turns highlights and notes from supported ebook readers into a small personal ePub book that you can keep on your device itself.

For Kobo, it is particularly useful for OverDrive and Libby loans: export your annotations before the loan disappears, then keep the generated ePub on your Kobo.

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

## Screenshots

<p align="center">
  <sub>An AfterBook-generated EPUB on a Kobo Clara Colour, exported highlights, and table of contents</sub>
</p>

<p align="center">
  <img src="https://github.com/user-attachments/assets/c1d1f672-040d-4d62-8f17-4d6e271b3798" alt="AfterBook EPUB open on a Kobo eReader" title="AfterBook EPUB on Kobo" width="260">
  <img src="https://github.com/user-attachments/assets/ad9c80fa-c8cf-47a2-8593-73ca6742f737" alt="AfterBook EPUB page showing exported highlights" title="Exported highlights" width="260">
  <img src="https://github.com/user-attachments/assets/5dd8f6d8-2361-4c2a-8f0b-1b25f7647ea2" alt="AfterBook EPUB table of contents" title="Table of contents" width="260">
</p>

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

## Browser app

AfterBook also has a static browser app in [`web`](web). It uses the File System
Access API, so it requires a Chromium-based desktop browser such as Chrome or
Edge. You explicitly choose the mounted `KOBOeReader` drive, and AfterBook asks
for read-only access.

The browser app has no backend and no accounts. Kobo data stays in the browser:
JavaScript copies the Kobo database snapshot and selected cached cover into a
Pyodide worker, then the existing Python implementation lists books and returns
the generated EPUB bytes.

Run it locally:

```console
cd web
npm install
npm run build
npm run dev
```

Then open <http://127.0.0.1:5173> in Chrome or Edge.

Deploy it to Netlify with `web` as the base directory:

```text
Build command: npm run build
Publish directory: .
```

The included Netlify config serves the static app and sets the cross-origin
isolation headers required by Pyodide. Production deployments should use HTTPS.

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

Run the browser app checks:

```console
cd web
npm install
npm run build
npm run test:unit
npm run test:browser
```

If your default `python3` is older than 3.10, set `AFTERBOOK_PYTHON` to a Python
3.10+ executable before running the browser tests.

The test suite uses synthetic Kobo databases and never requires a connected eReader.

## License

[MIT](LICENSE)
