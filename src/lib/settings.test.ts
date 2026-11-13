// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopBridge } from "./desktop";
import {
  aiProviders,
  authConfig,
  EMPTY_SETTINGS,
  loadSettings,
  sanitizeSettings,
  saveSettings,
  STORAGE_KEY,
  useSettings,
  type ServerConfig,
} from "./settings";

const noServer: ServerConfig = { azureClientId: "", azureTenantId: "", aiProviders: [] };

afterEach(() => {
  localStorage.clear();
  delete window.desktop;
});

describe("sanitizeSettings", () => {
  it("falls back to safe values for the desktop options", () => {
    expect(sanitizeSettings({ desktopIntervalHours: "1", desktopThreshold: "95", desktopBackground: "yes" })).toMatchObject({
      desktopIntervalHours: "12",
      desktopThreshold: "95",
      desktopBackground: "",
    });
  });

  it("keeps known string fields, trims them and drops everything else", () => {
    expect(sanitizeSettings({ azureClientId: "  abc ", aiProvider: "claude", openaiApiKey: 42, extra: "x" })).toEqual({
      ...EMPTY_SETTINGS,
      azureClientId: "abc",
    });
    expect(sanitizeSettings(null)).toEqual(EMPTY_SETTINGS);
  });
});

describe("authConfig", () => {
  it("prefers the app registration from the settings over a server preset", () => {
    const server = { ...noServer, azureClientId: "server-id", azureTenantId: "server-tenant" };
    expect(authConfig({ settings: EMPTY_SETTINGS, server })).toEqual({ clientId: "server-id", tenantId: "server-tenant" });
    expect(authConfig({ settings: { ...EMPTY_SETTINGS, azureClientId: "own-id" }, server })).toEqual({ clientId: "own-id", tenantId: "" });
  });
});

describe("aiProviders", () => {
  it("combines local keys with server presets and puts the preferred provider first", () => {
    const server = { ...noServer, aiProviders: [{ id: "openai" as const, label: "OpenAI", model: "server-model" }] };
    const settings = { ...EMPTY_SETTINGS, geminiApiKey: "AIza", aiProvider: "gemini" as const };
    expect(aiProviders({ settings, server })).toEqual([
      { id: "gemini", label: "Google Gemini", model: "gemini-3.8-flash", source: "local" },
      { id: "openai", label: "OpenAI", model: "server-model", source: "server" },
    ]);
  });

  it("uses the model from the settings for a local key", () => {
    const settings = { ...EMPTY_SETTINGS, openaiApiKey: "sk", openaiModel: "gpt-6" };
    expect(aiProviders({ settings, server: noServer })[0]).toMatchObject({ id: "openai", model: "gpt-6", source: "local" });
  });

  it("is empty without keys", () => {
    expect(aiProviders({ settings: EMPTY_SETTINGS, server: noServer })).toEqual([]);
  });
});

describe("persistence", () => {
  it("stores settings in localStorage in the browser", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(noServer)));
    await saveSettings({ ...EMPTY_SETTINGS, openaiApiKey: " sk-1 " });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toMatchObject({ openaiApiKey: "sk-1" });

    useSettings.setState({ settings: EMPTY_SETTINGS, loaded: false });
    await loadSettings();
    expect(useSettings.getState()).toMatchObject({ loaded: true, settings: { openaiApiKey: "sk-1" } });
  });

  it("uses the encrypted desktop store when running in the desktop app", async () => {
    const stored = { ...EMPTY_SETTINGS, geminiApiKey: "AIza-desktop" };
    const bridge = { platform: "win32", loadSettings: vi.fn().mockResolvedValue(stored), saveSettings: vi.fn().mockResolvedValue(undefined) };
    window.desktop = bridge as unknown as DesktopBridge;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...noServer, azureClientId: "preset" })));

    await loadSettings();
    expect(useSettings.getState().settings.geminiApiKey).toBe("AIza-desktop");
    expect(useSettings.getState().server.azureClientId).toBe("preset");

    await saveSettings({ ...stored, geminiModel: "gemini-pro" });
    expect(bridge.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ geminiModel: "gemini-pro" }));
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("falls back to defaults when the server config is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await loadSettings();
    expect(useSettings.getState().server).toEqual(noServer);
  });
});
