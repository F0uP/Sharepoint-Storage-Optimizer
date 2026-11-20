// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appSession,
  CERTIFICATE_REQUIRED,
  checkAppAccess,
  configureAuth,
  connectApp,
  currentIdentity,
  disconnectApp,
  explainSharePointError,
  getToken,
  hasLiveSession,
  isAuthConfigured,
  NO_APP_PERMISSIONS,
  resourceOf,
  type AppCredentials,
} from "./auth";

const jwt = (claims: object) => {
  const part = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${part({ alg: "none" })}.${part(claims)}.sig`;
};

const credentials: AppCredentials = {
  clientId: "11111111-2222-4333-8444-555555555555",
  tenantId: "contoso.onmicrosoft.com",
  clientSecret: "s3cret",
  certificate: "",
  mailSender: "",
};

const APP_TOKEN = jwt({ roles: ["Sites.Read.All", "Files.ReadWrite.All"], app_displayname: "Speicher-App" });

/** Fakes the token route and Graph. */
function stubNetwork({ token = APP_TOKEN, expiresIn = 3600, sites = 200 } = {}) {
  const calls: { url: string; body?: Record<string, unknown> }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url === "/api/auth/token") return Response.json({ accessToken: token, expiresIn });
    if (url.startsWith("https://graph.microsoft.com/v1.0/sites/root")) {
      return sites === 200
        ? Response.json({ id: "root", webUrl: "https://contoso.sharepoint.com" })
        : Response.json({ error: { message: "Forbidden" } }, { status: sites });
    }
    if (url === "/api/sharepoint") return Response.json({ Title: "Contoso" });
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

beforeEach(() => configureAuth({ ...credentials }));
afterEach(() => {
  disconnectApp();
  localStorage.clear();
  vi.useRealTimers();
});

describe("resourceOf", () => {
  it("maps scopes to their resource", () => {
    expect(resourceOf(["Sites.Read.All"])).toBe("https://graph.microsoft.com");
    expect(resourceOf(["https://contoso.sharepoint.com/AllSites.Manage"])).toBe("https://contoso.sharepoint.com");
  });
});

describe("app tokens", () => {
  it("are requested once per resource and reused until shortly before they expire", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { fetchMock, calls } = stubNetwork();

    const [a, b] = await Promise.all([getToken(["Sites.Read.All"]), getToken(["Mail.Send"])]);
    expect(a).toBe(APP_TOKEN);
    expect(b).toBe(APP_TOKEN);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calls[0].body).toEqual({
      clientId: credentials.clientId,
      tenantId: credentials.tenantId,
      resource: "https://graph.microsoft.com",
      clientSecret: "s3cret",
    });

    vi.advanceTimersByTime(54 * 60_000);
    await getToken(["Sites.Read.All"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2 * 60_000); // less than 5 minutes left
    await getToken(["Sites.Read.All"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never sends a secret to SharePoint – a certificate is required there", async () => {
    const { fetchMock } = stubNetwork();
    await expect(getToken(["https://contoso.sharepoint.com/AllSites.Manage"])).rejects.toThrow(CERTIFICATE_REQUIRED);
    expect(fetchMock).not.toHaveBeenCalled();

    configureAuth({ ...credentials, certificate: "-----BEGIN CERTIFICATE-----" });
    const { calls } = stubNetwork();
    await getToken(["https://contoso.sharepoint.com/AllSites.Manage"]);
    expect(calls[0].body).toMatchObject({ resource: "https://contoso.sharepoint.com", certificate: "-----BEGIN CERTIFICATE-----" });
    expect(calls[0].body).not.toHaveProperty("clientSecret");
  });

  it("reports incomplete settings", async () => {
    configureAuth({ ...credentials, clientSecret: "" });
    expect(isAuthConfigured()).toBe(false);
    await expect(getToken(["Sites.Read.All"])).rejects.toThrow(/nicht vollständig eingerichtet/);
  });

  it("passes on the explained error of the token route", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Das Client-Secret ist abgelaufen." }, { status: 401 })));
    await expect(getToken(["Sites.Read.All"])).rejects.toThrow("Das Client-Secret ist abgelaufen.");
  });
});

describe("explainSharePointError", () => {
  it("translates token rejections and only blames app permissions with app access", () => {
    expect(explainSharePointError("Unsupported app only token.")).toMatch(/Zertifikat/);
    expect(explainSharePointError("Access denied.", true)).toMatch(/Sites\.FullControl\.All/);
    expect(explainSharePointError("Access denied.", false)).toBe("Access denied.");
  });
});

describe("connectApp", () => {
  it("checks the access and remembers the connection", async () => {
    stubNetwork();
    expect(await hasLiveSession()).toBe(false);

    await expect(connectApp()).resolves.toEqual({ host: "contoso.sharepoint.com", app: "Speicher-App" });
    expect(appSession()).toEqual({ host: "contoso.sharepoint.com", app: "Speicher-App" });
    expect(await hasLiveSession()).toBe(true);
    expect(currentIdentity()).toEqual({ name: "App-Zugriff", detail: "contoso.sharepoint.com" });

    disconnectApp();
    expect(await hasLiveSession()).toBe(false);
  });

  it("explains missing admin consent", async () => {
    stubNetwork({ token: jwt({ app_displayname: "Speicher-App" }) });
    await expect(connectApp()).rejects.toThrow(NO_APP_PERMISSIONS);
    expect(appSession()).toBeNull();
  });

  it("explains a denied site access", async () => {
    stubNetwork({ sites: 403 });
    await expect(connectApp()).rejects.toThrow(/HTTP 403.*Forbidden/);
  });

  it("names the missing site permission instead of calling Graph", async () => {
    const { calls } = stubNetwork({ token: jwt({ roles: ["Mail.Send"] }) });
    await expect(connectApp()).rejects.toThrow(/Sites\.Read\.All fehlt im App-Token.*„Anwendung“/);
    expect(calls).toHaveLength(1);
  });
});

describe("checkAppAccess", () => {
  it("tests Graph and – with a certificate – a real SharePoint call", async () => {
    const { calls } = stubNetwork({ token: jwt({ roles: ["Sites.FullControl.All", "Files.ReadWrite.All"] }) });
    const report = await checkAppAccess({ ...credentials, certificate: "-----BEGIN CERTIFICATE-----" });

    expect(report.host).toBe("contoso.sharepoint.com");
    expect(report.checks.map((c) => [c.id, c.state])).toEqual([
      ["token", "ok"],
      ["read", "ok"],
      ["write", "ok"],
      ["sharepoint", "ok"],
      ["mail", "off"],
      ["archive", "off"],
    ]);
    expect(calls.map((c) => c.url)).toEqual([
      "/api/auth/token",
      "https://graph.microsoft.com/v1.0/sites/root?$select=id,webUrl",
      "/api/auth/token",
      "/api/sharepoint",
    ]);
    expect(calls[2].body).toMatchObject({ resource: "https://contoso.sharepoint.com" });
  });

  it("still checks the certificate when Graph denies the site access", async () => {
    const { calls } = stubNetwork({ token: jwt({ roles: ["Mail.Send", "Sites.FullControl.All"] }), sites: 403 });
    const report = await checkAppAccess({ ...credentials, certificate: "-----BEGIN CERTIFICATE-----" });

    expect(calls.map((c) => c.url)).toEqual([
      "/api/auth/token",
      "https://graph.microsoft.com/v1.0/sites/root?$select=id,webUrl",
      "/api/auth/token",
    ]);
    expect(calls[2].body).toMatchObject({ resource: "00000003-0000-0ff1-ce00-000000000000", certificate: "-----BEGIN CERTIFICATE-----" });
    expect(report.checks.find((c) => c.id === "sharepoint")).toMatchObject({ state: "ok", hint: "Zertifikat gültig, Sites.FullControl.All erteilt" });
  });

  it("skips SharePoint without a certificate", async () => {
    const { calls } = stubNetwork();
    const report = await checkAppAccess(credentials);
    expect(report.checks.find((c) => c.id === "sharepoint")?.state).toBe("off");
    expect(calls).toHaveLength(2);
  });
});
