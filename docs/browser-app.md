# Browser App Architecture

AfterBook's browser app is a static site that runs the existing Kobo reader and
EPUB export code in Pyodide. The browser layer handles permissions, local file
reads, worker messaging, preview URLs, and downloads. Python remains the source
of truth for Kobo database parsing, cover-cache lookup, annotation normalization,
and EPUB generation.

## User Flow

1. Connect the Kobo eReader over USB.
2. Open the browser app in a Chromium-based desktop browser.
3. Choose the mounted `KOBOeReader` directory.
4. Grant read access when the browser asks.
5. Pick an annotated book and download `<Book Title> - My Clippings.epub`.

There is no backend, account system, or upload path. Kobo data stays inside the
browser process.

## Runtime Boundaries

```text
Browser UI
  -> File System Access API reads selected Kobo files
  -> Worker receives a staged database snapshot
  -> Pyodide runs afterbook.api against /kobo
  -> Worker returns book metadata or EPUB bytes
  -> Browser creates a local EPUB download
```

The real Kobo filesystem is never mounted into Python. The worker only sees the
files that the browser copied into Pyodide's in-memory filesystem under `/kobo`.

The browser reads only:

- `.kobo/KoboReader.sqlite`
- `.kobo/KoboReader.sqlite-wal`, when present
- `.kobo/KoboReader.sqlite-shm`, when present
- the cached cover file selected from the Python-provided Kobo cover locator

All browser file access is read-only. The app never requests writable handles and
never calls File System Access APIs with `{ create: true }`.

## Code Ownership

- `afterbook/api.py` is the narrow Python entry point for embedded callers.
- `afterbook/epub.py` exposes byte generation while preserving atomic CLI writes.
- `afterbook/readers/kobo/cover.py` owns Kobo cover-cache hashing and locator
  construction.
- `web/kobo-files.js` owns File System Access validation and local file reads.
- `web/worker-client.js` owns the request/response protocol with the worker.
- `web/pyodide-worker.js` owns Pyodide initialization and the staged `/kobo`
  filesystem.
- `web/app.js` owns UI state, rendering, cover preview URLs, and EPUB downloads.

Keep these boundaries intact when extending the app. In particular, avoid
duplicating Kobo database or EPUB logic in JavaScript.

## Build And Deploy

The browser build packages the local Python source into
`web/python/afterbook.zip`; that generated directory is ignored by Git.

```console
cd web
npm install
npm run build
npm run dev
```

Serve production builds over HTTPS. The included `web/netlify.toml` sets the
cross-origin isolation headers required by Pyodide.

## Verification

Run the Python checks from the repository root:

```console
python -m pytest
ruff check .
ruff format --check .
mypy afterbook
```

Run the browser checks from `web` with Node 20 or newer:

```console
npm run build
npm run test:unit
npm run test:browser
```

The browser test uses a synthetic Kobo directory and exercises the real browser
app, real worker, real Pyodide load, packaged Python source, and generated EPUB
download.
