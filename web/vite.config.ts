import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { afterbookPythonPackagePlugin } from "./tooling/afterbook-python-package-plugin.js";

export default defineConfig({
  plugins: [react(), afterbookPythonPackagePlugin()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
});
