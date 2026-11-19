import { create } from "zustand";
import { AI_PROVIDERS, isProviderId, PROVIDER_IDS, type ProviderId } from "./ai-config";
import type { AppCredentials } from "./auth";
import { desktopBridge } from "./desktop";
import { EMAIL_PATTERN, GUID_PATTERN, TENANT_PATTERN } from "./entra";
import type { AiProviderInfo } from "./types";

export { desktopBridge, GUID_PATTERN, TENANT_PATTERN };

/**
 * Everything the user configures in the app itself – no .env file required.
 * Desktop: encrypted with the OS keychain (Electron safeStorage). Browser: localStorage.
 */
export interface Settings {
  /** "" = everyone signs in with a Microsoft account, "app" = app access without sign-in */
  azureAuthMode: "app" | "";
  azureClientId: string;
  azureTenantId: string;
  /** app access: client secret (value, not the secret ID) */
  azureClientSecret: string;
  /** app access: PEM with certificate and private key – needed for SharePoint REST */
  azureCertificate: string;
  /** app access: mailbox the owner mails are sent from */
  mailSender: string;
  aiProvider: ProviderId | "";
  openaiApiKey: string;
  openaiModel: string;
  geminiApiKey: string;
  geminiModel: string;
  /* desktop only – read by the Electron main process as well */
  desktopBackground: "on" | "";
  desktopIntervalHours: string;
  desktopThreshold: string;
  desktopAutostart: "on" | "";
  ffmpegPath: string;
  /** price of additional SharePoint storage per GB and month (for cost estimates) */
  storagePricePerGb: string;
  /** a site counts as inactive after this many months without changes */
  inactiveMonths: string;
}

export const EMPTY_SETTINGS: Settings = {
  azureAuthMode: "",
  azureClientId: "",
  azureTenantId: "",
  azureClientSecret: "",
  azureCertificate: "",
  mailSender: "",
  aiProvider: "",
  openaiApiKey: "",
  openaiModel: "",
  geminiApiKey: "",
  geminiModel: "",
  desktopBackground: "",
  desktopIntervalHours: "12",
  desktopThreshold: "90",
  desktopAutostart: "",
  ffmpegPath: "",
  storagePricePerGb: "0.20",
  inactiveMonths: "12",
};

/** Optional presets of a server deployment (environment variables, e.g. in Docker). */
export interface ServerConfig {
  azureClientId: string;
  azureTenantId: string;
  aiProviders: AiProviderInfo[];
}

const EMPTY_SERVER: ServerConfig = { azureClientId: "", azureTenantId: "", aiProviders: [] };

export const STORAGE_KEY = "spo:settings";

function validPrice(value: string) {
  const n = Number(value.replace(",", "."));
  return value !== "" && Number.isFinite(n) && n >= 0 && n <= 100;
}

export function sanitizeSettings(raw: unknown): Settings {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const str = (key: keyof Settings, max = 500) => {
    const value = src[key];
    return typeof value === "string" ? value.trim().slice(0, max) : "";
  };
  const certificate = str("azureCertificate", 16_000).replace(/\r\n/g, "\n");
  const provider = str("aiProvider");
  const pick = (key: keyof Settings, allowed: string[], fallback: string) => {
    const value = str(key);
    return allowed.includes(value) ? value : fallback;
  };
  return {
    azureAuthMode: str("azureAuthMode") === "app" ? "app" : "",
    azureClientId: str("azureClientId"),
    azureTenantId: str("azureTenantId"),
    azureClientSecret: str("azureClientSecret"),
    azureCertificate: certificate.includes("-----BEGIN") ? certificate : "",
    mailSender: EMAIL_PATTERN.test(str("mailSender")) ? str("mailSender") : "",
    aiProvider: isProviderId(provider) ? provider : "",
    openaiApiKey: str("openaiApiKey"),
    openaiModel: str("openaiModel"),
    geminiApiKey: str("geminiApiKey"),
    geminiModel: str("geminiModel"),
    desktopBackground: str("desktopBackground") === "on" ? "on" : "",
    desktopIntervalHours: pick("desktopIntervalHours", ["3", "6", "12", "24"], "12"),
    desktopThreshold: pick("desktopThreshold", ["75", "80", "90", "95"], "90"),
    desktopAutostart: str("desktopAutostart") === "on" ? "on" : "",
    ffmpegPath: str("ffmpegPath"),
    storagePricePerGb: validPrice(str("storagePricePerGb")) ? str("storagePricePerGb").replace(",", ".") : "0.20",
    inactiveMonths: pick("inactiveMonths", ["6", "12", "24", "36"], "12"),
  };
}

