import { defineConfig } from "@playwright/test";

const TEST_PORT = 48731;
const TEST_ORIGIN = `http://127.0.0.1:${TEST_PORT}`;
const nodeExecutable = JSON.stringify(process.execPath);

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30_000,
  webServer: {
    command: `${nodeExecutable} node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${TEST_PORT}`,
    url: TEST_ORIGIN,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  use: {
    acceptDownloads: true,
    baseURL: TEST_ORIGIN,
    browserName: "chromium",
  },
});
