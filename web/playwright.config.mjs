import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30_000,
  webServer: {
    command: "python3 scripts/serve_for_playwright.py",
    url: "http://127.0.0.1:48731",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  use: {
    acceptDownloads: true,
    baseURL: "http://127.0.0.1:48731",
    browserName: "chromium",
  },
});
