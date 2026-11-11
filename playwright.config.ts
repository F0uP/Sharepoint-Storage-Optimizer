import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // every test generates a full demo tenant in the browser – keep CPU contention low
  workers: process.env.CI ? 2 : 3,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "de-DE",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      // PW_CHANNEL=msedge uses an installed Edge instead of the downloaded Chromium
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, channel: process.env.PW_CHANNEL || undefined },
    },
  ],
  webServer: {
    // tests run against the production build (`npm run build` first)
    command: `npm run start -- -p ${PORT}`,
    // waiting on an API route also warms up the server before the first test
    url: `http://localhost:${PORT}/api/config`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { SKIP_ENV_FILES: "1", OPENAI_API_KEY: "", GEMINI_API_KEY: "", AZURE_CLIENT_ID: "" },
  },
});
