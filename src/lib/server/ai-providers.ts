import "server-only";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { z } from "zod";
import { AI_PROVIDERS, PROVIDER_IDS, type ProviderId } from "@/lib/ai-config";

export { PROVIDER_IDS, type ProviderId };

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

function envKey(id: ProviderId): string | undefined {
  return (id === "openai" ? process.env.OPENAI_API_KEY : process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) || undefined;
}

function envModel(id: ProviderId): string {
  return (id === "openai" ? process.env.OPENAI_MODEL : process.env.GEMINI_MODEL) || AI_PROVIDERS[id].defaultModel;
}

/**
 * Providers preset on the server via environment variables – optional, e.g. for a shared Docker
 * deployment. Normally keys are entered in the app's settings. AI_PROVIDER comes first.
 */
export function serverProviders(): ProviderInfo[] {
  const preferred = process.env.AI_PROVIDER as ProviderId | undefined;
  return PROVIDER_IDS.filter((id) => envKey(id))
    .toSorted((a, b) => Number(b === preferred) - Number(a === preferred))
    .map((id) => ({ id, label: AI_PROVIDERS[id].label, model: envModel(id) }));
}

/** Key and model sent by the browser (entered in the settings). */
export interface ClientCredentials {
  apiKey?: string;
  model?: string;
}

interface Credentials {
  apiKey: string;
  model: string;
}

/** A key from the settings wins; otherwise the server preset (with the server's model) is used. */
export function resolveCredentials(id: ProviderId, client: ClientCredentials = {}): Credentials | null {
  if (client.apiKey) return { apiKey: client.apiKey, model: client.model || AI_PROVIDERS[id].defaultModel };
  const apiKey = envKey(id);
  return apiKey ? { apiKey, model: envModel(id) } : null;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status = 502,
    /** temporary problem: seconds the provider asks to wait (0 = no hint); undefined = retrying will not help */
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

function httpStatusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" && status >= 400 ? status : undefined;
}

const statusOf = (error: unknown) => httpStatusOf(error) ?? 502;

/** Statuses after which the same request can succeed: timeout, rate limit, overload, gateway problems. */
const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_RETRY_AFTER = 120;

/** Gemini puts the whole JSON error body into the message – takes the readable text and the RetryInfo delay out of it. */
function parseGoogleError(message: string): { text?: string; retryAfter?: number } {
  const start = message.indexOf("{");
  if (start < 0) return {};
  try {
    const { error } = JSON.parse(message.slice(start)) as { error?: { message?: unknown; details?: { retryDelay?: unknown }[] } };
    const delay = error?.details?.map((d) => d?.retryDelay).find((d) => typeof d === "string");
    return {
      text: typeof error?.message === "string" ? error.message : undefined,
      retryAfter: typeof delay === "string" ? Number.parseFloat(delay) || undefined : undefined,
    };
  } catch {
    return {};
  }
}

/** Turns an SDK error into a readable ProviderError; temporary problems (overload, rate limit) are marked as retryable. */
export function providerError(provider: ProviderId, error: unknown): ProviderError {
  const label = AI_PROVIDERS[provider].label;
  const raw = (error as { message?: unknown } | null)?.message;
  const message = typeof raw === "string" ? raw : String(error);
  const google = parseGoogleError(message);
  const status = httpStatusOf(error);

  // OpenAI: billing limit reached – waiting does not help
  if ((error as { code?: unknown } | null)?.code === "insufficient_quota") {
    return new ProviderError(`${label}: Kontingent aufgebraucht – prüfe Tarif und Abrechnung beim Anbieter.`, 429);
  }
  if (status !== undefined && !TRANSIENT_STATUS.has(status)) return new ProviderError(`${label}: ${google.text ?? message}`, status);

  const retryAfter = Math.min(Math.ceil(google.retryAfter ?? 0), MAX_RETRY_AFTER);
  const reason =
    status === undefined
      ? `${label} ist nicht erreichbar (${message}).`
      : status === 429
        ? `${label}: Anfragelimit erreicht.`
        : status === 503
          ? `${label} ist gerade überlastet.`
          : `${label} meldet einen vorübergehenden Fehler (HTTP ${status}).`;
  return new ProviderError(reason, status ?? 502, retryAfter);
}

async function analyzeWithOpenAI(input: string, { apiKey, model }: Credentials): Promise<Analysis> {
  const client = new OpenAI({ apiKey });
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
    throw providerError("openai", error);
  }
}

/** JSON Schema for Gemini's `responseJsonSchema` (it rejects the `$schema` keyword). */
export function geminiSchema() {
  const schema = z.toJSONSchema(AnalysisSchema) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

async function analyzeWithGemini(input: string, { apiKey, model }: Credentials): Promise<Analysis> {
  const client = new GoogleGenAI({ apiKey });
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
    throw providerError("gemini", error);
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

function notConfigured(id: ProviderId) {
  return new ProviderError(`${AI_PROVIDERS[id].label} ist nicht eingerichtet – hinterlege einen API-Schlüssel in den Einstellungen.`, 503);
}

export async function analyze(provider: ProviderId, input: string, client: ClientCredentials = {}): Promise<Analysis & ProviderInfo> {
  const credentials = resolveCredentials(provider, client);
  if (!credentials) throw notConfigured(provider);
  const result =
    provider === "openai" ? await analyzeWithOpenAI(input, credentials) : await analyzeWithGemini(input, credentials);
  return { ...result, id: provider, label: AI_PROVIDERS[provider].label, model: credentials.model };
}

/** Human-readable reason why a key/model check failed. */
export function describeVerifyError(provider: ProviderId, model: string, error: unknown): ProviderError {
  const status = statusOf(error);
  const raw = (error as { message?: unknown } | null)?.message;
  const message = typeof raw === "string" ? raw : String(error);
  const label = AI_PROVIDERS[provider].label;
  if (status === 401 || status === 403 || /api[ _-]?key/i.test(message)) {
    return new ProviderError(`${label}: API-Schlüssel ungültig oder ohne Berechtigung.`, 401);
  }
  if (status === 404) return new ProviderError(`${label}: Modell „${model}“ nicht gefunden.`, 404);
  return providerError(provider, error);
}

/** Cheap check that key and model work – fetches the model's metadata, no tokens are used. */
export async function verifyProvider(provider: ProviderId, client: ClientCredentials = {}): Promise<ProviderInfo> {
  const credentials = resolveCredentials(provider, client);
  if (!credentials) throw notConfigured(provider);
  const { apiKey, model } = credentials;
  try {
    if (provider === "openai") await new OpenAI({ apiKey }).models.retrieve(model);
    else await new GoogleGenAI({ apiKey }).models.get({ model });
  } catch (error) {
    throw describeVerifyError(provider, model, error);
  }
  return { id: provider, label: AI_PROVIDERS[provider].label, model };
}
