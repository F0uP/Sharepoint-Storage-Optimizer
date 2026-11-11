import {
  BrowserCacheLocation,
  InteractionRequiredAuthError,
  PublicClientApplication,
} from "@azure/msal-browser";

export interface AuthConfig {
  azureClientId: string;
  azureTenantId: string;
}

let config: AuthConfig = { azureClientId: "", azureTenantId: "" };
let instance: PublicClientApplication | null = null;

/** Applies the runtime configuration served by `/api/config`. */
export function configureMsal(next: AuthConfig) {
  config = next;
  instance = null;
}

export async function loadAuthConfig(): Promise<AuthConfig> {
  try {
    const res = await fetch("/api/config", { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as AuthConfig;
  } catch {
    return { azureClientId: "", azureTenantId: "" };
  }
}

export function isMsalConfigured(): boolean {
  return config.azureClientId.length > 0;
}

/** Delegated Microsoft Graph permissions – none of them require admin consent. */
export const GRAPH_SCOPES = ["User.Read", "Sites.Read.All", "Files.ReadWrite.All"];

/** SharePoint REST scope – only needed for version cleanup and emptying the recycle bin. */
export function sharePointScopes(siteUrl: string): string[] {
  const { origin } = new URL(siteUrl);
  return [`${origin}/AllSites.Manage`];
}

export function getMsal(): PublicClientApplication {
  if (!isMsalConfigured()) throw new Error("AZURE_CLIENT_ID ist nicht gesetzt.");
  instance ??= new PublicClientApplication({
    auth: {
      clientId: config.azureClientId,
      authority: `https://login.microsoftonline.com/${config.azureTenantId || "organizations"}`,
      redirectUri: `${window.location.origin}/auth/redirect`,
      postLogoutRedirectUri: window.location.origin,
    },
    cache: { cacheLocation: BrowserCacheLocation.LocalStorage },
  });
  return instance;
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

export async function getAccessToken(scopes: string[]): Promise<string> {
  const msal = getMsal();
  await msal.initialize();
  const account = msal.getActiveAccount() ?? msal.getAllAccounts()[0];
  if (!account) throw new Error("Nicht angemeldet.");
  try {
    const result = await msal.acquireTokenSilent({ scopes, account });
    return result.accessToken;
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError) {
      const result = await msal.acquireTokenPopup({ scopes, account });
      return result.accessToken;
    }
    throw error;
  }
}
