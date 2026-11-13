import { z } from "zod";

/**
 * Thin proxy for SharePoint REST calls. SharePoint Online does not send CORS headers
 * for arbitrary SPA origins, so version cleanup, version limits, restore and recycle bin calls
 * are forwarded from here. The user's own delegated token is passed through – nothing is stored.
 */

const BodySchema = z.object({
  siteUrl: z.url(),
  path: z.string().startsWith("/_api/").max(2000),
  method: z.enum(["GET", "POST", "MERGE"]),
  body: z.record(z.string(), z.unknown()).optional(),
});

const ALLOWED_HOST = /^[a-z0-9-]+\.sharepoint(-mil)?\.(com|us|cn|de)$/i;

/** Updates are only allowed for the version settings of a library. */
const MERGE_TARGET = /^\/_api\/web\/lists\(guid'[0-9a-f-]{36}'\)$/i;
const MergeBodySchema = z.strictObject({
  EnableVersioning: z.boolean().optional(),
  MajorVersionLimit: z.number().int().min(100).max(50000).optional(),
});

export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return Response.json({ error: "Kein Token." }, { status: 401 });

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Ungültige Anfrage." }, { status: 400 });

  const { siteUrl, path, method, body } = parsed.data;
  const site = new URL(siteUrl);
  const route = path.split("?")[0];
  if (site.protocol !== "https:" || !ALLOWED_HOST.test(site.hostname) || route.includes("..") || path.includes("://")) {
    return Response.json({ error: "Ziel nicht erlaubt." }, { status: 400 });
  }

  let payload: string | undefined;
  if (method === "MERGE") {
    const merge = MergeBodySchema.safeParse(body);
    if (!MERGE_TARGET.test(path) || !merge.success) return Response.json({ error: "Änderung nicht erlaubt." }, { status: 400 });
    payload = JSON.stringify(merge.data);
  } else if (body) {
    return Response.json({ error: "Ungültige Anfrage." }, { status: 400 });
  }

  const target = `${site.origin}${site.pathname.replace(/\/$/, "")}${path}`;
  const res = await fetch(target, {
    method: method === "GET" ? "GET" : "POST",
    headers: {
      Authorization: auth,
      Accept: "application/json;odata=nometadata",
      ...(method === "POST" ? { "Content-Length": "0" } : {}),
      ...(method === "MERGE"
        ? { "Content-Type": "application/json;odata=nometadata", "X-HTTP-Method": "MERGE", "IF-MATCH": "*" }
        : {}),
    },
    body: payload,
    cache: "no-store",
  });

  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 500) };
  }

  if (!res.ok) {
    const err = data as { "odata.error"?: { message?: { value?: string } }; error?: { message?: string | { value?: string } } };
    const raw = err["odata.error"]?.message?.value ?? err.error?.message;
    const message = typeof raw === "string" ? raw : raw?.value;
    return Response.json({ error: message ?? `SharePoint antwortete mit HTTP ${res.status}` }, { status: res.status });
  }
  return Response.json(data);
}
