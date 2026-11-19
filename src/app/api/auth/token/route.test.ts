import { describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const call = (body: unknown) =>
  POST(new Request("http://localhost/api/auth/token", { method: "POST", body: JSON.stringify(body) }));

const valid = {
  tenantId: "contoso.onmicrosoft.com",
  clientId: "11111111-2222-4333-8444-555555555555",
  clientSecret: "s3cret",
  resource: "https://graph.microsoft.com",
};

describe("POST /api/auth/token", () => {
  it.each([
    ["a foreign resource", { ...valid, resource: "https://evil.example.com" }],
    ["a look-alike SharePoint host", { ...valid, resource: "https://contoso.sharepoint.com.evil.io" }],
    ["a resource with a path", { ...valid, resource: "https://contoso.sharepoint.com/sites/x" }],
    ["the multi-tenant authority", { ...valid, tenantId: "common" }],
    ["an invalid client ID", { ...valid, clientId: "my-app" }],
    ["missing credentials", { ...valid, clientSecret: undefined }],
  ])("rejects %s without calling Entra ID", async (_, body) => {
    vi.stubGlobal("fetch", vi.fn());
    expect((await call(body)).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns the token and forbids caching", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ access_token: "token", expires_in: 3599 })));
    const res = await call({ ...valid, resource: "https://contoso.sharepoint.com", clientSecret: "s3cret" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ accessToken: "token", expiresIn: 3599 });
  });

  it("passes on explained errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ error: "invalid_client", error_codes: [7000222] }, { status: 401 })),
    );
    const res = await call(valid);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "7000222", error: expect.stringMatching(/abgelaufen/) });
  });
});
