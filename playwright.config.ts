import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4327",
    locale: "en-US",
    viewport: { width: 1440, height: 1050 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "HOST=127.0.0.1 PORT=4327 node dist/server/entry.mjs",
    cwd: "./work/package-site",
    url: "http://127.0.0.1:4327/",
    reuseExistingServer: !process.env["CI"],
    timeout: 30000,
  },
});
