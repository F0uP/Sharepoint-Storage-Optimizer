import { describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const call = (body: unknown, token: string | null = "Bearer abc") =>
  POST(
    new Request("http://localhost/api/sharepoint", {
      method: "POST",
      headers: token ? { Authorization: token } : {},
      body: JSON.stringify(body),
    }),
  );

const valid = { siteUrl: "https://contoso.sharepoint.com/sites/marketing", path: "/_api/site/RecycleBin/DeleteAll()", method: "POST" };

describe("POST /api/sharepoint", () => {
  it("requires a bearer token", async () => {
    expect((await call(valid, null)).status).toBe(401);
  });

  it.each([
    ["foreign host", { ...valid, siteUrl: "https://evil.example.com/sites/x" }],
    ["look-alike host", { ...valid, siteUrl: "https://contoso.sharepoint.com.evil.io/sites/x" }],
    ["plain http", { ...valid, siteUrl: "http://contoso.sharepoint.com/sites/x" }],
    ["non-REST path", { ...valid, path: "/sites/x/Shared Documents" }],
    ["path traversal", { ...valid, path: "/_api/../../admin" }],
  ])("rejects %s", async (_, body) => {
    vi.stubGlobal("fetch", vi.fn());
    expect((await call(body)).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("forwards the call with the user's token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await call(valid);

    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://contoso.sharepoint.com/sites/marketing/_api/site/RecycleBin/DeleteAll()");
    expect(init).toMatchObject({ method: "POST", headers: expect.objectContaining({ Authorization: "Bearer abc" }) });
  });

  it("translates SharePoint errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ "odata.error": { message: { value: "Zugriff verweigert" } } }, { status: 403 })),
    );
    const res = await call(valid);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Zugriff verweigert");
  });
});
