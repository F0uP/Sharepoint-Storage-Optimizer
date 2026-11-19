import { z } from "zod";
import { GUID_PATTERN, isTokenResource, TENANT_PATTERN } from "@/lib/entra";
import { AppTokenError, requestAppToken } from "@/lib/server/app-token";

const BodySchema = z.object({
  tenantId: z.string().regex(TENANT_PATTERN),
  clientId: z.string().regex(GUID_PATTERN),
  clientSecret: z.string().min(1).max(500).optional(),
  certificate: z.string().min(1).max(16_000).optional(),
  resource: z.string().refine(isTokenResource),
});

/**
 * Token exchange for the app access mode (client credentials). Entra ID does not let browsers redeem
 * tokens for confidential clients, so the app hands its credentials to this route for each token request.
 * Nothing is stored or logged; only Microsoft Graph and SharePoint Online are allowed as resources.
 */
export async function POST(request: Request) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Ungültige Anfrage." }, { status: 400 });

  const { clientSecret, certificate, ...target } = parsed.data;
  const credential = certificate ? { certificate } : clientSecret ? { secret: clientSecret } : null;
  if (!credential) return Response.json({ error: "Client-Secret oder Zertifikat fehlt." }, { status: 400 });

  try {
    const token = await requestAppToken({ ...target, credential });
    return Response.json(token, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AppTokenError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
    return Response.json({ error: "Die App konnte sich nicht bei Microsoft anmelden." }, { status: 500 });
  }
}
