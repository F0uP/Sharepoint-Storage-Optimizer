/**
 * Self-signed certificates for the app access: SharePoint REST only accepts app-only tokens that were
 * requested with a certificate. The key pair is generated locally with WebCrypto and never leaves the device
 * except for signing token requests; only the public .cer file is uploaded to Entra ID.
 */

export interface CertificateInfo {
  subject: string;
  /** SHA-1 thumbprint as shown in Entra ID under "Certificates & secrets" */
  thumbprint: string;
  validTo: string;
  expired: boolean;
  certPem: string;
  hasKey: boolean;
}

const CERT_BLOCK = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/;

// the library needs a Reflect polyfill – both are only loaded when a certificate is actually used
async function x509() {
  await import("reflect-metadata");
  return import("@peculiar/x509");
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** RSA 2048 / SHA-256 certificate plus private key as one PEM text. */
export async function generateCertificate(name = "SharePoint Storage Optimizer", years = 2): Promise<string> {
  const lib = await x509();
  const algorithm = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256", publicExponent: new Uint8Array([1, 0, 1]), modulusLength: 2048 };
  const keys = await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"]);
  const serial = crypto.getRandomValues(new Uint8Array(16));
  serial[0] &= 0x7f; // serial numbers must be positive
  const notAfter = new Date();
  notAfter.setFullYear(notAfter.getFullYear() + years);
  const cert = await lib.X509CertificateGenerator.createSelfSigned({
    serialNumber: hex(serial),
    name: `CN=${name}`,
    notBefore: new Date(Date.now() - 10 * 60_000),
    notAfter,
    keys,
    signingAlgorithm: algorithm,
    extensions: [
      new lib.BasicConstraintsExtension(false, undefined, true),
      new lib.KeyUsagesExtension(lib.KeyUsageFlags.digitalSignature, true),
    ],
  });
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", keys.privateKey);
  return `${cert.toString("pem")}\n${lib.PemConverter.encode(pkcs8, "PRIVATE KEY")}\n`;
}

/** Subject, thumbprint and expiry of a stored PEM – null if it contains no readable certificate. */
export async function describeCertificate(pem: string): Promise<CertificateInfo | null> {
  const certPem = pem.match(CERT_BLOCK)?.[0];
  if (!certPem) return null;
  try {
    const lib = await x509();
    const cert = new lib.X509Certificate(certPem);
    const thumbprint = hex(new Uint8Array(await cert.getThumbprint("SHA-1"))).toUpperCase();
    return {
      subject: cert.subject,
      thumbprint,
      validTo: cert.notAfter.toISOString(),
      expired: cert.notAfter.getTime() < Date.now(),
      certPem,
      hasKey: /PRIVATE KEY-----/.test(pem),
    };
  } catch {
    return null;
  }
}

/** Saves the public part as .cer – the file that is uploaded in Entra ID. */
export function downloadCertificate(certPem: string, filename = "sharepoint-storage-optimizer.cer") {
  const url = URL.createObjectURL(new Blob([`${certPem}\n`], { type: "application/x-x509-ca-cert" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}
