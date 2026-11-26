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
  /** id of the parent folder – rebuilds the path when folders are renamed or moved */
  parentId?: string;
  size: number;
  category: FileCategory;
  mimeType?: string;
  created: string;
  modified: string;
  modifiedBy?: string;
  /** e-mail of the last editor – used to ask owners to review their files */
  modifiedByEmail?: string;
  /** Entra object id of the last editor – needed for Teams approvals */
  modifiedById?: string;
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
  /** last change anywhere in the site (Graph `lastModifiedDateTime`) */
  lastModified?: string;
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
  /** URL of the (sub)site the library belongs to */
  siteUrl?: string;
  fileCount: number;
  /** folders read (without the library root) – SharePoint counts them as items, too */
  folderCount?: number;
  totalBytes: number;
}

/** Folder of a library – delta responses carry no paths, so paths are rebuilt from the folder tree. */
export interface FolderEntry {
  id: string;
  name: string;
  parentId?: string;
  root?: boolean;
}

/** Where the next scan continues: per library the delta link and the folder tree. */
export interface ScanSync {
  v: 1;
  drives: { id: string; deltaLink: string; folders: FolderEntry[] }[];
}

export interface ScanResult {
  site: SiteRef;
  scannedAt: string;
  quota?: Quota;
  drives: DriveSummary[];
  files: SpFile[];
  versionsScannedAt?: string;
  /** missing in demo data and in caches of older versions – the next scan then reads everything */
  sync?: ScanSync;
  /** interim state while the site is still being read – figures are preliminary, never cached */
  partial?: boolean;
}

export interface ScanProgress {
  driveName?: string;
  driveIndex: number;
  driveCount: number;
  items: number;
  /** "full" = complete inventory, "delta" = only the changes since the last scan */
  kind?: "full" | "delta";
  /** items an interrupted scan had already captured – it continues from there */
  resumed?: number;
  /** temporary problem the scan is waiting out (throttling, connection lost) */
  waiting?: { reason: string; until: number };
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
  /** `local` = key entered in this app's settings, `server` = key preset on the server. */
  source?: "local" | "server";
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

/** Version settings of a document library (SharePoint list). */
export interface LibraryVersionSetting {
  driveId: string;
  driveName: string;
  listId: string;
  /** (sub)site the library belongs to */
  siteUrl?: string;
  enabled: boolean;
  /** null = no limit configured (SharePoint default is 500) */
  majorLimit: number | null;
}

/** One message per file owner (see lib/notify.ts). */
export interface OwnerMail {
  to: { name: string; email: string };
  subject: string;
  html: string;
}

/** Retention label of a file (only files with a label are reported). */
export interface RetentionInfo {
  name: string;
  /** false = record or locked label – the file cannot be deleted */
  deleteAllowed: boolean;
  /** content is retained: deleting moves it to the Preservation Hold Library, the space stays used */
  retains: boolean;
}
