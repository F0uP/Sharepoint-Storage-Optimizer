import {
  assessAppAccess,
  GRAPH_RESOURCE,
  GUID_PATTERN,
  readProblem,
  SHAREPOINT_APP_ID,
  TENANT_PATTERN,
  tokenClaims,
  type AccessCheck,
  type AccessInput,
} from "./entra";
import { getAccessToken, getMsal, isMsalConfigured, signOut } from "./msal";

/**
 * Two ways to reach Microsoft 365:
 * - "user": everyone signs in with their own account (delegated permissions, MSAL in the browser)
 * - "app":  no sign-in – the app registration's own application permissions (client secret or certificate)
 */
export type AuthKind = "user" | "app";

export interface AppCredentials {
  clientId: string;
  tenantId: string;
  clientSecret: string;
  /** PEM with certificate and private key – SharePoint REST only accepts certificate-based app tokens */
  certificate: string;
  /** mailbox the app sends owner mails from (app-only tokens have no own mailbox) */
  mailSender: string;
}

export const CERTIFICATE_REQUIRED =
  "Diese Funktion läuft über die SharePoint-REST-API, und die akzeptiert im App-Zugriff nur Zertifikate, kein Client-Secret. " +
  "Erzeuge unter Einstellungen → Microsoft 365 ein Zertifikat – oder nutze die Benutzeranmeldung.";

export const NO_APP_PERMISSIONS =
  "Die App hat keine Anwendungsberechtigungen. In Entra unter „API-Berechtigungen“ Anwendungsberechtigungen hinzufügen " +
  "(z. B. Sites.Read.All, Files.ReadWrite.All) und einmalig „Administratorzustimmung erteilen“.";

/** SharePoint REST errors that only make sense with app access, in plain words. */
export function explainSharePointError(message: string, appAccess = kind === "app"): string {
  if (/unsupported app only token/i.test(message)) {
    return "SharePoint lehnt das App-Token ab – es muss mit einem Zertifikat angefordert werden, das in Entra hochgeladen ist.";
  }
  if (appAccess && /access denied|zugriff verweigert|HTTP 40[13]/i.test(message)) {
    return "SharePoint verweigert den Zugriff – der App fehlt die SharePoint-Anwendungsberechtigung Sites.FullControl.All.";
  }
  return message;
}

let kind: AuthKind = "user";
let app: AppCredentials | null = null;
const tokens = new Map<string, { token: string; expiresAt: number }>();
const pending = new Map<string, Promise<string>>();

const SESSION_KEY = "spo:app-session";
const REFRESH_MARGIN = 5 * 60_000;

/** Applies the access mode from the settings (null = sign-in with a Microsoft account). */
export function configureAuth(credentials: AppCredentials | null) {
  kind = credentials ? "app" : "user";
  app = credentials;
  tokens.clear();
  pending.clear();
}

export const authKind = (): AuthKind => kind;
export const isAppAuth = () => kind === "app";
export const hasCertificate = () => Boolean(app?.certificate);
export const appMailSender = () => app?.mailSender ?? "";

export function appCredentialsComplete(c: AppCredentials | null): c is AppCredentials {
  return Boolean(c && GUID_PATTERN.test(c.clientId) && TENANT_PATTERN.test(c.tenantId) && (c.clientSecret || c.certificate));
}

export function isAuthConfigured(): boolean {
  return kind === "app" ? appCredentialsComplete(app) : isMsalConfigured();
}

/** Graph scopes ("Sites.Read.All") belong to Graph, "https://contoso.sharepoint.com/AllSites.Manage" to SharePoint. */
export function resourceOf(scopes: string[]): string {
  const first = scopes[0] ?? "";
  return /^https:\/\//i.test(first) ? new URL(first).origin : GRAPH_RESOURCE;
}

/** Access token for the given delegated scopes – or, in app mode, an app-only token for their resource. */
export async function getToken(scopes: string[], options?: { interactive?: boolean }): Promise<string> {
  return kind === "app" ? appToken(resourceOf(scopes)) : getAccessToken(scopes, options);
}

/* --------------------------------------------------------------- app mode */

/** Asks the server for an app-only token (Entra ID refuses to issue them to browsers directly). */
export async function requestAppToken(credentials: AppCredentials, resource: string): Promise<{ accessToken: string; expiresIn: number }> {
  const sharePoint = resource !== GRAPH_RESOURCE;
  if (sharePoint && !credentials.certificate) throw new Error(CERTIFICATE_REQUIRED);
  // Graph accepts a secret; with only a certificate (or for SharePoint) the certificate is used
  const credential =
    sharePoint || !credentials.clientSecret ? { certificate: credentials.certificate } : { clientSecret: credentials.clientSecret };
  const res = await fetch("/api/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: credentials.clientId, tenantId: credentials.tenantId, resource, ...credential }),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { accessToken?: unknown; expiresIn?: unknown; error?: string };
  if (!res.ok || typeof data.accessToken !== "string") {
    throw new Error(data.error ?? `Die App konnte sich nicht anmelden (HTTP ${res.status}).`);
  }
  return { accessToken: data.accessToken, expiresIn: Number(data.expiresIn) || 3599 };
}

async function appToken(resource: string): Promise<string> {
  const credentials = app;
  if (!appCredentialsComplete(credentials)) {
    throw new Error("Der App-Zugriff ist noch nicht vollständig eingerichtet (Einstellungen → Microsoft 365).");
  }
  const cached = tokens.get(resource);
  if (cached && cached.expiresAt - Date.now() > REFRESH_MARGIN) return cached.token;

  let request = pending.get(resource);
  if (!request) {
    request = requestAppToken(credentials, resource)
      .then(({ accessToken, expiresIn }) => {
        // ignore results for credentials that were replaced in the meantime
        if (app === credentials) tokens.set(resource, { token: accessToken, expiresAt: Date.now() + expiresIn * 1000 });
        return accessToken;
      })
      .finally(() => pending.delete(resource));
    pending.set(resource, request);
  }
  return request;
}

export interface AppSession {
  /** SharePoint host of the tenant, e.g. contoso.sharepoint.com */
  host: string;
  /** display name of the app registration */
  app: string;
}

export function appSession(): AppSession | null {
  try {
    const value = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null") as Partial<AppSession> | null;
    return value && typeof value.host === "string" ? { host: value.host, app: String(value.app ?? "") } : null;
  } catch {
    return null;
  }
}

/** Only called with a token that carries a site permission – a denial then has another cause than a missing role. */
async function graphError(res: Response): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (res.status === 401 || res.status === 403) {
    return (
      `Microsoft Graph verweigert den Zugriff auf die Sites (HTTP ${res.status}), obwohl die Berechtigung im App-Token steht` +
      `${data.error?.message ? ` – ${data.error.message}` : ""}. Nach einer neuen Administratorzustimmung kann es einige Minuten dauern.`
    );
  }
  return data.error?.message ?? `Microsoft Graph antwortete mit HTTP ${res.status}.`;
}

