import { AI_KEY_HEADER } from "@/lib/ai-config";
import { analyze, ProviderError, serverProviders } from "@/lib/server/ai-providers";
import { AnalyzeRequestSchema, buildPrompt } from "@/lib/server/analyze-request";

export async function POST(request: Request) {
  const parsed = AnalyzeRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Ungültige Anfrage." }, { status: 400 });

  const apiKey = request.headers.get(AI_KEY_HEADER)?.trim() || undefined;
  const provider = parsed.data.provider ?? serverProviders()[0]?.id;
  if (!provider) {
    return Response.json(
      { error: "Kein KI-Anbieter eingerichtet – hinterlege einen API-Schlüssel unter Einstellungen → KI-Anbieter." },
      { status: 503 },
    );
  }

  try {
    return Response.json(await analyze(provider, buildPrompt(parsed.data), { apiKey, model: parsed.data.model }));
  } catch (error) {
    if (error instanceof ProviderError) {
      // retryAfter tells the browser that the provider is only temporarily unavailable
      return Response.json({ error: error.message, retryAfter: error.retryAfter }, { status: error.status });
    }
    return Response.json({ error: error instanceof Error ? error.message : "Unbekannter Fehler" }, { status: 500 });
  }
}
