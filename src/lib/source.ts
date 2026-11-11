import * as demo from "./demo";
import * as live from "./graph";
import type { BulkResult, Quota, ScanProgress, ScanResult, SiteRef, SpFile } from "./types";

type Progress = (done: number, total: number) => void;

/** Everything the UI needs from a storage backend – implemented by Graph (live) and the demo generator. */
export interface DataSource {
  searchSites(query: string): Promise<SiteRef[]>;
  scanSite(site: SiteRef, onProgress: (p: ScanProgress) => void, signal?: AbortSignal): Promise<ScanResult>;
  deleteFiles(files: SpFile[], permanent: boolean, onProgress?: Progress): Promise<BulkResult>;
  scanVersions(files: SpFile[], onProgress?: Progress): Promise<Map<string, { count: number; bytes: number }>>;
  cleanVersions(files: SpFile[], onProgress?: Progress): Promise<BulkResult>;
  emptyRecycleBin(site: SiteRef): Promise<{ secondStage: boolean }>;
  refreshQuota(site: SiteRef): Promise<Quota | undefined>;
}

const liveSource: DataSource = {
  searchSites: live.searchSites,
  scanSite: live.scanSite,
  deleteFiles: live.deleteFiles,
  scanVersions: live.scanVersions,
  cleanVersions: live.cleanVersions,
  emptyRecycleBin: live.emptyRecycleBin,
  refreshQuota: (site) => live.getSiteQuota(site.id),
};

const demoSource: DataSource = {
  searchSites: demo.demoSearchSites,
  scanSite: demo.demoScanSite,
  deleteFiles: demo.demoDeleteFiles,
  scanVersions: demo.demoScanVersions,
  cleanVersions: demo.demoCleanVersions,
  emptyRecycleBin: async () => {
    await new Promise((r) => setTimeout(r, 900));
    return { secondStage: true };
  },
  refreshQuota: async () => undefined,
};

export function getSource(mode: "live" | "demo"): DataSource {
  return mode === "live" ? liveSource : demoSource;
}
