import { create } from "zustand";
import { toast } from "sonner";
import { del, get as idbGet, set as idbSet } from "idb-keyval";
import { addEntry, saveHistory, type HistoryEntry } from "./history";
import { loadScan, saveScan as writeScanCache } from "./scan-cache";
import type { Snapshot } from "./trend";
import type { AiResult, FileCategory, Quota, ScanProgress, ScanResult, SiteRef, SpFile } from "./types";

export type View = "overview" | "files" | "optimize" | "ai" | "rules" | "reviews" | "history";
export type Mode = "live" | "demo";
/** pre-set filter when jumping from the overview into another view */
export type ViewPreset = { category?: FileCategory; insight?: string; query?: string };

export interface CleanupStats {
  /** bytes released from the quota in this session */
  freedBytes: number;
  /** bytes moved to the recycle bin in this session (still count against the quota) */
  recycledBytes: number;
  files: number;
}

const EMPTY_STATS: CleanupStats = { freedBytes: 0, recycledBytes: 0, files: 0 };

/** Background update of the shown scan (only the changes since it are fetched). */
export interface SyncStatus {
  items: number;
  /** true when no change tracking is available yet and everything is read once more */
  full?: boolean;
  waiting?: ScanProgress["waiting"];
}

interface AppState {
  mode: Mode | null;
  view: View;
  site: SiteRef | null;
  scan: ScanResult | null;
  progress: ScanProgress | null;
  syncing: SyncStatus | null;
  ai: AiResult | null;
  preset: ViewPreset | null;
  cleanup: CleanupStats;
  /** actions on the current site, newest first */
  history: HistoryEntry[];
  /** quota readings of the current site, oldest first */
  trend: Snapshot[];

  setMode(mode: Mode | null): void;
  setView(view: View, preset?: ViewPreset): void;
  selectSite(site: SiteRef | null): void;
  setProgress(progress: ScanProgress | null): void;
  setSyncing(syncing: SyncStatus | null): void;
  /** resolves once the scan is cached (false: not cached – demo mode or storage failed) */
  setScan(scan: ScanResult | null, ai?: AiResult | null): Promise<boolean>;
  /** replaces the scan with an updated one (background update), keeping the AI analysis */
  applySync(scan: ScanResult): Promise<boolean>;
  setQuota(quota: Quota | undefined): void;
  removeFiles(ids: string[], permanent: boolean): void;
  applyVersions(map: Map<string, { count: number; bytes: number }>): void;
  clearVersions(ids: string[]): void;
  recycleBinEmptied(secondStage: boolean): void;
  setAi(ai: AiResult | null): void;
  dismissAi(fileIds: string[]): void;
  setSiteData(data: { history: HistoryEntry[]; trend: Snapshot[] }): void;
  setTrend(trend: Snapshot[]): void;
  pushHistory(entry: HistoryEntry): void;
  markRestored(entryId: string, fileIds: string[]): void;
  /** puts files back after they were restored from the recycle bin */
  addFiles(files: SpFile[]): void;
  /** applies new sizes after files were compressed in place */
  updateFiles(sizes: Map<string, number>, freedBytes: number): void;
  reset(): void;
}

const aiKey = (siteId: string) => `ai:${siteId}`;

export async function loadCached(siteId: string): Promise<{ scan?: ScanResult; ai?: AiResult }> {
  try {
    const [scan, ai] = await Promise.all([loadScan(siteId), idbGet<AiResult>(aiKey(siteId))]);
    // an unreadable or incomplete cache is treated like none – the site is scanned again
    return scan ? { scan, ai } : {};
  } catch {
    return {};
  }
}

let cacheWarningShown = false;

/** Writes a scan to the cache (in chunks); failures (e.g. disk full) are reported once per session. */
export async function saveScan(scan: ScanResult): Promise<boolean> {
  try {
    return await writeScanCache(scan);
  } catch (e) {
    console.warn("Scan konnte nicht zwischengespeichert werden", e);
    if (!cacheWarningShown) {
      cacheWarningShown = true;
      toast.warning("Scan konnte nicht zwischengespeichert werden", {
        description: `Die Daten bleiben bis zum Schließen der App erhalten. ${e instanceof Error ? e.message : ""}`.trim(),
      });
    }
    return false;
  }
}

