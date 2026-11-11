import { z } from "zod";
import { PROVIDER_IDS } from "./ai-providers";

export const AnalyzeRequestSchema = z.object({
  provider: z.enum(PROVIDER_IDS).optional(),
  siteName: z.string().max(300),
  stats: z.object({
    totalFiles: z.number(),
    totalBytes: z.number(),
    quotaTotal: z.number().optional(),
    quotaUsed: z.number().optional(),
    recycleBin: z.number().optional(),
    byCategory: z.array(z.object({ category: z.string(), count: z.number(), bytes: z.number() })),
  }),
  files: z
    .array(
      z.object({
        i: z.number().int(),
        p: z.string().max(600),
        s: z.number(),
        m: z.string(),
        c: z.string(),
        v: z.number().optional(),
        d: z.boolean().optional(),
      }),
    )
    .max(1000),
});

export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;

/** Compact, token-efficient text representation of the candidate list. */
export function buildPrompt({ siteName, stats, files }: AnalyzeRequest): string {
  const mb = (b: number) => (b / 1024 ** 2).toFixed(1);
  const gb = (b: number) => (b / 1024 ** 3).toFixed(2);
  const header = [
    `Site: ${siteName}`,
    `Dateien gesamt: ${stats.totalFiles}, Volumen: ${gb(stats.totalBytes)} GB`,
    stats.quotaTotal ? `Kontingent: ${gb(stats.quotaUsed ?? 0)} von ${gb(stats.quotaTotal)} GB belegt` : "",
    stats.recycleBin ? `Papierkorb: ${gb(stats.recycleBin)} GB` : "",
    `Nach Typ: ${stats.byCategory.map((c) => `${c.category} ${c.count} Dateien / ${gb(c.bytes)} GB`).join("; ")}`,
  ]
    .filter(Boolean)
    .join("\n");
  const lines = files.map((f) => `${f.i}|${mb(f.s)}|${f.m}|${f.c}|${f.v ? mb(f.v) : ""}|${f.d ? "dup" : ""}|${f.p}`);
  return `${header}\n\nKandidaten (${files.length}) – Format: index|MB|zuletzt geändert|typ|MB alte Versionen|dup=Inhalts-Duplikat|pfad\n${lines.join("\n")}`;
}
