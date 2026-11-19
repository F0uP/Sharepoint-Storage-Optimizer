import "server-only";
import { constants, createPrivateKey, randomUUID, sign, X509Certificate, type KeyObject } from "node:crypto";

/**
 * Client-credentials flow of Microsoft Entra ID (app-only access, no signed-in user).
 * Works with a client secret or – required by SharePoint REST – a certificate (signed client assertion).
 * https://learn.microsoft.com/entra/identity-platform/certificate-credentials
 */

export class AppTokenError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly status = 401,
  ) {
    super(message);
  }
}

export interface AppTokenRequest {
  tenantId: string;
  clientId: string;
  /** "https://graph.microsoft.com" or "https://contoso.sharepoint.com" */
  resource: string;
  credential: { secret: string } | { certificate: string };
}

export interface ParsedCertificate {
  key: KeyObject;
  /** base64url SHA-256 thumbprint of the DER certificate (JWT header x5t#S256) */
  x5tS256: string;
  validTo: Date;
}

const CERT_BLOCK = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/;
const KEY_BLOCK = /-----BEGIN (RSA |ENCRYPTED )?PRIVATE KEY-----[\s\S]+?-----END (RSA |ENCRYPTED )?PRIVATE KEY-----/;

/** Reads certificate and private key from one PEM text (as generated in the settings or exported with OpenSSL). */
export function parseCertificate(pem: string): ParsedCertificate {
  const certPem = pem.match(CERT_BLOCK)?.[0];
  const keyMatch = pem.match(KEY_BLOCK);
  if (!certPem || !keyMatch) {
    throw new AppTokenError("Das Zertifikat braucht beide PEM-Blöcke: CERTIFICATE und PRIVATE KEY.", "certificate_format", 400);
  }
  if (keyMatch[1] === "ENCRYPTED ") {
    throw new AppTokenError("Der private Schlüssel ist passwortgeschützt – bitte unverschlüsselt einfügen.", "certificate_format", 400);
  }
  let cert: X509Certificate;
  let key: KeyObject;
  try {
    cert = new X509Certificate(certPem);
    key = createPrivateKey(keyMatch[0]);
  } catch {
    throw new AppTokenError("Zertifikat oder privater Schlüssel ist beschädigt.", "certificate_format", 400);
  }
  if (key.asymmetricKeyType !== "rsa") throw new AppTokenError("Entra ID akzeptiert nur RSA-Zertifikate.", "certificate_format", 400);
  if (!cert.checkPrivateKey(key)) throw new AppTokenError("Der private Schlüssel gehört nicht zu diesem Zertifikat.", "certificate_format", 400);
  const validTo = new Date(cert.validTo);
  if (validTo.getTime() < Date.now()) {
    throw new AppTokenError("Das Zertifikat ist abgelaufen – erzeuge in den Einstellungen ein neues.", "certificate_expired", 400);
  }
  return { key, x5tS256: Buffer.from(cert.fingerprint256.replaceAll(":", ""), "hex").toString("base64url"), validTo };
}

const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** Signed JWT that proves possession of the certificate (PS256, like MSAL). */
export function clientAssertion(clientId: string, tokenUrl: string, cert: ParsedCertificate, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const input = `${base64url({ alg: "PS256", typ: "JWT", "x5t#S256": cert.x5tS256 })}.${base64url({
    aud: tokenUrl,
    iss: clientId,
    sub: clientId,
    jti: randomUUID(),
    nbf: iat,
    iat,
    exp: iat + 600,
  })}`;
  const signature = sign("sha256", Buffer.from(input), {
    key: cert.key,
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
  });
  return `${input}.${signature.toString("base64url")}`;
}

/** The usual mistakes, in plain words. */
const HINTS: Record<string, string> = {
  "7000215": "Das Client-Secret ist ungültig. Kopiere in Entra den „Wert“ des Geheimnisses – nicht die „Geheimnis-ID“.",
  "7000222": "Das Client-Secret ist abgelaufen. Lege in Entra unter „Zertifikate & Geheimnisse“ ein neues an.",
  "700016": "Diese Client-ID gibt es im angegebenen Tenant nicht. Prüfe Client-ID und Tenant-ID.",
  "90002": "Der Tenant wurde nicht gefunden. Prüfe die Tenant-ID.",
  "900023": "Die Tenant-ID ist ungültig.",
  "700027":
    "Das Zertifikat ist in der App-Registrierung nicht hinterlegt. Lade die .cer-Datei in Entra unter „Zertifikate & Geheimnisse → Zertifikate“ hoch.",
  "700024": "Die Uhrzeit dieses Geräts weicht zu stark ab – bitte die Systemzeit synchronisieren.",
  "700025":
    "Die App-Registrierung ist als öffentlicher Client eingerichtet. Deaktiviere in Entra unter „Authentifizierung“ die Option „Öffentliche Clientflows zulassen“.",
  "7000112": "Die App ist in diesem Tenant deaktiviert.",
  "500011": "Diese SharePoint-Adresse gehört nicht zum angegebenen Tenant.",
};

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  error?: string;
  error_description?: string;
  error_codes?: number[];
}

function describe(data: TokenResponse): { message: string; code?: string } {
  const code = data.error_codes?.[0]?.toString() ?? data.error_description?.match(/AADSTS(\d+)/)?.[1];
  const fallback = data.error_description?.split(/\r?\n/)[0]?.replace(/^AADSTS\d+:\s*/, "") ?? data.error;
  return { code, message: (code && HINTS[code]) || fallback || "Die App konnte sich nicht bei Microsoft anmelden." };
}

export async function requestAppToken(
  { tenantId, clientId, resource, credential }: AppTokenRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<{ accessToken: string; expiresIn: number }> {
  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({ client_id: clientId, scope: `${resource}/.default`, grant_type: "client_credentials" });
  if ("certificate" in credential) {
    body.set("client_assertion_type", "urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
    body.set("client_assertion", clientAssertion(clientId, tokenUrl, parseCertificate(credential.certificate)));
  } else {
    body.set("client_secret", credential.secret);
  }

  let res: Response;
  try {
    res = await fetchImpl(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new AppTokenError("Der Microsoft-Anmeldedienst ist nicht erreichbar.", "network", 502);
  }
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || typeof data.access_token !== "string") {
    const { message, code } = describe(data);
    throw new AppTokenError(message, code, res.status >= 500 ? 502 : 401);
  }
  return { accessToken: data.access_token, expiresIn: Number(data.expires_in) || 3599 };
}
