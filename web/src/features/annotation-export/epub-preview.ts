import { strFromU8, unzipSync } from "fflate";

import type { GeneratedEpub } from "../../domain/readers.js";

export interface EpubPreviewDocument {
  title: string;
  pages: EpubPreviewPage[];
}

export interface EpubPreviewPage {
  id: string;
  title: string;
  bodyHtml: string;
  kind: "cover" | "title" | "chapter";
}

interface ManifestItem {
  href: string;
  mediaType: string;
}

const PACKAGE_PATH = "OEBPS/content.opf";
const UNSAFE_SELECTOR = "script, iframe, object, embed, form, input, button";

export function parseGeneratedEpubPreview(epub: GeneratedEpub): EpubPreviewDocument {
  const files = unzipSync(epub.data);
  const packageXml = readTextFile(files, PACKAGE_PATH);
  const packageDocument = parseXml(packageXml, "application/xml");
  const manifest = readManifest(packageDocument);
  const orderedPaths = readSpine(packageDocument, manifest);
  const pagePaths = orderedPaths.length > 0 ? orderedPaths : fallbackPagePaths(files);
  const pages = pagePaths
    .filter((path) => path in files)
    .map((path) => readXhtmlPage(files, path));

  if (pages.length === 0) {
    throw new Error("Generated EPUB has no readable pages.");
  }

  return {
    title: textByLocalName(packageDocument, "title") || stripEpubExtension(epub.filename),
    pages,
  };
}

function readManifest(document: Document): Map<string, ManifestItem> {
  const manifest = new Map<string, ManifestItem>();
  for (const element of Array.from(document.getElementsByTagName("item"))) {
    const id = element.getAttribute("id");
    const href = element.getAttribute("href");
    const mediaType = element.getAttribute("media-type");
    if (id && href && mediaType) {
      manifest.set(id, { href, mediaType });
    }
  }
  return manifest;
}

function readSpine(document: Document, manifest: ReadonlyMap<string, ManifestItem>): string[] {
  const paths: string[] = [];
  for (const element of Array.from(document.getElementsByTagName("itemref"))) {
    const item = manifest.get(element.getAttribute("idref") || "");
    if (item?.mediaType === "application/xhtml+xml") {
      paths.push(resolveEpubPath(PACKAGE_PATH, item.href));
    }
  }
  return paths;
}

function fallbackPagePaths(files: Record<string, Uint8Array>): string[] {
  const chapters = Object.keys(files)
    .filter((path) => /^OEBPS\/chapter-\d+\.xhtml$/.test(path))
    .sort(compareChapterPaths);
  return ["OEBPS/cover.xhtml", "OEBPS/title.xhtml", ...chapters].filter((path) => path in files);
}

function readXhtmlPage(files: Record<string, Uint8Array>, path: string): EpubPreviewPage {
  const document = parseXml(readTextFile(files, path), "application/xhtml+xml");
  const body = firstElementByLocalName(document, "body");
  if (!body) {
    throw new Error(`EPUB page has no body: ${path}`);
  }

  for (const element of Array.from(body.querySelectorAll(UNSAFE_SELECTOR))) {
    element.remove();
  }
  rewriteResourceLinks(files, path, body);

  return {
    id: path,
    title: textByLocalName(document, "title") || titleFromPath(path),
    bodyHtml: body.innerHTML,
    kind: kindFromPath(path),
  };
}

function rewriteResourceLinks(
  files: Record<string, Uint8Array>,
  documentPath: string,
  root: Element,
) {
  for (const element of Array.from(root.querySelectorAll("*"))) {
    for (const attribute of ["src", "href", "xlink:href"]) {
      const value = element.getAttribute(attribute);
      if (!value || isExternalReference(value) || value.startsWith("#")) {
        continue;
      }
      const [target, fragment = ""] = value.split("#", 2);
      if (!target || target.endsWith(".xhtml")) {
        continue;
      }
      const resourcePath = resolveEpubPath(documentPath, target);
      const bytes = files[resourcePath];
      if (!bytes) {
        continue;
      }
      const dataUrl = `data:${mediaTypeForPath(resourcePath)};base64,${base64Encode(bytes)}`;
      element.setAttribute(attribute, fragment ? `${dataUrl}#${fragment}` : dataUrl);
    }
  }
}

function readTextFile(files: Record<string, Uint8Array>, path: string): string {
  const bytes = files[path];
  if (!bytes) {
    throw new Error(`Generated EPUB is missing ${path}.`);
  }
  return strFromU8(bytes);
}

function parseXml(source: string, mimeType: DOMParserSupportedType): Document {
  const document = new DOMParser().parseFromString(source, mimeType);
  const parserError = firstElementByLocalName(document, "parsererror");
  if (parserError) {
    throw new Error(parserError.textContent?.trim() || "Could not parse EPUB XML.");
  }
  return document;
}

function firstElementByLocalName(document: Document | Element, localName: string) {
  return Array.from(document.getElementsByTagName("*")).find(
    (element) => element.localName === localName,
  );
}

function textByLocalName(document: Document, localName: string): string {
  return firstElementByLocalName(document, localName)?.textContent?.trim() || "";
}

function resolveEpubPath(fromPath: string, reference: string): string {
  if (reference.startsWith("/")) {
    return normalizePath(reference.slice(1));
  }
  return normalizePath(`${directoryName(fromPath)}/${reference}`);
}

function normalizePath(path: string): string {
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

function directoryName(path: string): string {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(0, index) : "";
}

function titleFromPath(path: string): string {
  if (path.endsWith("cover.xhtml")) {
    return "Cover";
  }
  if (path.endsWith("title.xhtml")) {
    return "Clippings";
  }
  const match = path.match(/chapter-(\d+)\.xhtml$/);
  return match ? `Chapter ${match[1]}` : "Page";
}

function kindFromPath(path: string): EpubPreviewPage["kind"] {
  if (path.endsWith("cover.xhtml")) {
    return "cover";
  }
  if (path.endsWith("title.xhtml")) {
    return "title";
  }
  return "chapter";
}

function compareChapterPaths(left: string, right: string): number {
  return chapterNumber(left) - chapterNumber(right);
}

function chapterNumber(path: string): number {
  return Number(path.match(/chapter-(\d+)\.xhtml$/)?.[1] || Number.MAX_SAFE_INTEGER);
}

function stripEpubExtension(filename: string): string {
  return filename.replace(/\.epub$/i, "");
}

function isExternalReference(value: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(value) || value.startsWith("data:");
}

function mediaTypeForPath(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  if (extension === "png") {
    return "image/png";
  }
  if (extension === "jpg" || extension === "jpeg") {
    return "image/jpeg";
  }
  if (extension === "svg") {
    return "image/svg+xml";
  }
  if (extension === "webp") {
    return "image/webp";
  }
  return "application/octet-stream";
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
