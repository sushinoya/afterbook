# KoboKeeps

KoboKeeps creates a permanent personal book from the highlights and notes on a Kobo eReader.

The project is designed for books that may not stay on your device forever, including library loans. KoboKeeps reads your annotations and builds a separate EPUB without modifying the original book or the Kobo database.

## Status

Early development.

## License

MIT

## Highlight colors

`KoboReader.sqlite` stores a color code rather than an RGB value. KoboKeeps preserves that original code and uses a reference palette matched to the four colors shown by Kobo's reader interface.

## Annotation archive

Every generated book contains `OEBPS/archive/kobo-annotations.json`. The file preserves annotation identifiers, source locations, timestamps, color codes, notes, selected text, and `ContextString` when Kobo provides it. It is not part of the reading spine or table of contents.

KoboKeeps uses an allowlisted data model and does not copy account credentials, sync tokens, DRM state, or other private Kobo database fields into the archive.
