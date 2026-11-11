export type FileCategory = "video" | "image" | "document" | "archive" | "audio" | "other";

export interface SpFile {
  id: string;
  driveId: string;
  driveName: string;
  name: string;
  /** lower-case extension without dot */
  ext: string;
  /** folder path including the library name, e.g. "Dokumente/Projekte/2021" */
  path: string;
  size: number;
  category: FileCategory;
  mimeType?: string;
  created: string;
  modified: string;
  modifiedBy?: string;
  webUrl: string;
  /** content hash (quickXorHash / sha1) – used for duplicate detection */
  hash?: string;
  /** number of versions incl. the current one (only after a version scan) */
  versionCount?: number;
  /** bytes occupied by non-current versions (only after a version scan) */
  versionBytes?: number;
}

export interface SiteRef {
  id: string;
  name: string;
  webUrl: string;
  description?: string;
}

export interface Quota {
  total: number;
  used: number;
  remaining: number;
  deleted: number;
  state?: string;
}

export interface DriveSummary {
  id: string;
  name: string;
  webUrl: string;
  fileCount: number;
  totalBytes: number;
}

export interface ScanResult {
  site: SiteRef;
  scannedAt: string;
  quota?: Quota;
  drives: DriveSummary[];
  files: SpFile[];
  versionsScannedAt?: string;
}

export interface ScanProgress {
  driveName?: string;
  driveIndex: number;
  driveCount: number;
  items: number;
}

export interface BulkResult {
  succeeded: string[];
  failed: { id: string; error: string }[];
}

export type AiAction = "delete" | "archive" | "compress" | "review" | "clean_versions";
export type AiPriority = "high" | "medium" | "low";

export interface AiRecommendation {
  fileId: string;
  action: AiAction;
  priority: AiPriority;
  reason: string;
}

export interface AiProviderInfo {
  id: "openai" | "gemini";
  label: string;
  model: string;
}

export interface AiResult {
  createdAt: string;
  provider: string;
  model: string;
  analyzedFiles: number;
  summary: string;
  tips: { title: string; detail: string }[];
  recommendations: AiRecommendation[];
}
