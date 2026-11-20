/**
 * Microsoft Entra ID helpers shared by the browser and the server:
 * identifier formats, token resources, token claims and the assessment of granted app permissions.
 */

export const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Tenant: GUID or verified domain (contoso.onmicrosoft.com) – never "common" or "organizations". */
export const TENANT_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z0-9-]+(\.[a-z0-9-]+)+)$/i;
export const SHAREPOINT_HOST = /^[a-z0-9-]+\.sharepoint(-mil)?\.(com|us|cn|de)$/i;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const GRAPH_RESOURCE = "https://graph.microsoft.com";
/** App ID of SharePoint Online – as token resource it needs no SharePoint host (used to check certificate and permissions). */
export const SHAREPOINT_APP_ID = "00000003-0000-0ff1-ce00-000000000000";

/** Resources the app may request tokens for: Microsoft Graph, SharePoint Online or the SharePoint origin of a tenant. */
export function isTokenResource(value: string): boolean {
  if (value === GRAPH_RESOURCE || value === SHAREPOINT_APP_ID) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value && SHAREPOINT_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

export interface TokenClaims {
  /** application permissions (app-only tokens) */
  roles?: string[];
  /** delegated permissions (user tokens) */
  scp?: string;
  app_displayname?: string;
  tid?: string;
}

/** Reads the payload of an access token – for diagnostics only, the signature is not checked. */
export function tokenClaims(token: string): TokenClaims {
  const part = token.split(".")[1];
  if (!part) return {};
  try {
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return claims && typeof claims === "object" ? (claims as TokenClaims) : {};
  } catch {
    return {};
  }
}

/* ------------------------------------------------------- permission check */

const READ_ROLES = ["Sites.Read.All", "Sites.ReadWrite.All", "Sites.Manage.All", "Sites.FullControl.All"];
const WRITE_ROLES = ["Files.ReadWrite.All", "Sites.ReadWrite.All", "Sites.Manage.All", "Sites.FullControl.All"];
const SHAREPOINT_ROLES = ["Sites.FullControl.All", "Sites.Manage.All"];

export type AccessState = "ok" | "missing" | "off";

export interface AccessCheck {
  id: "token" | "read" | "write" | "sharepoint" | "mail" | "archive";
  label: string;
  state: AccessState;
  hint: string;
}

export interface AccessInput {
  /** application permissions in the Graph token */
  graphRoles: string[];
  /** error of the test call against Graph (e.g. 403) */
  graphError?: string;
  /**
   * SharePoint REST: null = no certificate, otherwise the roles of the SharePoint token or the error.
   * tested = false: only the token was checked, the test call needs the SharePoint address from Graph.
   */
  sharePoint: { roles: string[]; tested?: boolean } | { error: string } | null;
  mailSender: string;
}

const hasAny = (roles: string[], wanted: string[]) => roles.some((r) => wanted.includes(r));

/**
 * Why the Graph token cannot read sites (null = it can). The roles come straight from the token Entra ID issued,
 * so a permission missing there is either delegated instead of an application permission, lacks admin consent
 * or was added to the SharePoint API instead of Microsoft Graph.
 */
export function readProblem(graphRoles: string[], sharePointRoles: string[] = []): string | null {
  if (hasAny(graphRoles, READ_ROLES)) return null;
  if (hasAny(sharePointRoles, ["Sites.Read.All", "Sites.ReadWrite.All"])) {
    return "Sites.Read.All ist nur für die SharePoint-API erteilt – die App braucht sie zusätzlich unter Microsoft Graph (Typ „Anwendung“).";
  }
  return (
    "Sites.Read.All fehlt im App-Token. In Entra unter Microsoft Graph als Typ „Anwendung“ hinzufügen – „Delegiert“ gilt nur " +
    "für die Benutzeranmeldung – und die Administratorzustimmung erteilen."
  );
}

/** Translates the granted application permissions into what works in the app. */
export function assessAppAccess({ graphRoles, graphError, sharePoint, mailSender }: AccessInput): AccessCheck[] {
  const consented = graphRoles.length > 0;
  const sharePointRoles = sharePoint && "roles" in sharePoint ? sharePoint.roles : [];
  const cannotRead = readProblem(graphRoles, sharePointRoles);
  const checks: AccessCheck[] = [
    {
      id: "token",
      label: "Anmeldung der App",
      state: consented ? "ok" : "missing",
      hint: consented
        ? `Erteilt: ${graphRoles.toSorted().join(", ")}`
        : "Die App hat keine Anwendungsberechtigungen – sie fehlen oder ein Administrator hat noch nicht zugestimmt.",
    },
    {
      id: "read",
      label: "Sites finden und scannen",
      state: !cannotRead && !graphError ? "ok" : "missing",
      hint: cannotRead ?? graphError ?? "Alle Sites des Tenants",
    },
    {
      id: "write",
      label: "Dateien löschen und ersetzen",
      state: hasAny(graphRoles, WRITE_ROLES) ? "ok" : "missing",
      hint: hasAny(graphRoles, WRITE_ROLES)
        ? "Papierkorb, endgültiges Löschen, Komprimieren"
        : "Files.ReadWrite.All fehlt im App-Token – unter Microsoft Graph als Typ „Anwendung“ hinzufügen und zustimmen.",
    },
  ];

  if (!sharePoint) {
    checks.push({
      id: "sharepoint",
      label: "Versionen, Papierkorb, Versionslimits",
      state: "off",
      hint: "SharePoint verlangt dafür ein Zertifikat – ein Client-Secret genügt nicht.",
    });
  } else if ("error" in sharePoint) {
    checks.push({ id: "sharepoint", label: "Versionen, Papierkorb, Versionslimits", state: "missing", hint: sharePoint.error });
  } else {
    const ok = hasAny(sharePoint.roles, SHAREPOINT_ROLES);
    const tested = sharePoint.tested !== false;
    checks.push({
      id: "sharepoint",
      label: "Versionen, Papierkorb, Versionslimits",
      state: ok ? "ok" : "missing",
      hint: ok
        ? tested
          ? "Zertifikat wird von SharePoint akzeptiert"
          : "Zertifikat gültig, Sites.FullControl.All erteilt"
        : tested
          ? "Anwendungsberechtigung Sites.FullControl.All (SharePoint)"
          : "Zertifikat gültig – es fehlt die Anwendungsberechtigung Sites.FullControl.All (SharePoint)",
    });
  }

  const mail = graphRoles.includes("Mail.Send");
  checks.push({
    id: "mail",
    label: "Besitzer per E-Mail fragen",
    state: mail && mailSender ? "ok" : "off",
    hint: !mail ? "Optional: Anwendungsberechtigung Mail.Send" : mailSender ? `Absender: ${mailSender}` : "Absender-Postfach fehlt",
  });
  checks.push({
    id: "archive",
    label: "Inaktive Sites archivieren",
    state: graphRoles.includes("Sites.Archive.All") ? "ok" : "off",
    hint: graphRoles.includes("Sites.Archive.All") ? "Microsoft 365 Archive" : "Optional: Anwendungsberechtigung Sites.Archive.All",
  });
  return checks;
}

/* ----------------------------------------------------------- login errors */

export type LoginProblem = "admin-consent" | "cancelled" | "other";

/**
 * Sorts a failed interactive sign-in: missing (admin) consent, a closed popup or anything else.
 * AADSTS90094/90095: the tenant only allows admins to consent, 65001/65004: consent missing or declined.
 */
export function classifyLoginError(error: unknown): LoginProblem {
  const e = (error ?? {}) as { errorCode?: unknown; subError?: unknown; errorMessage?: unknown; message?: unknown };
  const text = [e.errorCode, e.subError, e.errorMessage, e.message].filter((v) => typeof v === "string").join(" ");
  if (/AADSTS(90094|90095|65001|65004|900941)|consent_required|access_denied|admin.?(consent|approval)/i.test(text)) {
    return "admin-consent";
  }
  if (/user_cancelled/i.test(text)) return "cancelled";
  return "other";
}
