import { connection } from "next/server";
import { analyze, availableProviders, ProviderError } from "@/lib/server/ai-providers";
import { AnalyzeRequestSchema, buildPrompt } from "@/lib/server/analyze-request";

export async function GET() {
  await connection();
  const providers = availableProviders();
  return Response.json({ configured: providers.length > 0, providers });
}

export async function POST(request: Request) {
  const providers = availableProviders();
  if (!providers.length) {
    return Response.json(
      { error: "Kein KI-Anbieter konfiguriert – setze OPENAI_API_KEY oder GEMINI_API_KEY in .env.local." },
      { status: 503 },
    );
  }

  const parsed = AnalyzeRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Ungültige Anfrage." }, { status: 400 });

  const provider = parsed.data.provider ?? providers[0].id;
  try {
    return Response.json(await analyze(provider, buildPrompt(parsed.data)));
  } catch (error) {
    const status = error instanceof ProviderError ? error.status : 500;
    return Response.json({ error: error instanceof Error ? error.message : "Unbekannter Fehler" }, { status });
  }
}