async function rootSite(token: string): Promise<{ webUrl?: string } | { error: string }> {
  const res = await fetch(`${GRAPH_RESOURCE}/v1.0/sites/root?$select=id,webUrl`, { headers: { Authorization: `Bearer ${token}` } });
  return res.ok ? ((await res.json()) as { webUrl?: string }) : { error: await graphError(res) };
}

/** Connects without a user: checks token and site access once, then remembers the connection. */
export async function connectApp(): Promise<AppSession> {
  const token = await appToken(GRAPH_RESOURCE);
  const claims = tokenClaims(token);
  if (!claims.roles?.length) throw new Error(NO_APP_PERMISSIONS);
  const cannotRead = readProblem(claims.roles);
  if (cannotRead) throw new Error(cannotRead);
  const root = await rootSite(token);
  if ("error" in root) throw new Error(root.error);
  const session: AppSession = { host: root.webUrl ? new URL(root.webUrl).host : "", app: claims.app_displayname ?? "" };
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // the connection still works for this window
  }
  return session;
}

export function disconnectApp() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // nothing to forget
  }
  tokens.clear();
  pending.clear();
}

export interface AccessReport {
  app: string;
  host: string;
  checks: AccessCheck[];
}

/**
 * Tests credentials from the settings form (not yet saved): Graph token, site access and – with a
 * certificate – a real SharePoint REST call, because SharePoint decides there whether it accepts the token.
 * Without site access there is no SharePoint address; the SharePoint token alone still proves the
 * certificate and shows which SharePoint permissions are granted.
 */
export async function checkAppAccess(credentials: AppCredentials): Promise<AccessReport> {
  const { accessToken } = await requestAppToken(credentials, GRAPH_RESOURCE);
  const claims = tokenClaims(accessToken);
  const graphRoles = claims.roles ?? [];
  const root = await rootSite(accessToken);
  const webUrl = "error" in root ? undefined : root.webUrl;

  let sharePoint: AccessInput["sharePoint"] = null;
  if (credentials.certificate) {
    try {
      if (webUrl) {
        const sp = await requestAppToken(credentials, new URL(webUrl).origin);
        const res = await fetch("/api/sharepoint", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${sp.accessToken}` },
          body: JSON.stringify({ siteUrl: webUrl, path: "/_api/web?$select=Title", method: "GET" }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(explainSharePointError(data.error ?? `SharePoint antwortete mit HTTP ${res.status}.`, true));
        }
        sharePoint = { roles: tokenClaims(sp.accessToken).roles ?? [] };
      } else {
        const sp = await requestAppToken(credentials, SHAREPOINT_APP_ID);
        sharePoint = { roles: tokenClaims(sp.accessToken).roles ?? [], tested: false };
      }
    } catch (e) {
      sharePoint = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  return {
    app: claims.app_displayname ?? "",
    host: webUrl ? new URL(webUrl).host : "",
    checks: assessAppAccess({
      graphRoles,
      graphError: "error" in root ? root.error : undefined,
      sharePoint,
      mailSender: credentials.mailSender,
    }),
  };
}

/* ------------------------------------------------------------- both modes */

/** Whether background work (jobs, quota checks) can reach Microsoft 365 without user interaction. */
export async function hasLiveSession(): Promise<boolean> {
  if (kind === "app") return appCredentialsComplete(app) && appSession() !== null;
  if (!isMsalConfigured()) return false;
  const msal = getMsal();
  await msal.initialize();
  return msal.getAllAccounts().length > 0;
}

/** Name and detail line for the user menu. */
export function currentIdentity(): { name: string; detail: string } {
  if (kind === "app") {
    const session = appSession();
    return { name: "App-Zugriff", detail: session?.host || session?.app || app?.tenantId || "" };
  }
  if (!isMsalConfigured()) return { name: "Angemeldet", detail: "" };
  const account = getMsal().getActiveAccount() ?? getMsal().getAllAccounts()[0];
  return { name: account?.name ?? account?.username ?? "Angemeldet", detail: account?.username ?? "" };
}

export async function signOutCurrent() {
  if (kind === "app") return disconnectApp();
  await signOut();
}
