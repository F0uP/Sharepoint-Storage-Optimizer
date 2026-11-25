import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const APP_DIR = path.resolve("dist-desktop/app");

let userData: string;
const running: ElectronApplication[] = [];

async function launch() {
  const env = { ...process.env };
  // set by VS Code / other Electron hosts – would start Electron as plain Node
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: [APP_DIR],
    env: { ...env, DESKTOP_USER_DATA: userData, OPENAI_API_KEY: "", GEMINI_API_KEY: "", AZURE_CLIENT_ID: "" },
  });
  running.push(app);
  const page = await app.firstWindow();
  // skip the first-run introduction (data: URLs of the loading screen have no storage)
  await page.addInitScript(() => {
    try {
      localStorage.setItem("spo:onboarding", JSON.stringify({ welcome: true, workspace: true }));
    } catch {}
  });
  await expect(page.getByRole("heading", { name: /Mehr Platz in SharePoint/ })).toBeVisible({ timeout: 60_000 });
  return { app, page };
}

test.beforeEach(() => {
  userData = mkdtempSync(path.join(os.tmpdir(), "spo-desktop-"));
});

test.afterEach(async () => {
  await Promise.all(running.splice(0).map((app) => app.close().catch(() => {})));
  rmSync(userData, { recursive: true, force: true });
});

test("starts the bundled server and runs the demo", async () => {
  const { page } = await launch();
  expect(page.url()).toMatch(/^http:\/\/localhost:\d+\/$/);
  expect(await page.evaluate(() => typeof window.desktop?.saveSettings)).toBe("function");

  await page.getByRole("button", { name: "Demo ansehen" }).click();
  await page.getByText("Marketing & Kommunikation").click();
  await expect(page.getByRole("heading", { name: "Übersicht" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Einsparpotenzial")).toBeVisible();
});

test("keeps API keys encrypted on disk across restarts", async () => {
  let { app, page } = await launch();
  await page.getByRole("button", { name: "Einstellungen" }).click();
  const dialog = page.getByRole("dialog", { name: "Einstellungen" });
  await expect(dialog.getByText(/verschlüsselt mit dem Schlüsselspeicher/)).toBeVisible();
  await dialog.getByRole("tab", { name: "KI-Anbieter" }).click();
  await dialog.getByLabel("API-Schlüssel").first().fill("sk-desktop-secret-123");
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(dialog).toBeHidden();

  const file = readFileSync(path.join(userData, "settings.json"), "utf8");
  expect(JSON.parse(file)).toMatchObject({ version: 1, encrypted: true });
  expect(file).not.toContain("sk-desktop-secret-123");

  await app.close();
  ({ app, page } = await launch());
  await page.getByRole("button", { name: "Einstellungen" }).click();
  await page.getByRole("tab", { name: "KI-Anbieter" }).click();
  await expect(page.getByLabel("API-Schlüssel").first()).toHaveValue("sk-desktop-secret-123");
});

test("opens external links in the default browser, not in the app", async () => {
  const { app, page } = await launch();
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as { opened?: string[] }).opened = opened;
    shell.openExternal = async (url: string) => {
      opened.push(url);
    };
  });

  await page.getByRole("button", { name: "Microsoft 365 verbinden" }).click();
  await page.getByRole("link", { name: /Entra Admin Center öffnen/ }).click();

  await expect.poll(() => app.evaluate(() => (globalThis as { opened?: string[] }).opened ?? [])).toEqual([
    expect.stringContaining("https://entra.microsoft.com/"),
  ]);
  expect(app.windows()).toHaveLength(1);
});

async function openDemo(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Demo ansehen" }).click();
  await page.getByText("Marketing & Kommunikation").click();
  await expect(page.getByRole("heading", { name: "Übersicht" })).toBeVisible({ timeout: 60_000 });
}

test("backs up files into a local folder before deleting them", async () => {
  const { app, page } = await launch();
  const target = mkdtempSync(path.join(os.tmpdir(), "spo-backup-"));
  // the native folder picker is replaced by a fixed folder
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as typeof dialog.showOpenDialog;
  }, target);

  await openDemo(page);
  await page.getByRole("button", { name: "Dateien", exact: true }).first().click();
  const boxes = page.getByRole("checkbox", { name: "Zeile auswählen" });
  await boxes.nth(0).click();
  await boxes.nth(1).click();
  await page.getByRole("button", { name: "Weitere" }).click();
  await page.getByRole("menuitem", { name: "Lokal sichern & löschen" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Ordner wählen" }).click();
  await expect(dialog.getByText(target)).toBeVisible();
  // the complete SharePoint path is recreated by default – the preview shows where the files land
  await expect(dialog.getByRole("radio", { name: "Kompletter Pfad" })).toHaveAttribute("data-state", "on");
  await expect(dialog.getByTestId("backup-preview")).toContainText("Marketing & Kommunikation");
  await dialog.getByRole("button", { name: "Sichern & löschen" }).click();
  await expect(page.getByText("2 Dateien gesichert und gelöscht")).toBeVisible();

  const written = readdirSync(target, { recursive: true, withFileTypes: true }).filter((e) => e.isFile());
  const index = written.filter((e) => e.parentPath === target && /^Sicherung .+\.csv$/.test(e.name));
  const copies = written.filter((e) => !index.includes(e));
  expect(index).toHaveLength(1);
  expect(copies).toHaveLength(2);
  for (const copy of copies) expect(copy.parentPath.startsWith(path.join(target, "Marketing & Kommunikation"))).toBe(true);
  expect(readFileSync(path.join(copies[0].parentPath, copies[0].name), "utf8")).toContain("Demo-Platzhalter");
  expect(readFileSync(path.join(target, index[0].name), "utf8")).toContain("Lokale Datei;Site;SharePoint-Pfad");
  rmSync(target, { recursive: true, force: true });
});

test("compresses videos and shows the desktop settings", async () => {
  const { page } = await launch();
  await openDemo(page);
  await page.getByRole("button", { name: "Dateien", exact: true }).first().click();
  await page.getByRole("radio", { name: /Videos/ }).click();
  await page.getByRole("checkbox", { name: "Zeile auswählen" }).nth(0).click();
  await page.getByRole("button", { name: "Weitere" }).click();
  await page.getByRole("menuitem", { name: "Komprimieren" }).click();
  const dialog = page.getByRole("dialog", { name: "Medien komprimieren" });
  await dialog.getByRole("button", { name: /1 komprimieren/ }).click();
  await expect(dialog.getByText(/freigegeben/)).toBeVisible();
  await dialog.getByRole("button", { name: "Fertig" }).click();

  await page.keyboard.press("Control+k");
  await page.getByRole("dialog").getByRole("combobox").fill("Einstellungen");
  await page.getByRole("dialog").getByRole("option", { name: "Einstellungen" }).click();
  await page.getByRole("tab", { name: "Desktop" }).click();
  await expect(page.getByText("Im Hintergrund weiterlaufen", { exact: true })).toBeVisible();
  await expect(page.getByText(/^Version \d+\.\d+\.\d+/)).toBeVisible();
});
