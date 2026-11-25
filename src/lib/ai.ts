import { AI_KEY_HEADER, type ProviderId } from "./ai-config";
import { categoryStats, computeInsights, largest, type Insight } from "./analysis";
import { ageInYears } from "./format";
import type { AiAction, AiPriority, AiResult, ScanResult, SpFile } from "./types";

const MAX_CANDIDATES = 700;

/**
 * Picks the files most worth looking at: the largest ones, duplicates, big version histories,
 * old files and junk. Only metadata (path, size, date, type) leaves the browser.
 */
export function selectCandidates(
  scan: ScanResult,
  now = Date.parse(scan.scannedAt),
  /** already computed for this file list (the views share them) */
  insights: Insight[] = computeInsights(scan.files, now),
): { files: SpFile[]; duplicates: Set<string> } {
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
  // only the largest files are needed – no need to sort the whole site
  add(largest(scan.files, 380, (f) => f.size), 380);
  add(rowsOf("duplicates"), 120);
  add(rowsOf("versions"), 80);
  // enough old files to find 80 that were not picked yet
  add(largest(scan.files, 80 + MAX_CANDIDATES, (f) => f.size, (f) => ageInYears(f.modified, now) > 3), 80);
  add(rowsOf("junk"), 40);
  return { files: [...picked.values()], duplicates };
}

/** Pause before an automatic retry, announced so the view can count down. */
export interface AiRetry {
  /** 1-based number of the retry that follows the pause */
  attempt: number;
  attempts: number;
  /** timestamp (ms) when the retry starts */
  until: number;
  reason: string;
}

/** Key and model from the settings; without a key the server's preset (if any) is used. */
export interface AiRunOptions {
  provider?: ProviderId;
  apiKey?: string;
  model?: string;
  signal?: AbortSignal;
  /** called before each automatic retry after a temporary provider error (overload, rate limit) */
  onRetry?: (retry: AiRetry) => void;
}

/** Waits before the 1st, 2nd and 3rd retry – a longer wait requested by the provider wins. */
export const RETRY_DELAYS = [10, 20, 40];

/** Error of an AI route; retryAfter (seconds) is set when the provider is only temporarily unavailable. */
export class AiRequestError extends Error {
  constructor(
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function requestInit({ apiKey, signal }: AiRunOptions, body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(apiKey ? { [AI_KEY_HEADER]: apiKey } : {}) },
    body: JSON.stringify(body),
    signal,
  };
}

async function readJson(res: Response, fallback: string) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new AiRequestError(data?.error ?? `${fallback} (HTTP ${res.status})`, typeof data?.retryAfter === "number" ? data.retryAfter : undefined);
  }
  return data;
}

/** Posts the analysis and retries automatically while the provider is overloaded or rate-limited. */
async function postAnalysis(init: RequestInit, { signal, onRetry }: AiRunOptions) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await readJson(await fetch("/api/ai/analyze", init), "Analyse fehlgeschlagen");
    } catch (error) {
      if (!(error instanceof AiRequestError) || error.retryAfter === undefined || signal?.aborted) throw error;
      if (attempt >= RETRY_DELAYS.length) {
        throw new AiRequestError(`${error.message} Auch ${RETRY_DELAYS.length} weitere Versuche schlugen fehl – bitte später erneut starten.`);
      }
      const seconds = Math.max(RETRY_DELAYS[attempt], error.retryAfter);
      onRetry?.({ attempt: attempt + 1, attempts: RETRY_DELAYS.length, until: Date.now() + seconds * 1000, reason: error.message });
      await wait(seconds * 1000, signal);
    }
  }
}

/** Checks key and model with the provider before they are saved. */
export async function verifyAiProvider(options: AiRunOptions & { provider: ProviderId }): Promise<{ model: string }> {
  const { provider, apiKey, model } = options;
  const res = await fetch("/api/ai/verify", requestInit(options, { provider, model: apiKey ? model : undefined }));
  return readJson(res, "Prüfung fehlgeschlagen");
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

export async function runAiAnalysis(scan: ScanResult, options: AiRunOptions = {}): Promise<AiResult> {
  const { files, duplicates } = selectCandidates(scan);
  const body = {
    provider: options.provider,
    model: options.apiKey ? options.model : undefined,
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

  const data = await postAnalysis(requestInit(options, body), options);

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
