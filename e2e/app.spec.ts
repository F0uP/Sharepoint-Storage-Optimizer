import { expect, test, type Page } from "@playwright/test";

// the first-run introduction has its own spec (onboarding.spec.ts)
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("spo:onboarding", JSON.stringify({ welcome: true, workspace: true })));
});

async function openDemo(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Demo ansehen" }).click();
  await page.getByText("Marketing & Kommunikation").click();
  await expect(page.getByRole("heading", { name: "Übersicht" })).toBeVisible({ timeout: 30_000 });
}

/** Fakes the AI provider calls; records which API key the app sent along. */
async function mockAi(page: Page, sentKeys: string[] = []) {
  await page.route("**/api/ai/verify", (route) =>
    route.fulfill({ json: { ok: true, id: "openai", label: "OpenAI", model: route.request().postDataJSON().model ?? "gpt-test" } }),
  );
  await page.route("**/api/ai/analyze", async (route) => {
    sentKeys.push(route.request().headers()["x-ai-api-key"] ?? "");
    const body = route.request().postDataJSON();
    const actions = ["delete", "archive", "compress", "review"];
    return route.fulfill({
      json: {
        id: body.provider,
        label: body.provider === "gemini" ? "Google Gemini" : "OpenAI",
        model: body.provider === "gemini" ? "gemini-test" : "gpt-test",
        summary: "Der meiste Speicher liegt in Rohvideos und alten Exporten.",
        tips: [{ title: "Versionslimit setzen", detail: "Maximal 50 Versionen pro Datei." }],
        recommendations: body.files.slice(0, 40).map((f: { i: number }, n: number) => ({
          i: f.i,
          action: actions[n % actions.length],
          priority: n % 2 ? "medium" : "high",
          reason: "Testbegründung",
        })),
      },
    });
  });
}

test("Microsoft 365 connection is configured in the app, without an env file", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Mehr Platz in SharePoint/ })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Microsoft 365 verbinden" }).click();

  const dialog = page.getByRole("dialog", { name: "Einstellungen" });
  await expect(dialog.getByLabel("Umleitungs-URI", { exact: true })).toHaveValue(/\/auth\/redirect$/);
  await dialog.getByLabel("Anwendungs-ID (Client-ID)").fill("not-a-guid");
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(dialog.getByText(/Client-ID ist eine GUID/)).toBeVisible();

  await dialog.getByLabel("Anwendungs-ID (Client-ID)").fill("3f2b8c1e-5d4a-4c7b-9e21-8a6f0d3c9a4d");
  await dialog.getByRole("button", { name: "Speichern" }).click();

  // the page reloads with the new app registration
  await expect(page.getByRole("button", { name: "Mit Microsoft anmelden" })).toBeEnabled({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Microsoft 365 verbinden" })).toHaveCount(0);
});

test("overview shows storage, potential and charts", async ({ page }) => {
  await openDemo(page);
  await expect(page.getByText("Belegter Speicher")).toBeVisible();
  await expect(page.getByText("Einsparpotenzial")).toBeVisible();
  await expect(page.getByText("Speicher nach Dateityp")).toBeVisible();
  await expect(page.getByRole("img", { name: "Speicher nach Dateityp" })).toBeVisible();
});

test("filter videos and delete a Shift-selected range", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("button", { name: "Dateien", exact: true }).first().click();
  await page.getByRole("radio", { name: /Videos/ }).click();

  const summary = page.getByText(/Dateien ·/).first();
  const countBefore = Number((await summary.textContent())!.replace(/\D[\s\S]*$/, "").replace(/\./g, ""));

  const boxes = page.getByRole("checkbox", { name: "Zeile auswählen" });
  await boxes.nth(0).click();
  await boxes.nth(2).click({ modifiers: ["Shift"] });
  await expect(page.getByText(/ausgewählt ·/)).toContainText("3 ausgewählt");

  await page.getByRole("button", { name: "Löschen", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText("3 Dateien löschen?")).toBeVisible();
  await dialog.getByRole("switch").click();
  await dialog.getByRole("button", { name: "Endgültig löschen" }).click();

  await expect(page.getByText("3 Dateien gelöscht")).toBeVisible();
  await expect(summary).toContainText(`${countBefore - 3} Dateien`);
  // sidebar counter for this session
  await expect(page.getByText(/freigegeben$/).first()).toBeVisible();
});

