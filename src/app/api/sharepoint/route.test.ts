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

  const merge = {
    siteUrl: "https://contoso.sharepoint.com/sites/marketing",
    path: "/_api/web/lists(guid'0f3c2a1b-1234-4cde-8f00-123456789abc')",
    method: "MERGE",
    body: { EnableVersioning: true, MajorVersionLimit: 100 },
  };

  it("sets version limits with MERGE", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await call(merge)).status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://contoso.sharepoint.com/sites/marketing/_api/web/lists(guid'0f3c2a1b-1234-4cde-8f00-123456789abc')");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "X-HTTP-Method": "MERGE", "IF-MATCH": "*" });
    expect(JSON.parse(init.body)).toEqual({ EnableVersioning: true, MajorVersionLimit: 100 });
  });

  it.each([
    ["other targets", { ...merge, path: "/_api/web" }],
    ["other fields", { ...merge, body: { Title: "gehackt" } }],
    ["absurd limits", { ...merge, body: { MajorVersionLimit: 0 } }],
    ["bodies on other methods", { ...valid, body: { x: 1 } }],
  ])("rejects MERGE with %s", async (_, body) => {
    vi.stubGlobal("fetch", vi.fn());
    expect((await call(body)).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("allows OData filters with dots in the query string", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ value: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await call({ ...valid, method: "GET", path: "/_api/web/RecycleBin?$filter=LeafName%20eq%20'a..b.docx'" });
    expect(res.status).toBe(200);
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
