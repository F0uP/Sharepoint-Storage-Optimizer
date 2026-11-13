import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/ai-providers", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/server/ai-providers")>();
  return { ...original, verifyProvider: vi.fn() };
});

const { POST } = await import("./route");
const { verifyProvider, ProviderError } = await import("@/lib/server/ai-providers");

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(new Request("http://localhost/api/ai/verify", { method: "POST", body: JSON.stringify(body), headers }));

describe("POST /api/ai/verify", () => {
  it("checks the key from the header", async () => {
    vi.mocked(verifyProvider).mockResolvedValue({ id: "gemini", label: "Google Gemini", model: "gemini-x" });
    const res = await post({ provider: "gemini", model: "gemini-x" }, { "x-ai-api-key": " AIza-key " });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, model: "gemini-x" });
    expect(vi.mocked(verifyProvider)).toHaveBeenCalledWith("gemini", { apiKey: "AIza-key", model: "gemini-x" });
  });

  it("passes the provider's verdict through", async () => {
    vi.mocked(verifyProvider).mockRejectedValue(new ProviderError("OpenAI: API-Schlüssel ungültig oder ohne Berechtigung.", 401));
    const res = await post({ provider: "openai" }, { "x-ai-api-key": "sk-wrong" });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toContain("ungültig");
  });

  it("rejects unknown providers", async () => {
    expect((await post({ provider: "other" })).status).toBe(400);
  });
});
