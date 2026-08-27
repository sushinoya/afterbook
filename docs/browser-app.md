# Browser App Architecture

AfterBook's browser app is a static React application built with Vite. The
frontend is organized around reader-agnostic domain interfaces so Kobo is the
first reader adapter, not the permanent shape of the app.

There is no backend, account system, or upload path. Reader data stays inside
the browser process.

## Runtime Boundaries

```text
React app
  -> reader registry selects a BrowserReaderAdapter
  -> adapter requests read-only File System Access API handles
  -> adapter copies capability-specific files into worker messages
  -> Pyodide worker stages files under /reader-source
  -> afterbook.api lists books or generates EPUB bytes
  -> React app renders the library, EPUB preview, and EPUB download
```

The real reader filesystem is never mounted into Python. The worker only sees
the files copied into Pyodide's in-memory filesystem for the active capability.

For Kobo annotation export, the browser reads only:

- `.kobo/KoboReader.sqlite`
- `.kobo/KoboReader.sqlite-wal`, when present
- `.kobo/KoboReader.sqlite-shm`, when present
- the cached cover file selected from the Python-provided Kobo cover locator

All current browser file access is read-only. Future management capabilities
that require writes should be modeled as separate capabilities with explicit
permission escalation, backups, validation, and rollback behavior.

## Frontend Boundaries

- `web/src/domain` defines reader-agnostic contracts such as
  `ReaderDefinition`, `BrowserReaderAdapter`, `ReaderConnection`, and
  `AnnotationExportCapability`.
- `web/src/features/annotation-export` owns the current workflow state machine.
- `web/src/app` owns the welcome, connection wizard, library, and book preview
  modal presentation.
- `web/src/infrastructure/file-system` owns browser File System Access wrappers
  and path safety.
- `web/src/infrastructure/readers/kobo` owns Kobo-specific file paths, cover
  cache lookup, and mapping from Python records into generic reader books.
- `web/src/infrastructure/readers/reader-registry.ts` is the extension point for
  additional ebook readers.
- `web/src/infrastructure/worker` owns the typed worker protocol and the Pyodide
  runtime.
- `web/tooling/afterbook-python-package-plugin.ts` packages the local Python source
  into `dist/python/afterbook.zip` through Vite for both development and
  production builds.

Keep reader-specific logic out of React components. Components should render
reader-agnostic view models and call feature actions.

## Adding A Reader

Add a new adapter that implements `BrowserReaderAdapter`, then register it in
`reader-registry.ts`. A reader adapter should expose capabilities rather than
device-specific UI. For example, a future reader can implement annotation export
without affecting the current Kobo adapter or library presentation.

If a reader needs write access, model that as a separate capability from
annotation export. Read-only export should remain safe by default.

## Build And Deploy

```console
cd web
npm install
npm run dev
npm run build
```

Vite emits production assets to `web/dist`. The included `web/netlify.toml`
publishes that directory and sets the cross-origin isolation headers required by
Pyodide.

## Verification

Run the Python checks from the repository root:

```console
python -m pytest
ruff check .
ruff format --check .
mypy afterbook
```

Run the browser checks from `web` with Node 20.19 or newer:

```console
npm run typecheck
npm run test:unit
npm run test:browser
npm run build
```

The browser test uses a synthetic Kobo directory and exercises the real React
app, real worker, real Pyodide load, packaged Python source, and generated EPUB
download.
