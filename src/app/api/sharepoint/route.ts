import { z } from "zod";

/**
 * Thin proxy for SharePoint REST calls. SharePoint Online does not send CORS headers
 * for arbitrary SPA origins, so version cleanup and recycle bin calls are forwarded from here.
 * The user's own delegated token is passed through – nothing is stored.
 */

const BodySchema = z.object({
  siteUrl: z.url(),
  path: z.string().startsWith("/_api/").max(2000),
  method: z.enum(["GET", "POST"]),
});

const ALLOWED_HOST = /^[a-z0-9-]+\.sharepoint(-mil)?\.(com|us|cn|de)$/i;

export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return Response.json({ error: "Kein Token." }, { status: 401 });

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Ungültige Anfrage." }, { status: 400 });

  const { siteUrl, path, method } = parsed.data;
  const site = new URL(siteUrl);
  if (site.protocol !== "https:" || !ALLOWED_HOST.test(site.hostname) || path.includes("..") || path.includes("://")) {
    return Response.json({ error: "Ziel nicht erlaubt." }, { status: 400 });
  }

  const target = `${site.origin}${site.pathname.replace(/\/$/, "")}${path}`;
  const res = await fetch(target, {
    method,
    headers: {
      Authorization: auth,
      Accept: "application/json;odata=nometadata",
      ...(method === "POST" ? { "Content-Length": "0" } : {}),
    },
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
