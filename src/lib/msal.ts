import {
  BrowserCacheLocation,
  InteractionRequiredAuthError,
  PublicClientApplication,
} from "@azure/msal-browser";

export interface AuthConfig {
  clientId: string;
  tenantId: string;
}

let config: AuthConfig = { clientId: "", tenantId: "" };
let instance: PublicClientApplication | null = null;

/** Applies the app registration from the settings (or a server preset). */
export function configureMsal(next: AuthConfig) {
  config = next;
  instance = null;
}

export function isMsalConfigured(): boolean {
  return config.clientId.length > 0;
}

/**
 * Delegated Microsoft Graph permissions. None of them needs admin consent by default – unless the tenant
 * blocks user consent, then an admin consents once (see adminConsentUrl).
 */
export const GRAPH_SCOPES = ["User.Read", "Sites.Read.All", "Files.ReadWrite.All"];

/** Only requested when owners are notified (incremental consent). */
export const MAIL_SCOPES = ["Mail.Send"];
/** Teams approvals (Graph beta) – requested on first use. */
export const APPROVAL_SCOPES = ["ApprovalSolution.ReadWrite"];
/** Microsoft 365 Archive (Graph beta) – SharePoint administrators only. */
export const ARCHIVE_SCOPES = ["Sites.Archive.All"];

/** SharePoint REST scope – only needed for version cleanup and emptying the recycle bin. */
export function sharePointScopes(siteUrl: string): string[] {
  const { origin } = new URL(siteUrl);
  return [`${origin}/AllSites.Manage`];
}

export function getMsal(): PublicClientApplication {
  if (!isMsalConfigured()) throw new Error("Die Microsoft-365-Verbindung ist noch nicht eingerichtet (Einstellungen).");
  instance ??= new PublicClientApplication({
    auth: {
      clientId: config.clientId,
      authority: `https://login.microsoftonline.com/${config.tenantId || "organizations"}`,
      redirectUri: redirectUri(),
      postLogoutRedirectUri: window.location.origin,
    },
    cache: { cacheLocation: BrowserCacheLocation.LocalStorage },
  });
  return instance;
}

/** Redirect URI to register in Entra ID (platform "Single-page application"). */
export function redirectUri(): string {
  return `${window.location.origin}/auth/redirect`;
}

/**
 * Link for an administrator: consents once for the whole organization to all permissions configured in the
 * app registration. Afterwards everyone signs in without admin rights.
 */
export function adminConsentUrl({ clientId, tenantId }: AuthConfig = config): string {
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri() });
  return `https://login.microsoftonline.com/${encodeURIComponent(tenantId || "organizations")}/adminconsent?${params}`;
}

export function currentAuthConfig(): AuthConfig {
  return config;
}

export async function signIn() {
  const msal = getMsal();
  await msal.initialize();
  const result = await msal.loginPopup({ scopes: GRAPH_SCOPES, prompt: "select_account" });
  msal.setActiveAccount(result.account);
  return result.account;
}

export async function signOut() {
  const msal = getMsal();
  await msal.initialize();
  const account = msal.getActiveAccount() ?? msal.getAllAccounts()[0];
  await msal.logoutPopup({ account, mainWindowRedirectUri: window.location.origin });
}

/** `interactive: false` – background checks must never open a sign-in window; they fail instead. */
export async function getAccessToken(scopes: string[], { interactive = true }: { interactive?: boolean } = {}): Promise<string> {
  const msal = getMsal();
  await msal.initialize();
  const account = msal.getActiveAccount() ?? msal.getAllAccounts()[0];
  if (!account) throw new Error("Nicht angemeldet.");
  try {
    const result = await msal.acquireTokenSilent({ scopes, account });
    return result.accessToken;
  } catch (error) {
    if (interactive && error instanceof InteractionRequiredAuthError) {
      const result = await msal.acquireTokenPopup({ scopes, account });
      return result.accessToken;
    }
    throw error;
  }
}