test("version scan finds old versions", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("button", { name: "Optimierungen" }).first().click();
  await page.getByRole("button", { name: /Versionsverlauf/ }).click();
  await page.getByRole("button", { name: "Jetzt analysieren" }).click();
  await expect(page.getByText("Versionsverlauf analysiert")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: /Alte Versionen/ })).toBeVisible();
});

test("AI analysis retries by itself while the provider is overloaded", async ({ page }) => {
  await page.clock.install();
  await mockAi(page);
  let calls = 0;
  // registered last, so it answers first: only the first call hits an overloaded provider
  await page.route("**/api/ai/analyze", (route) =>
    calls++ === 0 ? route.fulfill({ status: 503, json: { error: "OpenAI ist gerade überlastet.", retryAfter: 0 } }) : route.fallback(),
  );
  await openDemo(page);
  await page.getByRole("button", { name: "KI-Analyse" }).first().click();
  await page.getByRole("button", { name: "API-Schlüssel hinterlegen" }).click();
  const dialog = page.getByRole("dialog", { name: "Einstellungen" });
  await dialog.getByLabel("API-Schlüssel").first().fill("sk-test-openai");
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "Analyse starten" }).first().click();
  await expect(page.getByRole("status").filter({ hasText: "überlastet" })).toContainText(
    /OpenAI ist gerade überlastet\. Neuer Versuch in \d+ s \(1 von 3\)\./,
  );
  await page.clock.fastForward(10_000);
  await expect(page.getByText("Der meiste Speicher liegt in Rohvideos")).toBeVisible();
  expect(calls).toBe(2);
});

test("AI keys are entered in the app and drive the analysis", async ({ page }) => {
  const sentKeys: string[] = [];
  await mockAi(page, sentKeys);
  await openDemo(page);
  await page.getByRole("button", { name: "KI-Analyse" }).first().click();

  // no provider yet → straight into the settings
  await page.getByRole("button", { name: "API-Schlüssel hinterlegen" }).click();
  const dialog = page.getByRole("dialog", { name: "Einstellungen" });
  await expect(dialog.getByRole("tab", { name: "KI-Anbieter" })).toHaveAttribute("aria-selected", "true");
  await dialog.getByLabel("API-Schlüssel").first().fill("sk-test-openai");
  await dialog.getByRole("button", { name: "Prüfen" }).first().click();
  await expect(dialog.getByText(/Verbindung erfolgreich/)).toBeVisible();
  await dialog.getByLabel("API-Schlüssel").nth(1).fill("AIza-test-gemini");
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole("combobox", { name: "KI-Anbieter" }).first().click();
  await page.getByRole("option", { name: /Google Gemini/ }).click();
  await page.getByRole("button", { name: "Analyse starten" }).first().click();

  await expect(page.getByText("Der meiste Speicher liegt in Rohvideos")).toBeVisible();
  await expect(page.getByText(/Google Gemini · gemini-test · \d+ Dateien bewertet/)).toBeVisible();
  expect(sentKeys).toEqual(["AIza-test-gemini"]);
  await expect(page.getByRole("tab", { name: /Löschen/ })).toHaveAttribute("aria-selected", "true");

  // quick select + ignore
  await page.getByRole("button", { name: /Hohe Priorität/ }).click();
  await page.getByRole("button", { name: "Ignorieren" }).click();
  await expect(page.getByText(/Empfehlungen ignoriert/)).toBeVisible();

  // AI recommendations appear as their own optimization category …
  await page.getByRole("button", { name: "Optimierungen" }).first().click();
  await expect(page.getByRole("button", { name: /KI-Löschempfehlungen/ })).toBeVisible();

  // … and as markers in the file list
  await page.getByRole("button", { name: "Dateien", exact: true }).first().click();
  await page.getByText("Nur KI-Vorschläge").click();
  await expect(page.getByText("Archivieren").first()).toBeVisible();
});

