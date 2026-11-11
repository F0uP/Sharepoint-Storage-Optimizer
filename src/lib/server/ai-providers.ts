import "server-only";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { z } from "zod";

export const PROVIDER_IDS = ["openai", "gemini"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  model: string;
}

export const AnalysisSchema = z.object({
  summary: z.string().describe("2–4 Sätze Lagebild auf Deutsch: wo liegt der Speicher, wo ist das größte Potenzial"),
  tips: z
    .array(
      z.object({
        title: z.string().describe("Kurzer Titel, max. 6 Wörter"),
        detail: z.string().describe("Konkrete Handlungsempfehlung, 1–2 Sätze"),
      }),
    )
    .describe("3–6 generelle, strukturelle Optimierungen für diese Site"),
  recommendations: z
    .array(
      z.object({
        i: z.number().int().describe("Index der Datei aus der Liste"),
        action: z.enum(["delete", "archive", "compress", "review", "clean_versions"]),
        priority: z.enum(["high", "medium", "low"]),
        reason: z.string().describe("Begründung auf Deutsch, max. 14 Wörter"),
      }),
    )
    .describe("Konkrete Dateien, die optimiert werden können – möglichst viele"),
});

export type Analysis = z.infer<typeof AnalysisSchema>;

export const INSTRUCTIONS = `Du bist ein Experte für Microsoft-365-Speicheroptimierung und analysierst den Dateibestand einer SharePoint-Site.
Ziel: Der Nutzer will SCHNELL MÖGLICHST VIEL Speicherplatz freigeben. Liefere deshalb viele konkrete Dateien (Ziel: 60–200 Empfehlungen, sofern die Daten das hergeben), sortiert nach Einsparpotenzial.

Aktionen:
- delete: offensichtlich verzichtbar (Duplikate/Kopien, Temp-/Sperrdateien, Installer, alte Exporte/Backups, Rohmaterial zu fertigen Videos, mehrfache "final"/"v2"-Stände)
- archive: wertvoll, aber lange ungenutzt – in Archiv-Speicher (z. B. Microsoft 365 Archive, Azure Blob) verschieben
- compress: große Medien, die sich ohne sichtbaren Verlust verkleinern lassen (Videos neu kodieren, Bilder als JPEG/WebP)
- clean_versions: Datei mit großem Versionsverlauf (Feld v = MB alter Versionen)
- review: groß und auffällig, aber unklar – menschliche Prüfung nötig

Regeln:
- Nutze ausschließlich Indizes aus der Liste. Jede Datei höchstens einmal.
- Sei bei Verträgen, Rechnungen, Personal- und Rechtsdokumenten vorsichtig (höchstens archive/review).
- priority "high" = großes Potenzial und geringes Risiko.
- Antworte auf Deutsch, knapp und konkret. Erfinde keine Dateien.`;

const MODELS: Record<ProviderId, string> = {
  openai: process.env.OPENAI_MODEL || "gpt-5.4-mini",
  gemini: process.env.GEMINI_MODEL || "gemini-3.8-flash",
};

const LABELS: Record<ProviderId, string> = { openai: "OpenAI", gemini: "Google Gemini" };

function hasKey(id: ProviderId): boolean {
  return id === "openai" ? Boolean(process.env.OPENAI_API_KEY) : Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
}

/** Providers with a configured API key; the preferred one (AI_PROVIDER) comes first. */
export function availableProviders(): ProviderInfo[] {
  const preferred = process.env.AI_PROVIDER as ProviderId | undefined;
  return PROVIDER_IDS.filter(hasKey)
    .toSorted((a, b) => Number(b === preferred) - Number(a === preferred))
    .map((id) => ({ id, label: LABELS[id], model: MODELS[id] }));
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

async function analyzeWithOpenAI(input: string): Promise<Analysis> {
  const model = MODELS.openai;
  const client = new OpenAI();
  try {
    const response = await client.responses.parse({
      model,
      instructions: INSTRUCTIONS,
      input,
      text: { format: zodTextFormat(AnalysisSchema, "storage_analysis") },
      ...(/^(gpt-5|gpt-6|o\d)/.test(model) ? { reasoning: { effort: "low" as const } } : {}),
    });
    if (!response.output_parsed) throw new ProviderError("OpenAI hat keine auswertbare Antwort geliefert.");
    return response.output_parsed;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    const status = error instanceof OpenAI.APIError && error.status ? error.status : 502;
    throw new ProviderError(`OpenAI: ${error instanceof Error ? error.message : String(error)}`, status);
  }
}

/** JSON Schema for Gemini's `responseJsonSchema` (it rejects the `$schema` keyword). */
export function geminiSchema() {
  const schema = z.toJSONSchema(AnalysisSchema) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

async function analyzeWithGemini(input: string): Promise<Analysis> {
  const model = MODELS.gemini;
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY });
  let text: string | undefined;
  try {
    const response = await client.models.generateContent({
      model,
      contents: input,
      config: {
        systemInstruction: INSTRUCTIONS,
        responseMimeType: "application/json",
        responseJsonSchema: geminiSchema(),
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });
    text = response.text;
  } catch (error) {
    const status = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : 502;
    throw new ProviderError(`Gemini: ${error instanceof Error ? error.message : String(error)}`, status);
  }
  let json: unknown;
  try {
    json = JSON.parse(text ?? "");
  } catch {
    json = null;
  }
  const parsed = AnalysisSchema.safeParse(json);
  if (!parsed.success) throw new ProviderError("Gemini hat keine auswertbare Antwort geliefert.");
  return parsed.data;
}

export async function analyze(provider: ProviderId, input: string): Promise<Analysis & ProviderInfo> {
  const info = availableProviders().find((p) => p.id === provider);
  if (!info) throw new ProviderError(`${LABELS[provider]} ist nicht konfiguriert.`, 503);
  const result = provider === "openai" ? await analyzeWithOpenAI(input) : await analyzeWithGemini(input);
  return { ...result, ...info };
}
