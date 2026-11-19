import { createHash, createPublicKey, constants, generateKeyPairSync, verify, X509Certificate } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { generateCertificate } from "@/lib/certificate";
import { AppTokenError, clientAssertion, parseCertificate, requestAppToken } from "./app-token";

const CLIENT = "11111111-2222-4333-8444-555555555555";
const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

let pem: string;
beforeAll(async () => {
  pem = await generateCertificate("Test App", 1);
});

describe("parseCertificate", () => {
  it("reads a generated certificate and computes the SHA-256 thumbprint", () => {
    const cert = parseCertificate(pem);
    const der = new X509Certificate(pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)![0]).raw;
    expect(cert.x5tS256).toBe(createHash("sha256").update(der).digest("base64url"));
    expect(cert.validTo.getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects incomplete, encrypted and mismatched PEM", () => {
    const certOnly = pem.replace(/-----BEGIN PRIVATE KEY-----[\s\S]+$/, "");
    expect(() => parseCertificate(certOnly)).toThrow(/PRIVATE KEY/);
    expect(() => parseCertificate(pem.replaceAll("PRIVATE KEY", "ENCRYPTED PRIVATE KEY"))).toThrow(/passwortgeschützt/);

    const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const mismatched = pem.replace(/-----BEGIN PRIVATE KEY-----[\s\S]+$/, other);
    expect(() => parseCertificate(mismatched)).toThrow(/gehört nicht/);
  });
});

describe("clientAssertion", () => {
  it("is a PS256 JWT for the token endpoint, signed with the certificate key", () => {
    const cert = parseCertificate(pem);
    const url = "https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/token";
    const jwt = clientAssertion(CLIENT, url, cert, Date.UTC(2026, 10, 19));
    const [header, payload, signature] = jwt.split(".");

    expect(decode(header)).toEqual({ alg: "PS256", typ: "JWT", "x5t#S256": cert.x5tS256 });
    expect(decode(payload)).toMatchObject({ aud: url, iss: CLIENT, sub: CLIENT, nbf: 1795046400, exp: 1795047000 });
    const valid = verify(
      "sha256",
      Buffer.from(`${header}.${payload}`),
      { key: createPublicKey(cert.key), padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST },
      Buffer.from(signature, "base64url"),
    );
    expect(valid).toBe(true);
  });
});

describe("requestAppToken", () => {
  const ok = () => vi.fn().mockResolvedValue(Response.json({ access_token: "token", expires_in: 3599 }));

  it("uses the client secret for Graph", async () => {
    const fetchMock = ok();
    const token = await requestAppToken(
      { tenantId: "contoso.onmicrosoft.com", clientId: CLIENT, resource: "https://graph.microsoft.com", credential: { secret: "s3cret" } },
      fetchMock,
    );
    expect(token).toEqual({ accessToken: "token", expiresIn: 3599 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/token");
    const body = new URLSearchParams(init.body as URLSearchParams);
    expect(Object.fromEntries(body)).toEqual({
      client_id: CLIENT,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
      client_secret: "s3cret",
    });
  });

  it("signs a client assertion with a certificate", async () => {
    const fetchMock = ok();
    await requestAppToken(
      { tenantId: "contoso.onmicrosoft.com", clientId: CLIENT, resource: "https://contoso.sharepoint.com", credential: { certificate: pem } },
      fetchMock,
    );
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body as URLSearchParams);
    expect(body.get("scope")).toBe("https://contoso.sharepoint.com/.default");
    expect(body.get("client_secret")).toBeNull();
    expect(body.get("client_assertion_type")).toBe("urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
    expect(body.get("client_assertion")?.split(".")).toHaveLength(3);
  });

  it.each([
    [7000215, /Wert.*nicht die „Geheimnis-ID“/],
    [700016, /Client-ID und Tenant-ID/],
    [700027, /\.cer-Datei/],
  ])("explains AADSTS%s in plain words", async (code, message) => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ error: "invalid_client", error_description: `AADSTS${code}: Something went wrong.\r\nTrace ID: x`, error_codes: [code] }, { status: 401 }),
    );
    const error = await requestAppToken(
      { tenantId: "contoso.onmicrosoft.com", clientId: CLIENT, resource: "https://graph.microsoft.com", credential: { secret: "x" } },
      fetchMock,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppTokenError);
    expect((error as AppTokenError).message).toMatch(message);
    expect((error as AppTokenError).code).toBe(String(code));
  });

  it("falls back to the first line of an unknown error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ error: "invalid_request", error_description: "AADSTS123: Etwas ist schiefgelaufen.\nTrace ID: x" }, { status: 400 }),
    );
    await expect(
      requestAppToken(
        { tenantId: "contoso.onmicrosoft.com", clientId: CLIENT, resource: "https://graph.microsoft.com", credential: { secret: "x" } },
        fetchMock,
      ),
    ).rejects.toThrow("Etwas ist schiefgelaufen.");
  });
});
