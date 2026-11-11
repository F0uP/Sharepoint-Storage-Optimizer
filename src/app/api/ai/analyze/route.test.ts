import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/server/ai-providers", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/server/ai-providers")>();
  return { ...original, analyze: vi.fn() };
});

const { GET, POST } = await import("./route");
const { analyze } = await import("@/lib/server/ai-providers");

const validBody = {
  siteName: "Test",
  stats: { totalFiles: 1, totalBytes: 10, byCategory: [] },
  files: [{ i: 0, p: "Lib/a.zip", s: 10, m: "2020-01-01", c: "archive" }],
};
const post = (body: unknown) =>
  POST(new Request("http://localhost/api/ai/analyze", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("GOOGLE_API_KEY", "");
  vi.stubEnv("AI_PROVIDER", "");
});

describe("GET /api/ai/analyze", () => {
  it("reports configured providers without exposing keys", async () => {
    vi.stubEnv("GEMINI_API_KEY", "secret-key");
    const data = await (await GET()).json();
    expect(data.configured).toBe(true);
    expect(data.providers).toEqual([{ id: "gemini", label: "Google Gemini", model: expect.any(String) }]);
    expect(JSON.stringify(data)).not.toContain("secret-key");
  });
});

describe("POST /api/ai/analyze", () => {
  it("returns 503 when no provider is configured", async () => {
    const res = await post(validBody);
    expect(res.status).toBe(503);
  });

  it("validates the request body", async () => {
    vi.stubEnv("OPENAI_API_KEY", "k");
    expect((await post({ nope: true })).status).toBe(400);
    expect((await post({ ...validBody, provider: "other" })).status).toBe(400);
  });

  it("uses the requested provider and returns its analysis", async () => {
    vi.stubEnv("OPENAI_API_KEY", "k");
    vi.stubEnv("GEMINI_API_KEY", "k");
    vi.mocked(analyze).mockResolvedValue({
      id: "gemini",
      label: "Google Gemini",
      model: "g",
      summary: "s",
      tips: [],
      recommendations: [{ i: 0, action: "delete", priority: "high", reason: "r" }],
    });

    const res = await post({ ...validBody, provider: "gemini" });

    expect(res.status).toBe(200);
    expect(vi.mocked(analyze).mock.calls[0][0]).toBe("gemini");
    expect(vi.mocked(analyze).mock.calls[0][1]).toContain("0|0.0|2020-01-01|archive|||Lib/a.zip");
    expect((await res.json()).recommendations).toHaveLength(1);
  });

  it("passes provider errors through with their status", async () => {
    vi.stubEnv("OPENAI_API_KEY", "k");
    const { ProviderError } = await import("@/lib/server/ai-providers");
    vi.mocked(analyze).mockRejectedValue(new ProviderError("OpenAI: rate limit", 429));
    const res = await post(validBody);
    expect(res.status).toBe(429);
    expect((await res.json()).error).toContain("rate limit");
  });
});
