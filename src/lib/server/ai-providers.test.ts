import { describe, expect, it, vi } from "vitest";
import { analyze, availableProviders, geminiSchema, ProviderError } from "./ai-providers";
import { buildPrompt } from "./analyze-request";

describe("availableProviders", () => {
  it("lists only providers with an API key", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "g-key");
    vi.stubEnv("GOOGLE_API_KEY", "");
    expect(availableProviders().map((p) => p.id)).toEqual(["gemini"]);
  });

  it("puts the preferred provider (AI_PROVIDER) first", () => {
    vi.stubEnv("OPENAI_API_KEY", "o-key");
    vi.stubEnv("GEMINI_API_KEY", "g-key");
    vi.stubEnv("AI_PROVIDER", "gemini");
    expect(availableProviders().map((p) => p.id)).toEqual(["gemini", "openai"]);
    vi.stubEnv("AI_PROVIDER", "");
    expect(availableProviders()[0].id).toBe("openai");
  });

  it("rejects analysis with an unconfigured provider", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(analyze("openai", "x")).rejects.toBeInstanceOf(ProviderError);
    await expect(analyze("openai", "x")).rejects.toMatchObject({ status: 503 });
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
