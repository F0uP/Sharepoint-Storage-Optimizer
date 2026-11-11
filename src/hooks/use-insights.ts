import { useMemo } from "react";
import { aiInsight, computeInsights, potential, type Insight } from "@/lib/analysis";
import { useApp } from "@/lib/store";
import type { SpFile } from "@/lib/types";

const cache = new WeakMap<SpFile[], Insight[]>();

/**
 * Rule-based insights (memoized per file list so every view shares one computation),
 * plus the AI's delete recommendations as their own category.
 */
export function useInsights() {
  const files = useApp((s) => s.scan?.files);
  const scannedAt = useApp((s) => s.scan?.scannedAt);
  const quota = useApp((s) => s.scan?.quota);
  const ai = useApp((s) => s.ai);
  return useMemo(() => {
    if (!files) return { insights: [] as Insight[], potential: { bytes: 0, files: 0, recycleBin: 0, safeBytes: 0 } };
    let rules = cache.get(files);
    if (!rules) {
      rules = computeInsights(files, scannedAt ? Date.parse(scannedAt) : undefined);
      cache.set(files, rules);
    }
    const insights = [...rules, aiInsight(files, ai)];
    return { insights, potential: potential(insights, quota) };
  }, [files, scannedAt, quota, ai]);
}
