import type { Settings } from "./settings";

/** API of the Electron preload script (desktop/preload.cts) – undefined in the browser. */

export interface DownloadJob {
  id: string;
  url: string;
  /** path below the chosen folder, e.g. "Dokumente/Projekte/Bericht.docx" */
  relativePath: string;
  /** expected size – the download is rejected if it differs */
  size?: number;
}

export interface DownloadResult {
  succeeded: string[];
  failed: { id: string; error: string }[];
}

export interface MediaStatus {
  ffmpeg: { available: boolean; path?: string; version?: string };
  /** image compression (sharp) is available */
  images: boolean;
}

export type CompressQuality = "balanced" | "strong";

export interface CompressJob {
  url: string;
  name: string;
  kind: "video" | "image";
  quality: CompressQuality;
  /** keep a copy of the original in this (previously chosen) folder */
  backupFolder?: string;
  relativePath?: string;
}

export interface CompressResult {
  tempId: string;
  originalBytes: number;
  compressedBytes: number;
}

export interface UpdateStatus {
  state: "disabled" | "idle" | "checking" | "none" | "available" | "downloading" | "ready" | "error";
  /** auto = download and install; notify = only point to the download page (unsigned macOS builds) */
  mode?: "auto" | "notify";
  version?: string;
  percent?: number;
  message?: string;
  releaseUrl?: string;
}

export interface AppInfo {
  version: string;
  platform: string;
}

export interface ProgressEvent {
  task: "download" | "compress" | "upload";
  done: number;
  total: number;
}

export type DesktopEvent = "progress" | "update" | "watch-check";

export interface DesktopBridge {
  platform: string;
  loadSettings(): Promise<unknown>;
  saveSettings(settings: Settings): Promise<void>;
  appInfo(): Promise<AppInfo>;
  chooseFolder(): Promise<string | null>;
  downloadFiles(folder: string, jobs: DownloadJob[]): Promise<DownloadResult>;
  mediaStatus(): Promise<MediaStatus>;
  compressFile(job: CompressJob): Promise<CompressResult>;
  uploadFile(tempId: string, uploadUrl: string): Promise<void>;
  discardFile(tempId: string): Promise<void>;
  notify(title: string, body: string): Promise<void>;
  checkForUpdates(): Promise<UpdateStatus>;
  installUpdate(): Promise<void>;
  on(event: DesktopEvent, listener: (payload: unknown) => void): () => void;
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

export function desktopBridge(): DesktopBridge | undefined {
  return typeof window === "undefined" ? undefined : window.desktop;
}
