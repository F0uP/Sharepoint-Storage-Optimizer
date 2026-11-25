import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("spo:onboarding", JSON.stringify({ welcome: true, workspace: true })));
});

async function openDemo(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Demo ansehen" }).click();
  await page.getByText("Marketing & Kommunikation").click();
  await expect(page.getByRole("heading", { name: "Übersicht" })).toBeVisible({ timeout: 30_000 });
}

test("overall analysis finds cross-site duplicates and archives inactive sites", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Demo ansehen" }).click();
  await page.getByRole("tab", { name: "Gesamtanalyse" }).click();
  await page.getByRole("button", { name: /Alle 8 Sites analysieren/ }).click();

  await expect(page.getByText("Duplikate über Sites hinweg").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Imagefilm 2024 final.mp4")).toBeVisible();
  const inactive = page.locator("li").filter({ hasText: "Geschäftsführung" }).filter({ has: page.getByRole("button", { name: "Archivieren" }) });
  await inactive.getByRole("button", { name: "Archivieren" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/Set-SPOSiteArchiveState/)).toBeVisible();
  await dialog.getByRole("button", { name: "Archivieren" }).click();
  await expect(page.getByText(/„Geschäftsführung“ wird archiviert/)).toBeVisible();
  await expect(page.getByText(/Archiviert: Geschäftsführung/)).toBeVisible();
});

test("costs, forecast and previews", async ({ page }) => {
  await openDemo(page);
  await expect(page.getByText(/pro Jahr/).first()).toBeVisible();
  await expect(page.getByTestId("forecast")).toContainText(/Wachstum \+.*\/Monat/);

  await page.getByRole("button", { name: "Dateien", exact: true }).first().click();
  await expect(page.locator('table img[src^="data:image/svg+xml"]').first()).toBeVisible();
});

test("all folders can be explored, reported on and opened as a file list", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("button", { name: "Alle Ordner" }).click();
  const panel = page.getByRole("dialog", { name: "Ordner" });
  const libraries = panel.getByRole("list", { name: "Bibliotheken" });
  await expect(libraries.getByRole("listitem")).toHaveCount(3);

  // drill down: the folder shows its size and offers a report of its own
  await libraries.getByRole("button", { name: /^Dokumente öffnen/ }).click();
  await expect(panel.getByRole("navigation", { name: "Ordnerpfad" }).getByRole("button", { name: "Dokumente" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(panel.getByRole("list", { name: "Unterordner von Dokumente" }).getByRole("listitem").first()).toBeVisible();
  const download = page.waitForEvent("download");
  await panel.getByRole("button", { name: "Ordnerbericht", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/^Ordnerbericht-marketing-kommunikation-dokumente-\d{4}-\d{2}-\d{2}\.pdf$/);
  await expect(page.getByText("Bericht für „Dokumente“ erstellt")).toBeVisible();

  // search across all levels, then list the files of one folder
  await panel.getByLabel("Ordner suchen").fill("Archiv");
  await panel.getByRole("list", { name: "Suchergebnisse" }).getByRole("button", { name: "Dateien in Archiv anzeigen" }).first().click();
  await expect(panel).toBeHidden();
  await expect(page.getByRole("button", { name: /^Ordnerfilter .+\/Archiv entfernen$/ })).toBeVisible();
  await expect(page.locator("table tbody tr").first()).toContainText("/Archiv");
});

test("records under retention are skipped when deleting", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("button", { name: "Dateien", exact: true }).first().click();
  await page.getByPlaceholder("Name oder Pfad suchen …").fill("Vertrag");
  await page.getByRole("button", { name: /Alle \d+ auswählen/ }).click();
  await page.getByRole("button", { name: "Löschen", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText(/als Datensatz geschützt/)).toBeVisible();
  await expect(dialog.getByRole("heading")).toContainText("Keine löschbaren Dateien");
  await expect(dialog.getByRole("button", { name: "In Papierkorb verschieben" })).toBeDisabled();
});

test("owners decide in Teams, approved files are deleted", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("button", { name: "Dateien", exact: true }).first().click();
  const boxes = page.getByRole("checkbox", { name: "Zeile auswählen" });
  for (let i = 0; i < 8; i++) await boxes.nth(i).click();
  await page.getByRole("button", { name: "Weitere" }).click();
  await page.getByRole("menuitem", { name: "Besitzer fragen" }).click();
  const dialog = page.getByRole("dialog", { name: "Besitzer fragen" });
  await expect(dialog.getByRole("radio", { name: /Freigabe in Teams/ })).toHaveAttribute("aria-checked", "true");
  await dialog.getByRole("button", { name: /Personen? fragen/ }).click();
  await expect(page.getByText(/Besitzer gefragt/)).toBeVisible();

  await page.getByRole("button", { name: "Freigaben", exact: true }).first().click();
  await page.getByRole("button", { name: "Aktualisieren", exact: true }).click();
  await expect(page.getByText("Gelöscht", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Behalten", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Wartet auf Antwort in Teams").first()).toBeVisible();
});

test("a rule runs as scheduled cleanup job", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("button", { name: "Regeln", exact: true }).first().click();
  await page.getByRole("button", { name: "Automatisieren" }).click();
  // after the first run the job is saved and the dialog title changes
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Regel automatisieren" })).toBeVisible();
  await dialog.getByRole("button", { name: "Jetzt ausführen" }).click();
  await expect(dialog.getByText(/Dateien \(.+\) gefunden\./)).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("navigation", { name: "Aufräum-Jobs" })).toContainText("Temp- und Systemdateien");
});
