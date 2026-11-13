import { app, safeStorage } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Settings incl. API keys, encrypted with the OS keychain (DPAPI on Windows, Keychain on macOS).
 * The renderer never sees the file – only these two functions via IPC.
 */
type Stored = Record<string, string>;

interface Envelope {
  version: 1;
  encrypted: boolean;
  data: string;
}

const settingsFile = () => path.join(app.getPath("userData"), "settings.json");

export function sanitize(value: unknown): Stored {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Ungültige Einstellungen.");
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] =>
      /^[A-Za-z]{1,40}$/.test(entry[0]) && typeof entry[1] === "string" && entry[1].length <= 1000,
  );
  return Object.fromEntries(entries.slice(0, 40));
}

export async function readSettings(): Promise<Stored> {
  let raw: string;
  try {
    raw = await readFile(settingsFile(), "utf8");
  } catch {
    return {};
  }
  try {
    const envelope = JSON.parse(raw) as Envelope;
    const json = envelope.encrypted ? safeStorage.decryptString(Buffer.from(envelope.data, "base64")) : envelope.data;
    return sanitize(JSON.parse(json));
  } catch (error) {
    console.error("Einstellungen konnten nicht gelesen werden:", error);
    return {};
  }
}

export async function writeSettings(value: unknown): Promise<void> {
  const json = JSON.stringify(sanitize(value));
  const encrypted = safeStorage.isEncryptionAvailable();
  const envelope: Envelope = {
    version: 1,
    encrypted,
    data: encrypted ? safeStorage.encryptString(json).toString("base64") : json,
  };
  const target = settingsFile();
  await mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.tmp`;
  await writeFile(temp, JSON.stringify(envelope), { mode: 0o600 });
  await rename(temp, target);
}
