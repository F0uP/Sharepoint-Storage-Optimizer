import * as demo from "./demo";
import * as live from "./graph";
import type { ApprovalRequest } from "./graph";
import type { ScanOptions } from "./site-scan";
import type {
  BulkResult,
  DriveSummary,
  LibraryVersionSetting,
  OwnerMail,
  Quota,
  RetentionInfo,
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
  /** see ScanOptions: `base` fetches only changes, `resumable` continues interrupted scans, `onPartial` delivers interim results */
  scanSite(site: SiteRef, onProgress: (p: ScanProgress) => void, signal?: AbortSignal, options?: Omit<ScanOptions, "signal">): Promise<ScanResult>;
  deleteFiles(files: SpFile[], permanent: boolean, onProgress?: Progress): Promise<BulkResult>;
  /** `drives` tells which (sub)site – and therefore which recycle bin – a file belongs to */
  restoreFiles(site: SiteRef, files: SpFile[], deletedAfter: string, onProgress?: Progress, drives?: DriveSummary[]): Promise<BulkResult>;
  /** items (files and folders) SharePoint counts per library – to check a scan for completeness */
  libraryItemCounts(site: SiteRef, drives: DriveSummary[]): Promise<Map<string, number>>;
  scanVersions(files: SpFile[], onProgress?: Progress): Promise<Map<string, { count: number; bytes: number }>>;
  cleanVersions(files: SpFile[], onProgress?: Progress): Promise<BulkResult>;
  getVersionSettings(site: SiteRef, drives: DriveSummary[]): Promise<LibraryVersionSetting[]>;
  setVersionLimit(site: SiteRef, setting: LibraryVersionSetting, limit: number): Promise<void>;
  emptyRecycleBin(site: SiteRef): Promise<{ secondStage: boolean }>;
  refreshQuota(site: SiteRef): Promise<Quota | undefined>;
  getDownloadUrls(files: SpFile[]): Promise<Map<string, string>>;
  createUploadSession(file: SpFile): Promise<string>;
  sendMails(mails: OwnerMail[], onProgress?: Progress): Promise<BulkResult>;
  getThumbnails(files: SpFile[]): Promise<Map<string, string>>;
  getRetentionLabels(files: SpFile[]): Promise<Map<string, RetentionInfo>>;
  getPreservationHold(site: SiteRef): Promise<{ bytes: number; files: number } | null>;
  archiveSite(site: SiteRef): Promise<void>;
  createApproval(request: ApprovalRequest): Promise<string>;
  getApproval(id: string): Promise<{ state: string; result?: string }>;
}

const liveSource: DataSource = {
  searchSites: live.searchSites,
  siteQuotas: live.siteQuotas,
  scanSite: live.scanSite,
  deleteFiles: live.deleteFiles,
  restoreFiles: live.restoreFiles,
  libraryItemCounts: live.libraryItemCounts,
  scanVersions: live.scanVersions,
  cleanVersions: live.cleanVersions,
  getVersionSettings: live.getVersionSettings,
  setVersionLimit: live.setVersionLimit,
  emptyRecycleBin: live.emptyRecycleBin,
  refreshQuota: (site) => live.getSiteQuota(site.id),
  getDownloadUrls: live.getDownloadUrls,
  createUploadSession: live.createUploadSession,
  sendMails: live.sendMails,
  getThumbnails: live.getThumbnails,
  getRetentionLabels: live.getRetentionLabels,
  getPreservationHold: live.getPreservationHold,
  archiveSite: live.archiveSite,
  createApproval: live.createApproval,
  getApproval: live.getApproval,
};

const demoSource: DataSource = {
  searchSites: demo.demoSearchSites,
  siteQuotas: demo.demoSiteQuotas,
  scanSite: demo.demoScanSite,
  deleteFiles: demo.demoDeleteFiles,
  restoreFiles: demo.demoRestoreFiles,
  // the demo is always complete
  libraryItemCounts: async () => new Map(),
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
  getThumbnails: demo.demoThumbnails,
  getRetentionLabels: demo.demoRetentionLabels,
  getPreservationHold: demo.demoPreservationHold,
  archiveSite: demo.demoArchiveSite,
  createApproval: demo.demoCreateApproval,
  getApproval: demo.demoGetApproval,
};

export function getSource(mode: "live" | "demo"): DataSource {
  return mode === "live" ? liveSource : demoSource;
}
