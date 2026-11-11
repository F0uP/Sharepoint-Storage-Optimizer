import { expect, test, type Page } from "@playwright/test";

async function openDemo(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Demo ansehen" }).click();
  await page.getByText("Marketing & Kommunikation").click();
  await expect(page.getByRole("heading", { name: "Übersicht" })).toBeVisible({ timeout: 30_000 });
}

/** Fakes the AI backend so the flow runs without an API key. */
async function mockAi(page: Page) {
  await page.route("**/api/ai/analyze", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        json: {
          configured: true,
          providers: [
            { id: "openai", label: "OpenAI", model: "gpt-test" },
            { id: "gemini", label: "Google Gemini", model: "gemini-test" },
          ],
        },
      });
    }
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

test("login screen offers sign-in and demo", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Mehr Platz in SharePoint/ })).toBeVisible();
  // no Azure app configured in CI → sign-in disabled, hint visible
  await expect(page.getByRole("button", { name: "Mit Microsoft anmelden" })).toBeDisabled();
  await expect(page.getByText("AZURE_CLIENT_ID")).toBeVisible();
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

test("AI analysis with provider choice feeds files, optimizations and dismissals", async ({ page }) => {
  await mockAi(page);
  await openDemo(page);
  await page.getByRole("button", { name: "KI-Analyse" }).first().click();

  await page.getByRole("combobox", { name: "KI-Anbieter" }).first().click();
  await page.getByRole("option", { name: /Google Gemini/ }).click();
  await page.getByRole("button", { name: "Analyse starten" }).first().click();

  await expect(page.getByText("Der meiste Speicher liegt in Rohvideos")).toBeVisible();
  await expect(page.getByText(/Google Gemini · gemini-test · \d+ Dateien bewertet/)).toBeVisible();
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
