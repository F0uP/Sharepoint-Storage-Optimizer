import { defineConfig } from "@playwright/test";

/** Drives the real Electron app (dist-desktop/app, run `npm run desktop:build` first). */
export default defineConfig({
  testDir: "./e2e-desktop",
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { trace: "retain-on-failure" },
});
