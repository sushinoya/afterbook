# Changelog

## 1.0.1 - 2026-08-21

- Fix Ruff import formatting and install test dependencies in the CI matrix
- Separate Kobo cover discovery from generic image parsing
- Simplify EPUB generation and build XML documents structurally
- Pin the Ruff version used by local development and CI

## 1.0.0 - 2026-08-19

- Add interactive, numbered, title, and content ID book selection
- Add macOS, Linux, and Windows device discovery
- Keep SQLite access on a temporary local database snapshot
- Export source-order highlights and notes as standalone EPUBs
- Preserve highlight colors, covers, source metadata, reading statistics, and exact annotation locations
- Embed a machine-readable annotation archive
- Add EPUB 3 navigation and NCX compatibility metadata
- Add package installation, type checking, linting, tests, and CI

## 0.2.0 - 2026-08-08

- Add annotation ordering and highlight colors
- Add cached cover support
- Add the annotation archive
- Add interactive book selection
- Add package installation and tests

## 0.1.0 - 2026-08-02

- Add Kobo device discovery and local database snapshots
- Add book and annotation extraction
- Add initial EPUB generation