async function readStored(): Promise<unknown> {
  const bridge = desktopBridge();
  if (bridge) return bridge.loadSettings();
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
  } catch {
    return null;
  }
}

async function writeStored(settings: Settings): Promise<void> {
  const bridge = desktopBridge();
  if (bridge) return bridge.saveSettings(settings);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

async function fetchServerConfig(): Promise<ServerConfig> {
  try {
    const res = await fetch("/api/config", { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as Partial<ServerConfig>;
    return {
      azureClientId: data.azureClientId ?? "",
      azureTenantId: data.azureTenantId ?? "",
      aiProviders: Array.isArray(data.aiProviders) ? data.aiProviders : [],
    };
  } catch {
    return EMPTY_SERVER;
  }
}

interface SettingsState {
  settings: Settings;
  server: ServerConfig;
  loaded: boolean;
}

export const useSettings = create<SettingsState>()(() => ({
  settings: EMPTY_SETTINGS,
  server: EMPTY_SERVER,
  loaded: false,
}));

export async function loadSettings(): Promise<void> {
  const [stored, server] = await Promise.all([readStored().catch(() => null), fetchServerConfig()]);
  useSettings.setState({ settings: sanitizeSettings(stored), server, loaded: true });
}

export async function saveSettings(next: Settings): Promise<Settings> {
  const clean = sanitizeSettings(next);
  await writeStored(clean);
  useSettings.setState({ settings: clean });
  return clean;
}

type Snapshot = Pick<SettingsState, "settings" | "server">;

/** The user's own app registration wins over a server preset. */
export function authConfig({ settings, server }: Snapshot): { clientId: string; tenantId: string } {
  return settings.azureClientId
    ? { clientId: settings.azureClientId, tenantId: settings.azureTenantId }
    : { clientId: server.azureClientId, tenantId: server.azureTenantId };
}

/** Credentials for the app access – null when everyone signs in with a Microsoft account. */
export function appCredentials({ settings }: Pick<SettingsState, "settings">): AppCredentials | null {
  if (settings.azureAuthMode !== "app") return null;
  return {
    clientId: settings.azureClientId,
    tenantId: settings.azureTenantId,
    clientSecret: settings.azureClientSecret,
    certificate: settings.azureCertificate,
    mailSender: settings.mailSender,
  };
}

/** Changes to these values need a reload, because the sign-in is set up once per page load. */
export function authSignature(snapshot: Snapshot): string {
  return JSON.stringify([authConfig(snapshot), appCredentials(snapshot)]);
}

export function apiKeyOf(settings: Settings, id: ProviderId): string {
  return id === "openai" ? settings.openaiApiKey : settings.geminiApiKey;
}

export function modelOf(settings: Settings, id: ProviderId): string {
  return (id === "openai" ? settings.openaiModel : settings.geminiModel) || AI_PROVIDERS[id].defaultModel;
}

/** Usable AI providers: keys from the settings first, server presets as fallback; preferred one first. */
export function aiProviders({ settings, server }: Snapshot): AiProviderInfo[] {
  const list = PROVIDER_IDS.flatMap((id): AiProviderInfo[] => {
    if (apiKeyOf(settings, id)) {
      return [{ id, label: AI_PROVIDERS[id].label, model: modelOf(settings, id), source: "local" }];
    }
    const preset = server.aiProviders.find((p) => p.id === id);
    return preset ? [{ ...preset, source: "server" }] : [];
  });
  return list.toSorted((a, b) => Number(b.id === settings.aiProvider) - Number(a.id === settings.aiProvider));
}