/** Scan results and AI analysis survive a reload (live mode only – demo data is regenerated). */
function persist(state: AppState): Promise<boolean> {
  // an interim state must never be mistaken for a complete scan – the finished scan is cached
  if (state.mode !== "live" || !state.scan || state.scan.partial) return Promise.resolve(false);
  const id = state.scan.site.id;
  (state.ai ? idbSet(aiKey(id), state.ai) : del(aiKey(id))).catch(() => {});
  return saveScan(state.scan);
}

function persistHistory(state: AppState) {
  if (state.mode === "live" && state.site) saveHistory(state.site.id, state.history);
}

function withDrives(scan: ScanResult, files: SpFile[]): ScanResult["drives"] {
  return scan.drives.map((d) => {
    const df = files.filter((f) => f.driveId === d.id);
    return { ...d, fileCount: df.length, totalBytes: df.reduce((s, f) => s + f.size, 0) };
  });
}

export const useApp = create<AppState>()((set, get) => ({
  mode: null,
  view: "overview",
  site: null,
  scan: null,
  progress: null,
  syncing: null,
  ai: null,
  preset: null,
  cleanup: EMPTY_STATS,
  history: [],
  trend: [],

  setMode: (mode) => set({ mode }),
  setView: (view, preset) => set({ view, preset: preset ?? null }),
  selectSite: (site) =>
    set({ site, scan: null, ai: null, progress: null, syncing: null, view: "overview", cleanup: EMPTY_STATS, history: [], trend: [] }),
  setProgress: (progress) => set({ progress }),
  setSyncing: (syncing) => set({ syncing }),
  setScan: (scan, ai = null) => {
    set({ scan, ai, progress: null });
    return persist(get());
  },
  applySync: (scan) => {
    const { ai } = get();
    const ids = new Set(scan.files.map((f) => f.id));
    // recommendations for files that no longer exist are dropped
    set({ scan, ai: ai && { ...ai, recommendations: ai.recommendations.filter((r) => ids.has(r.fileId)) } });
    return persist(get());
  },
  setQuota: (quota) => {
    const { scan } = get();
    if (!scan || !quota) return;
    set({ scan: { ...scan, quota } });
    persist(get());
  },
  removeFiles: (ids, permanent) => {
    const { scan, ai, cleanup } = get();
    if (!scan) return;
    const remove = new Set(ids);
    let freed = 0;
    const files = scan.files.filter((f) => {
      if (!remove.has(f.id)) return true;
      freed += f.size + (f.versionBytes ?? 0);
      return false;
    });
    const drives = withDrives(scan, files);
    const quota = scan.quota && {
      ...scan.quota,
      ...(permanent
        ? { used: Math.max(0, scan.quota.used - freed), remaining: scan.quota.remaining + freed }
        : { deleted: scan.quota.deleted + freed }),
    };
    set({
      scan: { ...scan, files, drives, quota },
      ai: ai && { ...ai, recommendations: ai.recommendations.filter((r) => !remove.has(r.fileId)) },
      cleanup: {
        freedBytes: cleanup.freedBytes + (permanent ? freed : 0),
        recycledBytes: cleanup.recycledBytes + (permanent ? 0 : freed),
        files: cleanup.files + (scan.files.length - files.length),
      },
    });
    persist(get());
  },
  applyVersions: (map) => {
    const { scan } = get();
    if (!scan) return;
    const files = scan.files.map((f) => {
      const v = map.get(f.id);
      return v ? { ...f, versionCount: v.count, versionBytes: v.bytes } : f;
    });
    set({ scan: { ...scan, files, versionsScannedAt: new Date().toISOString() } });
    persist(get());
  },
  clearVersions: (ids) => {
    const { scan, cleanup } = get();
    if (!scan) return;
    const clear = new Set(ids);
    let freed = 0;
    const files = scan.files.map((f) => {
      if (!clear.has(f.id)) return f;
      freed += f.versionBytes ?? 0;
      return { ...f, versionCount: 1, versionBytes: 0 };
    });
    const quota = scan.quota && { ...scan.quota, used: Math.max(0, scan.quota.used - freed), remaining: scan.quota.remaining + freed };
    set({ scan: { ...scan, files, quota }, cleanup: { ...cleanup, freedBytes: cleanup.freedBytes + freed } });
    persist(get());
  },
  recycleBinEmptied: (secondStage) => {
    const { scan, cleanup } = get();
    if (!scan?.quota || !secondStage) return;
    const freed = scan.quota.deleted;
    set({
      scan: {
        ...scan,
        quota: { ...scan.quota, deleted: 0, used: Math.max(0, scan.quota.used - freed), remaining: scan.quota.remaining + freed },
      },
      cleanup: { ...cleanup, freedBytes: cleanup.freedBytes + freed, recycledBytes: 0 },
    });
    persist(get());
  },
  setAi: (ai) => {
    set({ ai });
    persist(get());
  },
  dismissAi: (fileIds) => {
    const { ai } = get();
    if (!ai) return;
    const drop = new Set(fileIds);
    set({ ai: { ...ai, recommendations: ai.recommendations.filter((r) => !drop.has(r.fileId)) } });
    persist(get());
  },
  setSiteData: ({ history, trend }) => set({ history, trend }),
  setTrend: (trend) => set({ trend }),
  pushHistory: (entry) => {
    set({ history: addEntry(get().history, entry) });
    persistHistory(get());
  },
  markRestored: (entryId, fileIds) => {
    set({
      history: get().history.map((e) =>
        e.id === entryId ? { ...e, restoredIds: [...new Set([...(e.restoredIds ?? []), ...fileIds])] } : e,
      ),
    });
    persistHistory(get());
  },
  addFiles: (restored) => {
    const { scan, cleanup } = get();
    if (!scan || !restored.length) return;
    const known = new Set(scan.files.map((f) => f.id));
    const added = [...new Map(restored.filter((f) => !known.has(f.id)).map((f) => [f.id, f])).values()];
    const files = [...scan.files, ...added];
    const bytes = added.reduce((s, f) => s + f.size + (f.versionBytes ?? 0), 0);
    // restored from the recycle bin: still part of "used", just no longer deleted
    const quota = scan.quota && { ...scan.quota, deleted: Math.max(0, scan.quota.deleted - bytes) };
    set({
      scan: { ...scan, files, drives: withDrives(scan, files), quota },
      cleanup: {
        ...cleanup,
        recycledBytes: Math.max(0, cleanup.recycledBytes - bytes),
        files: Math.max(0, cleanup.files - added.length),
      },
    });
    persist(get());
  },
  updateFiles: (sizes, freedBytes) => {
    const { scan, cleanup } = get();
    if (!scan) return;
    const files = scan.files.map((f) => {
      const size = sizes.get(f.id);
      return size === undefined ? f : { ...f, size, versionCount: 1, versionBytes: 0, modified: new Date().toISOString() };
    });
    const quota = scan.quota && {
      ...scan.quota,
      used: Math.max(0, scan.quota.used - freedBytes),
      remaining: scan.quota.remaining + freedBytes,
    };
    set({
      scan: { ...scan, files, drives: withDrives(scan, files), quota },
      cleanup: { ...cleanup, freedBytes: cleanup.freedBytes + freedBytes },
    });
    persist(get());
  },
  reset: () =>
    set({
      mode: null,
      site: null,
      scan: null,
      progress: null,
      syncing: null,
      ai: null,
      view: "overview",
      cleanup: EMPTY_STATS,
      preset: null,
      history: [],
      trend: [],
    }),
}));
