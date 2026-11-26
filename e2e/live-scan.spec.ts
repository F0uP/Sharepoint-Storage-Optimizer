import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Live scan against a fake Microsoft Graph (app access): the workspace opens while the site is still being
 * read, the result is cached, and opening the site again only fetches the changes (delta query).
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("spo:onboarding", JSON.stringify({ welcome: true, workspace: true })));
});

const jwt = (claims: object) => {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "none" })}.${part(claims)}.sig`;
};

function cors(route: Route) {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": route.request().headers()["access-control-request-headers"] ?? "authorization, content-type",
  };
}

const GRAPH = "https://graph.microsoft.com/v1.0";
const MB = 1024 ** 2;
const file = (id: string, name: string, parent: string, size = 5 * MB) => ({
  id,
  name,
  size,
  file: { mimeType: "application/pdf", hashes: { quickXorHash: `h-${id}` } },
  parentReference: { id: parent },
  createdDateTime: "2024-01-01T00:00:00Z",
  lastModifiedDateTime: "2024-02-01T00:00:00Z",
  webUrl: `https://contoso.sharepoint.com/sites/vertrieb/${id}`,
});

/** Fake tenant with one site and one library; returns the delta URLs requested and a gate for page 2. */
async function mockGraph(page: Page) {
  const deltaRequests: string[] = [];
  let release!: () => void;
  const secondPage = new Promise<void>((resolve) => (release = resolve));

  await page.route("**/api/auth/token", (route) =>
    route.fulfill({ json: { accessToken: jwt({ roles: ["Sites.Read.All", "Files.ReadWrite.All"], app_displayname: "Speicher-App" }), expiresIn: 3600 } }),
  );
  await page.route("https://graph.microsoft.com/**", async (route) => {
    const request = route.request();
    const headers = cors(route);
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    const url = new URL(request.url());
    const json = (body: unknown) => route.fulfill({ headers, json: body });

    if (url.pathname.endsWith("/sites/root")) return json({ id: "root", webUrl: "https://contoso.sharepoint.com" });
    if (url.pathname.endsWith("/v1.0/sites")) {
      return json({ value: [{ id: "s1", displayName: "Vertrieb Nord", webUrl: "https://contoso.sharepoint.com/sites/vertrieb" }] });
    }
    if (url.pathname.endsWith("/$batch")) {
      const { requests } = request.postDataJSON() as { requests: { id: string }[] };
      return json({ responses: requests.map((r) => ({ id: r.id, status: 200, body: { quota: { total: 1e12, used: 4e11, remaining: 6e11, deleted: 0 } } })) });
    }
    if (url.pathname.endsWith("/sites/s1/drives")) {
      return json({ value: [{ id: "d1", name: "Dokumente", webUrl: "https://contoso.sharepoint.com/sites/vertrieb/Dokumente", driveType: "documentLibrary" }] });
    }
    // a subsite with a library of its own
    if (url.pathname.endsWith("/sites/s1/sites")) {
      return json({ value: [{ id: "s1sub", displayName: "Projekte", webUrl: "https://contoso.sharepoint.com/sites/vertrieb/projekte" }] });
    }
    if (url.pathname.endsWith("/sites/s1sub/drives")) {
      return json({ value: [{ id: "d3", name: "Dokumente", webUrl: "https://contoso.sharepoint.com/sites/vertrieb/projekte/Dokumente", driveType: "documentLibrary" }] });
    }
    if (url.pathname.endsWith("/sites/s1sub/sites")) return json({ value: [] });
    if (url.pathname.endsWith("/drives/d3/root/delta")) {
      if (url.searchParams.get("token")) return json({ value: [], "@odata.deltaLink": `${GRAPH}/drives/d3/root/delta?token=d3b` });
      return json({
        value: [{ id: "r3", name: "root", root: {}, folder: {} }, file("k", "Kunde.pdf", "r3", 3 * MB)],
        "@odata.deltaLink": `${GRAPH}/drives/d3/root/delta?token=d3a`,
      });
    }
    if (url.pathname.endsWith("/sites/s1/drive")) return json({ id: "d1", quota: { total: 1e12, used: 4e11, remaining: 6e11, deleted: 0 } });
    if (url.pathname.endsWith("/drives/d1/root/delta")) {
      const token = url.searchParams.get("token") ?? "start";
      deltaRequests.push(token);
      if (token === "start") {
        return json({
          value: [{ id: "r", name: "root", root: {}, folder: {} }, { id: "f1", name: "Projekte", folder: {}, parentReference: { id: "r" } }, file("a", "Plan.pdf", "f1")],
          "@odata.nextLink": `${GRAPH}/drives/d1/root/delta?token=p2`,
        });
      }
      if (token === "p2") {
        await secondPage;
        return json({ value: [file("b", "Budget.xlsx", "r", 8 * MB)], "@odata.deltaLink": `${GRAPH}/drives/d1/root/delta?token=d1` });
      }
      if (token === "d1") {
        return json({ value: [{ id: "b", deleted: { state: "deleted" } }, file("c", "Neu.pdf", "f1", 2 * MB)], "@odata.deltaLink": `${GRAPH}/drives/d1/root/delta?token=d2` });
      }
    }
    return route.fulfill({ status: 404, headers, json: { error: { message: "nicht gefälscht" } } });
  });
  return { deltaRequests, release: () => release() };
}

