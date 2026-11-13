import { z } from "zod";
import { AI_KEY_HEADER, MODEL_PATTERN, PROVIDER_IDS } from "@/lib/ai-config";
import { ProviderError, verifyProvider } from "@/lib/server/ai-providers";

const VerifyRequestSchema = z.object({
  provider: z.enum(PROVIDER_IDS),
  model: z.string().regex(MODEL_PATTERN).optional(),
});

/** Checks an API key (from the header) and model before they are saved in the settings. */
export async function POST(request: Request) {
  const parsed = VerifyRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Ungültige Anfrage." }, { status: 400 });

  const apiKey = request.headers.get(AI_KEY_HEADER)?.trim() || undefined;
  try {
    return Response.json({ ok: true, ...(await verifyProvider(parsed.data.provider, { apiKey, model: parsed.data.model })) });
  } catch (error) {
    const status = error instanceof ProviderError ? error.status : 500;
    return Response.json({ error: error instanceof Error ? error.message : "Unbekannter Fehler" }, { status });
  }
}
