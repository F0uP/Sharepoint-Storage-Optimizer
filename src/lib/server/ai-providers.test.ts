import { describe, expect, it, vi } from "vitest";
import { analyze, describeVerifyError, geminiSchema, ProviderError, providerError, resolveCredentials, serverProviders } from "./ai-providers";
import { buildPrompt } from "./analyze-request";

describe("serverProviders", () => {
  it("lists only providers with an API key", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "g-key");
    vi.stubEnv("GOOGLE_API_KEY", "");
    expect(serverProviders().map((p) => p.id)).toEqual(["gemini"]);
  });

  it("puts the preferred provider (AI_PROVIDER) first", () => {
    vi.stubEnv("OPENAI_API_KEY", "o-key");
    vi.stubEnv("GEMINI_API_KEY", "g-key");
    vi.stubEnv("AI_PROVIDER", "gemini");
    expect(serverProviders().map((p) => p.id)).toEqual(["gemini", "openai"]);
    vi.stubEnv("AI_PROVIDER", "");
    expect(serverProviders()[0].id).toBe("openai");
  });

  it("rejects analysis with an unconfigured provider", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(analyze("openai", "x")).rejects.toBeInstanceOf(ProviderError);
    await expect(analyze("openai", "x")).rejects.toMatchObject({ status: 503 });
  });
});

describe("resolveCredentials", () => {
  it("prefers the key from the settings together with its model", () => {
    vi.stubEnv("OPENAI_API_KEY", "server-key");
    vi.stubEnv("OPENAI_MODEL", "server-model");
    expect(resolveCredentials("openai", { apiKey: "ui-key", model: "ui-model" })).toEqual({ apiKey: "ui-key", model: "ui-model" });
    expect(resolveCredentials("openai", { apiKey: "ui-key" })).toEqual({ apiKey: "ui-key", model: "gpt-5.4-mini" });
  });

  it("falls back to the server key and ignores a client model for it", () => {
    vi.stubEnv("GEMINI_API_KEY", "server-key");
    vi.stubEnv("GEMINI_MODEL", "");
    expect(resolveCredentials("gemini", { model: "expensive-model" })).toEqual({ apiKey: "server-key", model: "gemini-3.8-flash" });
  });

  it("returns null without any key", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GOOGLE_API_KEY", "");
    expect(resolveCredentials("gemini")).toBeNull();
  });
});

describe("describeVerifyError", () => {
  it("explains invalid keys and unknown models", () => {
    expect(describeVerifyError("openai", "m", Object.assign(new Error("Incorrect API key"), { status: 401 }))).toMatchObject({
      status: 401,
      message: expect.stringContaining("API-Schlüssel ungültig"),
    });
    expect(describeVerifyError("gemini", "gemini-x", { status: 400, message: "API key not valid" } as unknown)).toMatchObject({ status: 401 });
    expect(describeVerifyError("gemini", "gemini-x", Object.assign(new Error("not found"), { status: 404 }))).toMatchObject({
      status: 404,
      message: expect.stringContaining("gemini-x"),
    });
  });
});

describe("providerError", () => {
  /** like the Gemini SDK's ApiError: HTTP status plus the JSON error body as message */
  const geminiError = (status: number, error: object) => Object.assign(new Error(JSON.stringify({ error })), { status });

  it("marks an overloaded Gemini model as retryable and hides the raw JSON", () => {
    const error = providerError(
      "gemini",
      geminiError(503, { code: 503, message: "This model is currently experiencing high demand.", status: "UNAVAILABLE" }),
    );
    expect(error).toMatchObject({ status: 503, retryAfter: 0, message: "Google Gemini ist gerade überlastet." });
  });

  it("takes the wait time from Gemini's RetryInfo", () => {
    const error = providerError(
      "gemini",
      geminiError(429, {
        code: 429,
        message: "You exceeded your current quota.",
        status: "RESOURCE_EXHAUSTED",
        details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure" }, { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "36.4s" }],
      }),
    );
    expect(error).toMatchObject({ status: 429, retryAfter: 37 });
  });

  it("does not retry errors that waiting cannot fix", () => {
    const bad = providerError("gemini", geminiError(400, { code: 400, message: "Invalid JSON schema.", status: "INVALID_ARGUMENT" }));
    expect(bad).toMatchObject({ status: 400, retryAfter: undefined, message: "Google Gemini: Invalid JSON schema." });
    const quota = providerError("openai", Object.assign(new Error("You exceeded your quota"), { status: 429, code: "insufficient_quota" }));
    expect(quota).toMatchObject({ status: 429, retryAfter: undefined, message: expect.stringContaining("Kontingent aufgebraucht") });
  });

  it("retries network errors without an HTTP status", () => {
    expect(providerError("openai", new Error("fetch failed"))).toMatchObject({ status: 502, retryAfter: 0, message: "OpenAI ist nicht erreichbar (fetch failed)." });
  });
});

describe("geminiSchema", () => {
  it("is a plain JSON schema without the unsupported $schema keyword", () => {
    const schema = geminiSchema();
    expect(schema).not.toHaveProperty("$schema");
    expect(schema).toMatchObject({ type: "object", required: expect.arrayContaining(["summary", "tips", "recommendations"]) });
  });
});

describe("buildPrompt", () => {
  it("renders one compact line per candidate", () => {
    const prompt = buildPrompt({
      siteName: "Marketing",
      stats: { totalFiles: 2, totalBytes: 3 * 1024 ** 3, byCategory: [{ category: "video", count: 1, bytes: 1024 ** 3 }] },
      files: [
        { i: 0, p: "Lib/a.mp4", s: 512 * 1024 ** 2, m: "2020-01-01", c: "video", d: true },
        { i: 1, p: "Lib/b.docx", s: 1024 ** 2, m: "2024-01-01", c: "document", v: 10 * 1024 ** 2 },
      ],
    });
    expect(prompt).toContain("Site: Marketing");
    expect(prompt).toContain("0|512.0|2020-01-01|video||dup|Lib/a.mp4");
    expect(prompt).toContain("1|1.0|2024-01-01|document|10.0||Lib/b.docx");
  });
});
