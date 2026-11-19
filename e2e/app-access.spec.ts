import { expect, test, type Page, type Route } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("spo:onboarding", JSON.stringify({ welcome: true, workspace: true })));
});

const jwt = (claims: object) => {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "none" })}.${part(claims)}.sig`;
};

/** Graph is called cross-origin with a bearer token – the fake has to answer the CORS preflight as well. */
function cors(route: Route) {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": route.request().headers()["access-control-request-headers"] ?? "authorization, content-type",
  };
}

/** Fakes the token route and the Graph calls of the site picker. Returns the credentials the app sent. */
async function mockTenant(page: Page, roles = ["Sites.Read.All", "Files.ReadWrite.All"]) {
  const sent: Record<string, unknown>[] = [];
  await page.route("**/api/auth/token", (route) => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({ json: { accessToken: jwt({ roles, app_displayname: "Speicher-App" }), expiresIn: 3600 } });
  });
  await page.route("https://graph.microsoft.com/**", (route) => {
    const request = route.request();
    const headers = cors(route);
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    const url = new URL(request.url());
    if (url.pathname.endsWith("/sites/root")) return route.fulfill({ headers, json: { id: "root", webUrl: "https://contoso.sharepoint.com" } });
    if (url.pathname.endsWith("/v1.0/sites")) {
      return route.fulfill({
        headers,
        json: {
          value: [
            { id: "s1", displayName: "Vertrieb Nord", webUrl: "https://contoso.sharepoint.com/sites/vertrieb", lastModifiedDateTime: "2026-11-01T08:00:00Z" },
            { id: "s2", displayName: "Personal", webUrl: "https://contoso.sharepoint.com/sites/personal", lastModifiedDateTime: "2026-10-01T08:00:00Z" },
          ],
        },
      });
    }
    if (url.pathname.endsWith("/$batch")) {
      const { requests } = request.postDataJSON() as { requests: { id: string }[] };
      return route.fulfill({
        headers,
        json: {
          responses: requests.map((r) => ({ id: r.id, status: 200, body: { quota: { total: 1e12, used: 4e11, remaining: 6e11, deleted: 0 } } })),
        },
      });
    }
    return route.fulfill({ status: 404, headers, json: { error: { message: "nicht gefälscht" } } });
  });
  return sent;
}

async function setUpAppAccess(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Einstellungen" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: "App-Zugriff" }).click();
  await dialog.getByLabel("Anwendungs-ID (Client-ID)").fill("11111111-2222-4333-8444-555555555555");
  await dialog.getByLabel(/Verzeichnis-ID/).fill("contoso.onmicrosoft.com");
  return dialog;
}

test("app access connects without a user sign-in", async ({ page }) => {
  // two full page loads plus the settings flow
  test.setTimeout(120_000);
  const sent = await mockTenant(page);
  const dialog = await setUpAppAccess(page);

  // the secret is required in app mode
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(dialog.getByText("Hinterlege ein Client-Secret oder ein Zertifikat.")).toBeVisible();

  await dialog.getByLabel("Client-Secret").fill("s3cret");
  await dialog.getByRole("button", { name: "Prüfen" }).click();
  const report = dialog.getByRole("list", { name: "Ergebnis der Prüfung" });
  await expect(report.locator('[data-state="ok"]')).toHaveCount(3);
  await expect(report).toContainText("Versionen, Papierkorb, Versionslimits");
  await expect(dialog.getByText("App „Speicher-App“ · contoso.sharepoint.com")).toBeVisible();

  await dialog.getByRole("button", { name: "Speichern" }).click();
  await page.getByRole("button", { name: "Mit App-Zugriff verbinden" }).click();
  await expect(page.getByText("Vertrieb Nord")).toBeVisible();
  expect(sent[0]).toMatchObject({ clientSecret: "s3cret", resource: "https://graph.microsoft.com" });

  // no sign-in after a reload either
  await page.reload();
  await expect(page.getByText("Personal", { exact: true })).toBeVisible();
});

test("explains missing admin consent when connecting", async ({ page }) => {
  await mockTenant(page, []);
  const dialog = await setUpAppAccess(page);
  await dialog.getByLabel("Client-Secret").fill("s3cret");
  await dialog.getByRole("button", { name: "Speichern" }).click();

  await page.getByRole("button", { name: "Mit App-Zugriff verbinden" }).click();
  const alert = page.getByRole("alert").filter({ hasText: "Verbindung fehlgeschlagen" });
  await expect(alert).toContainText("Administratorzustimmung erteilen");
});

test("generates a certificate for SharePoint", async ({ page }) => {
  const dialog = await setUpAppAccess(page);
  await dialog.getByRole("button", { name: "Zertifikat erzeugen" }).click();
  const certificate = dialog.getByTestId("app-certificate");
  await expect(certificate).toContainText("SharePoint Storage Optimizer");
  await expect(certificate).toContainText(/Gültig bis/);

  const download = page.waitForEvent("download");
  await certificate.getByRole("button", { name: ".cer für Entra herunterladen" }).click();
  expect((await download).suggestedFilename()).toBe("sharepoint-storage-optimizer.cer");
});
