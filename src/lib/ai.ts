import { categoryStats, computeInsights } from "./analysis";
import { ageInYears } from "./format";
import type { AiAction, AiPriority, AiProviderInfo, AiResult, ScanResult, SpFile } from "./types";

const MAX_CANDIDATES = 700;

/**
 * Picks the files most worth looking at: the largest ones, duplicates, big version histories,
 * old files and junk. Only metadata (path, size, date, type) leaves the browser.
 */
export function selectCandidates(scan: ScanResult, now = Date.parse(scan.scannedAt)): { files: SpFile[]; duplicates: Set<string> } {
  const insights = computeInsights(scan.files, now);
  const rowsOf = (id: string) => insights.find((i) => i.id === id)?.rows.map((r) => r.file) ?? [];
  const duplicates = new Set(rowsOf("duplicates").map((f) => f.id));
  const picked = new Map<string, SpFile>();
  const add = (list: SpFile[], limit: number) => {
    let n = 0;
    for (const f of list) {
      if (picked.size >= MAX_CANDIDATES || n >= limit) break;
      if (!picked.has(f.id)) {
        picked.set(f.id, f);
        n++;
      }
    }
  };
  const bySize = scan.files.toSorted((a, b) => b.size - a.size);
  add(bySize, 380);
  add(rowsOf("duplicates"), 120);
  add(rowsOf("versions"), 80);
  add(bySize.filter((f) => ageInYears(f.modified, now) > 3), 80);
  add(rowsOf("junk"), 40);
  return { files: [...picked.values()], duplicates };
}

export interface AiStatus {
  configured: boolean;
  providers: AiProviderInfo[];
}

export async function getAiStatus(): Promise<AiStatus> {
  try {
    const res = await fetch("/api/ai/analyze", { cache: "no-store" });
    if (!res.ok) return { configured: false, providers: [] };
    return await res.json();
  } catch {
    return { configured: false, providers: [] };
  }
}

interface RawRecommendation {
  i: number;
  action: AiAction;
  priority: AiPriority;
  reason: string;
}

/** Maps the model's index-based answer back to files – unknown or duplicate indices are dropped. */
export function mapRecommendations(raw: RawRecommendation[], files: SpFile[]): AiResult["recommendations"] {
  const seen = new Set<number>();
  return raw
    .filter((r) => Number.isInteger(r.i) && r.i >= 0 && r.i < files.length && !seen.has(r.i) && seen.add(r.i))
    .map((r) => ({ fileId: files[r.i].id, action: r.action, priority: r.priority, reason: r.reason }));
}

export async function runAiAnalysis(scan: ScanResult, provider?: AiProviderInfo["id"], signal?: AbortSignal): Promise<AiResult> {
  const { files, duplicates } = selectCandidates(scan);
  const body = {
    provider,
    siteName: scan.site.name,
    stats: {
      totalFiles: scan.files.length,
      totalBytes: scan.files.reduce((s, f) => s + f.size, 0),
      quotaTotal: scan.quota?.total,
      quotaUsed: scan.quota?.used,
      recycleBin: scan.quota?.deleted,
      byCategory: categoryStats(scan.files).filter((c) => c.count > 0),
    },
    files: files.map((f, i) => ({
      i,
      p: `${f.path}/${f.name}`.slice(-600),
      s: f.size,
      m: f.modified.slice(0, 10),
      c: f.category,
      v: f.versionBytes || undefined,
      d: duplicates.has(f.id) || undefined,
    })),
  };

  const res = await fetch("/api/ai/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `Analyse fehlgeschlagen (HTTP ${res.status})`);

  return {
    createdAt: new Date().toISOString(),
    provider: data.label ?? "KI",
    model: data.model ?? "",
    analyzedFiles: files.length,
    summary: data.summary ?? "",
    tips: data.tips ?? [],
    recommendations: mapRecommendations(data.recommendations ?? [], files),
  };
}
