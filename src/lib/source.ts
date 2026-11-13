import * as demo from "./demo";
import * as live from "./graph";
import type {
  BulkResult,
  DriveSummary,
  LibraryVersionSetting,
  OwnerMail,
  Quota,
  ScanProgress,
  ScanResult,
  SiteRef,
  SpFile,
} from "./types";

type Progress = (done: number, total: number) => void;

/** Everything the UI needs from a storage backend – implemented by Graph (live) and the demo generator. */
export interface DataSource {
  searchSites(query: string): Promise<SiteRef[]>;
  siteQuotas(sites: SiteRef[], onProgress?: Progress): Promise<Map<string, Quota | undefined>>;
  scanSite(site: SiteRef, onProgress: (p: ScanProgress) => void, signal?: AbortSignal): Promise<ScanResult>;
  deleteFiles(files: SpFile[], permanent: boolean, onProgress?: Progress): Promise<BulkResult>;
  restoreFiles(site: SiteRef, files: SpFile[], deletedAfter: string, onProgress?: Progress): Promise<BulkResult>;
  scanVersions(files: SpFile[], onProgress?: Progress): Promise<Map<string, { count: number; bytes: number }>>;
  cleanVersions(files: SpFile[], onProgress?: Progress): Promise<BulkResult>;
  getVersionSettings(site: SiteRef, drives: DriveSummary[]): Promise<LibraryVersionSetting[]>;
  setVersionLimit(site: SiteRef, setting: LibraryVersionSetting, limit: number): Promise<void>;
  emptyRecycleBin(site: SiteRef): Promise<{ secondStage: boolean }>;
  refreshQuota(site: SiteRef): Promise<Quota | undefined>;
  getDownloadUrls(files: SpFile[]): Promise<Map<string, string>>;
  createUploadSession(file: SpFile): Promise<string>;
  sendMails(mails: OwnerMail[], onProgress?: Progress): Promise<BulkResult>;
}

const liveSource: DataSource = {
  searchSites: live.searchSites,
  siteQuotas: live.siteQuotas,
  scanSite: live.scanSite,
  deleteFiles: live.deleteFiles,
  restoreFiles: live.restoreFiles,
  scanVersions: live.scanVersions,
  cleanVersions: live.cleanVersions,
  getVersionSettings: live.getVersionSettings,
  setVersionLimit: live.setVersionLimit,
  emptyRecycleBin: live.emptyRecycleBin,
  refreshQuota: (site) => live.getSiteQuota(site.id),
  getDownloadUrls: live.getDownloadUrls,
  createUploadSession: live.createUploadSession,
  sendMails: live.sendMails,
};

const demoSource: DataSource = {
  searchSites: demo.demoSearchSites,
  siteQuotas: demo.demoSiteQuotas,
  scanSite: demo.demoScanSite,
  deleteFiles: demo.demoDeleteFiles,
  restoreFiles: demo.demoRestoreFiles,
  scanVersions: demo.demoScanVersions,
  cleanVersions: demo.demoCleanVersions,
  getVersionSettings: demo.demoVersionSettings,
  setVersionLimit: demo.demoSetVersionLimit,
  emptyRecycleBin: async () => {
    await new Promise((r) => setTimeout(r, 900));
    return { secondStage: true };
  },
  refreshQuota: async () => undefined,
  getDownloadUrls: demo.demoDownloadUrls,
  createUploadSession: async () => {
    throw new Error("Im Demo-Modus werden keine Dateien hochgeladen.");
  },
  sendMails: demo.demoSendMails,
};

export function getSource(mode: "live" | "demo"): DataSource {
  return mode === "live" ? liveSource : demoSource;
}
