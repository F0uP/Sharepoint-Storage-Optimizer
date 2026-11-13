import { create } from "zustand";
import { get as idbGet, set as idbSet } from "idb-keyval";
import { computeInsights, potential, type InsightId } from "./analysis";
import { generateDemoScan } from "./demo";
import { getSource } from "./source";
import type { Quota, ScanResult, SiteRef } from "./types";

/**
 * Overall analysis of all sites: each site is scanned once and reduced to a summary plus an index of
 * its large files – enough for tenant totals and duplicates across sites without keeping every scan.
 */

export interface SiteSummary {
  site: SiteRef;
  quota?: Quota;
  files: number;
  bytes: number;
  potential: number;
  safe: number;
  byInsight: Partial<Record<InsightId, number>>;
  /** newest change of any file */
  lastActivity?: string;
  scannedAt: string;
  error?: string;
  archived?: boolean;
}

export interface IndexedFile {
  key: string;
  siteId: string;
  name: string;
  path: string;
  size: number;
  webUrl: string;
}

export interface CrossDuplicate {
  key: string;
  name: string;
  size: number;
  copies: (IndexedFile & { siteName: string })[];
  /** bytes freed if one copy is kept */
  savings: number;
}

/** files from this size on take part in the cross-site duplicate check */
const INDEX_MIN = 5 * 1024 ** 2;
const INDEX_MAX_PER_SITE = 5000;

export function summarizeScan(scan: ScanResult, now = Date.parse(scan.scannedAt)): { summary: SiteSummary; index: IndexedFile[] } {
  const insights = computeInsights(scan.files, now);
  const pot = potential(insights, scan.quota);
  const lastActivity = scan.files.reduce((max, f) => (f.modified > max ? f.modified : max), "");
  const index = scan.files
    .filter((f) => f.hash && f.size >= INDEX_MIN)
    .toSorted((a, b) => b.size - a.size)
    .slice(0, INDEX_MAX_PER_SITE)
    .map((f) => ({ key: `${f.hash}:${f.size}`, siteId: scan.site.id, name: f.name, path: f.path, size: f.size, webUrl: f.webUrl }));
  return {
    summary: {
      site: scan.site,
      quota: scan.quota,
      files: scan.files.length,
      bytes: scan.files.reduce((s, f) => s + f.size, 0),
      potential: pot.bytes,
      safe: pot.safeBytes,
      byInsight: Object.fromEntries(insights.filter((i) => i.savings > 0).map((i) => [i.id, i.savings])),
      lastActivity: lastActivity || scan.site.lastModified,
      scannedAt: scan.scannedAt,
    },
    index,
  };
}

/** Same content (hash + size) in at least two different sites. */
export function crossSiteDuplicates(index: IndexedFile[], summaries: SiteSummary[]): CrossDuplicate[] {
  const names = new Map(summaries.map((s) => [s.site.id, s.site.name]));
  const groups = new Map<string, IndexedFile[]>();
  for (const f of index) groups.set(f.key, [...(groups.get(f.key) ?? []), f]);
  const out: CrossDuplicate[] = [];
  for (const [key, files] of groups) {
    if (new Set(files.map((f) => f.siteId)).size < 2) continue;
    out.push({
      key,
      name: files[0].name,
      size: files[0].size,
      copies: files.map((f) => ({ ...f, siteName: names.get(f.siteId) ?? f.siteId })),
      savings: files[0].size * (files.length - 1),
    });
  }
  return out.sort((a, b) => b.savings - a.savings);
}

/** Sites without any change for the given number of months, largest first. */
export function inactiveSites(summaries: SiteSummary[], months: number, now = Date.now()): SiteSummary[] {
  const cutoff = now - months * 30.44 * 864e5;
  return summaries
    .filter((s) => !s.error && !s.archived && s.lastActivity && Date.parse(s.lastActivity) < cutoff)
    .sort((a, b) => (b.quota?.used ?? b.bytes) - (a.quota?.used ?? a.bytes));
}

/* ------------------------------------------------------------------ store */

interface TenantState {
  /** demo and live results are never mixed */
  mode?: "live" | "demo";
  summaries: SiteSummary[];
  index: IndexedFile[];
  finishedAt?: string;
  progress: { done: number; total: number; current?: string } | null;
}

export const useTenant = create<TenantState>()(() => ({ summaries: [], index: [], progress: null }));

const KEY = "tenant:v1";
let controller: AbortController | null = null;

export async function loadTenant() {
  try {
    const saved = await idbGet<Omit<TenantState, "progress">>(KEY);
    if (saved) useTenant.setState({ ...saved, mode: "live", progress: null });
  } catch {
    // nothing stored yet
  }
}

/** Scans all given sites one after the other (demo: generated, instantly). */
export async function analyzeTenant(sites: SiteRef[], mode: "live" | "demo") {
  controller?.abort();
  const ctrl = new AbortController();
  controller = ctrl;
  const summaries: SiteSummary[] = [];
  const index: IndexedFile[] = [];
  useTenant.setState({ mode, summaries: [], index: [], finishedAt: undefined, progress: { done: 0, total: sites.length } });

  for (const [i, site] of sites.entries()) {
    if (ctrl.signal.aborted) break;
    useTenant.setState({ progress: { done: i, total: sites.length, current: site.name } });
    try {
      const scan =
        mode === "demo"
          ? (await new Promise((r) => setTimeout(r, 180)), generateDemoScan(site))
          : await getSource("live").scanSite(site, () => {}, ctrl.signal);
      const result = summarizeScan(scan);
      summaries.push(result.summary);
      index.push(...result.index);
    } catch (e) {
      if (ctrl.signal.aborted) break;
      summaries.push({
        site,
        files: 0,
        bytes: 0,
        potential: 0,
        safe: 0,
        byInsight: {},
        scannedAt: new Date().toISOString(),
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const finishedAt = new Date().toISOString();
  useTenant.setState({ summaries, index, finishedAt, progress: null });
  if (mode === "live" && !ctrl.signal.aborted) await idbSet(KEY, { summaries, index, finishedAt }).catch(() => {});
}

export function cancelTenantAnalysis() {
  controller?.abort();
  useTenant.setState({ progress: null });
}

export function markArchived(siteId: string, mode: "live" | "demo") {
  const state = useTenant.getState();
  const summaries = state.summaries.map((s) => (s.site.id === siteId ? { ...s, archived: true } : s));
  useTenant.setState({ summaries });
  if (mode === "live") void idbSet(KEY, { summaries, index: state.index, finishedAt: state.finishedAt }).catch(() => {});
}
