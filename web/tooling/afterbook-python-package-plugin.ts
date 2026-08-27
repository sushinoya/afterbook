import { stat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { zipSync } from "fflate";
import type { Plugin } from "vite";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY_ROOT = path.resolve(WEB_ROOT, "..");
const PYTHON_PACKAGE_ROOT = path.join(REPOSITORY_ROOT, "afterbook");
const PACKAGE_ROUTE = "/python/afterbook.zip";
const PACKAGE_ASSET_NAME = "python/afterbook.zip";

export function afterbookPythonPackagePlugin(): Plugin {
  return {
    name: "afterbook-python-package",
    configureServer(server) {
      server.middlewares.use(PACKAGE_ROUTE, async (_request, response, next) => {
        try {
          const archive = await createAfterbookPythonArchive();
          response.statusCode = 200;
          response.setHeader("Content-Type", "application/zip");
          response.setHeader("Cache-Control", "no-cache");
          response.end(Buffer.from(archive));
        } catch (error) {
          next(error as Error);
        }
      });
    },
    async generateBundle() {
      const archive = await createAfterbookPythonArchive();
      this.emitFile({
        type: "asset",
        fileName: PACKAGE_ASSET_NAME,
        source: archive,
      });
    },
  };
}

export async function createAfterbookPythonArchive(): Promise<Uint8Array> {
  const archiveEntries: Record<string, Uint8Array> = {};
  for (const filePath of await pythonSourceFiles(PYTHON_PACKAGE_ROOT)) {
    const archivePath = path.relative(REPOSITORY_ROOT, filePath).split(path.sep).join("/");
    archiveEntries[archivePath] = new Uint8Array(await readFile(filePath));
  }
  return zipSync(archiveEntries, { level: 9 });
}

async function pythonSourceFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await pythonSourceFiles(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith(".py")) {
      files.push(entryPath);
    }
  }

  return files.sort();
}

await assertDirectory(PYTHON_PACKAGE_ROOT);

async function assertDirectory(directory: string) {
  const metadata = await stat(directory);
  if (!metadata.isDirectory()) {
    throw new Error(`Expected Python package directory at ${directory}`);
  }
}