test("command palette navigates and finds files", async ({ page }) => {
  await openDemo(page);
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog");
  await palette.getByRole("combobox").fill("Optimierungen");
  await palette.getByRole("option", { name: "Optimierungen" }).click();
  await expect(page.getByRole("heading", { name: "Optimierungen" })).toBeVisible();

  await page.keyboard.press("Control+k");
  await page.getByRole("dialog").getByRole("combobox").fill("Imagefilm");
  await page.getByRole("dialog").getByRole("option").first().click();
  await expect(page.getByRole("heading", { name: "Dateien" })).toBeVisible();
  await expect(page.getByPlaceholder("Name oder Pfad suchen …")).toHaveValue(/Imagefilm/);
});

test("site overview ranks all sites by storage", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Demo ansehen" }).click();
  await expect(page.getByText(/8 Sites belegen zusammen/)).toBeVisible({ timeout: 30_000 });
  const first = page.locator("main button").filter({ hasText: "%" }).first();
  await expect(first).toContainText("Marketing & Kommunikation");
  await page.getByRole("radio", { name: "A–Z" }).click();
  await expect(page.locator("main button").filter({ hasText: "%" }).first()).toContainText("Geschäftsführung");
});

test("cleanup rule applies in one click and can be undone from the history", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("button", { name: "Regeln", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Temp- und Systemdateien" })).toBeVisible();

  await page.getByRole("button", { name: /^Anwenden/ }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "In Papierkorb verschieben" }).click();
  await expect(page.getByText(/Dateien gelöscht/)).toBeVisible();
  await page.getByRole("button", { name: "Rückgängig" }).click();
  await expect(page.getByText(/Dateien wiederhergestellt/)).toBeVisible();

  await page.getByRole("button", { name: "Verlauf", exact: true }).first().click();
  await expect(page.getByText("Gelöscht", { exact: true })).toBeVisible();
  await expect(page.getByText("Wiederhergestellt", { exact: true })).toBeVisible();
});

test("own cleanup rules are saved and listed", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("button", { name: "Regeln", exact: true }).first().click();
  await page.getByRole("button", { name: "Neue Regel" }).click();
  const dialog = page.getByRole("dialog", { name: "Neue Regel" });
  await dialog.getByLabel("Name", { exact: true }).fill("Alte ZIP-Archive");
  await dialog.getByLabel("Dateiendungen").fill("zip, rar");
  await expect(dialog.getByText(/Trifft aktuell auf [1-9][\d.]* Dateien/)).toBeVisible();
  await dialog.getByRole("button", { name: "Regel speichern" }).click();
  await expect(page.getByText("Eigene Regeln")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Alte ZIP-Archive" })).toBeVisible();
});

test("overview shows the storage trend and exports a PDF report", async ({ page }) => {
  await openDemo(page);
  await expect(page.getByText("Speicherverlauf")).toBeVisible();
  await expect(page.getByText(/seit \d{2}\.\d{2}\.\d{4}/)).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Bericht" }).click();
  expect((await download).suggestedFilename()).toMatch(/^Speicherbericht-marketing-kommunikation-\d{4}-\d{2}-\d{2}\.pdf$/);
});

test("owners are notified and version limits are set", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("button", { name: "Dateien", exact: true }).first().click();
  const boxes = page.getByRole("checkbox", { name: "Zeile auswählen" });
  await boxes.nth(0).click();
  await boxes.nth(1).click();
  await page.getByRole("button", { name: "Weitere" }).click();
  await page.getByRole("menuitem", { name: "Besitzer fragen" }).click();
  const dialog = page.getByRole("dialog", { name: "Besitzer fragen" });
  await expect(dialog.getByText(/@contoso\.com/).first()).toBeVisible();
  await dialog.getByRole("radio", { name: /E-Mail/ }).click();
  await expect(dialog.getByLabel("Nachricht für die E-Mail")).toBeVisible();
  await dialog.getByRole("button", { name: /Personen? fragen/ }).click();
  await expect(page.getByText(/Besitzer gefragt/)).toBeVisible();

  await page.getByRole("button", { name: "Optimierungen" }).first().click();
  await page.getByRole("button", { name: /Versionsverlauf/ }).click();
  await page.getByRole("button", { name: "Einstellungen laden" }).click();
  await page.getByRole("button", { name: "Für alle Bibliotheken übernehmen" }).click();
  await expect(page.getByText(/Versionslimit für .* gesetzt/).first()).toBeVisible();
  await expect(page.getByText("Aktuell: 100 Versionen").first()).toBeVisible();
});