async function connect(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Einstellungen" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: "App-Zugriff" }).click();
  await dialog.getByLabel("Anwendungs-ID (Client-ID)").fill("11111111-2222-4333-8444-555555555555");
  await dialog.getByLabel(/Verzeichnis-ID/).fill("contoso.onmicrosoft.com");
  await dialog.getByLabel("Client-Secret").fill("s3cret");
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await page.getByRole("button", { name: "Mit App-Zugriff verbinden" }).click();
}

const filesView = (page: Page) => page.getByRole("button", { name: "Dateien", exact: true }).first();

test("a site can be used while it is read, and later only its changes are fetched", async ({ page }) => {
  test.setTimeout(120_000);
  const graph = await mockGraph(page);
  await connect(page);
  await page.getByText("Vertrieb Nord").click();

  // page 2 is still pending – the workspace is there anyway, marked as preliminary
  await expect(page.getByText(/wird noch im Hintergrund eingelesen/)).toBeVisible({ timeout: 30_000 });
  await filesView(page).click();
  await expect(page.getByText("Plan.pdf")).toBeVisible();

  graph.release();
  await expect(page.getByText("Site vollständig eingelesen")).toBeVisible();
  await expect(page.getByText(/wird noch im Hintergrund eingelesen/)).toBeHidden();
  await expect(page.getByText("Budget.xlsx")).toBeVisible();
  // the subsite's library is part of the site – its files carry the subsite in their path
  await expect(page.getByText("Kunde.pdf")).toBeVisible();
  await expect(page.getByText("Projekte/Dokumente", { exact: true })).toBeVisible();
  expect(graph.deltaRequests).toEqual(["start", "p2"]);

  // open the site again: the cached scan shows at once, only the changes are fetched
  await page.reload();
  await page.getByText("Vertrieb Nord").click();
  await expect(page.getByText("Site aktualisiert")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("1 neu · 1 entfernt (Dateien)")).toBeVisible();
  await filesView(page).click();
  await expect(page.getByText("Neu.pdf")).toBeVisible();
  await expect(page.getByText("Budget.xlsx")).toBeHidden();
  expect(graph.deltaRequests).toEqual(["start", "p2", "d1"]);

  // "Neu einlesen" drops the cache and reads everything again instead of only the changes
  await page.getByRole("button", { name: "Site komplett neu einlesen" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("bisher 3 Dateien");
  await confirm.getByRole("button", { name: "Komplett neu einlesen" }).click();
  await expect(page.getByText("Site vollständig eingelesen")).toBeVisible({ timeout: 30_000 });
  expect(graph.deltaRequests).toEqual(["start", "p2", "d1", "start", "p2"]);
  await filesView(page).click();
  await expect(page.getByText("Budget.xlsx")).toBeVisible();
});

test("after an update every site is read completely again", async ({ page }) => {
  test.setTimeout(120_000);
  const graph = await mockGraph(page);
  graph.release();
  await connect(page);
  await page.getByText("Vertrieb Nord").click();
  await expect(page.getByText("Site vollständig eingelesen")).toBeVisible({ timeout: 30_000 });
  expect(graph.deltaRequests).toEqual(["start", "p2"]);

  // the cache was written by an older version
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("keyval-store");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction("keyval", "readwrite");
          tx.objectStore("keyval").put("0.0.1", "cache-version");
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.reload();
  await expect(page.getByText(/Version .+ installiert/)).toBeVisible({ timeout: 30_000 });
  await page.getByText("Vertrieb Nord").click();
  await expect(page.getByText("Site vollständig eingelesen")).toBeVisible({ timeout: 30_000 });
  // no delta round on the old cache – a complete read
  expect(graph.deltaRequests).toEqual(["start", "p2", "start", "p2"]);
});
