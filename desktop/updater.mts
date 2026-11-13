import { app } from "electron";
import { autoUpdater } from "electron-updater";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Updates from GitHub Releases (or a generic server). Windows installs updates automatically.
 * macOS can only auto-update signed builds – ad-hoc signed builds just point to the download page.
 */
export interface UpdateStatus {
  state: "disabled" | "idle" | "checking" | "none" | "available" | "downloading" | "ready" | "error";
  mode?: "auto" | "notify";
  version?: string;
  percent?: number;
  message?: string;
  releaseUrl?: string;
}

const SIX_HOURS = 6 * 3_600_000;

function isAdHocSignedMac(): boolean {
  if (process.platform !== "darwin") return false;
  const bundle = path.resolve(process.execPath, "../../..");
  const result = spawnSync("codesign", ["-dv", bundle], { encoding: "utf8" });
  return /Signature=adhoc/.test(result.stderr ?? "") || result.status !== 0;
}

function releasesUrl(): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(path.join(app.getAppPath(), "package.json"), "utf8")) as { updateReleasesUrl?: string };
    return pkg.updateReleasesUrl;
  } catch {
    return undefined;
  }
}

export class Updates {
  status: UpdateStatus = { state: "disabled" };
  private mode: "auto" | "notify" = "auto";

  constructor(private readonly publish: (status: UpdateStatus) => void) {}

  private set(status: UpdateStatus) {
    this.status = { mode: this.mode, releaseUrl: releasesUrl(), ...status };
    this.publish(this.status);
  }

  init() {
    // app-update.yml is written by electron-builder only when a publish target is configured
    if (!app.isPackaged || !existsSync(path.join(process.resourcesPath, "app-update.yml"))) return;
    this.mode = isAdHocSignedMac() ? "notify" : "auto";
    autoUpdater.autoDownload = this.mode === "auto";
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = null;

    autoUpdater.on("checking-for-update", () => this.set({ state: "checking" }));
    autoUpdater.on("update-not-available", () => this.set({ state: "none" }));
    autoUpdater.on("update-available", (info) =>
      this.set({ state: this.mode === "auto" ? "downloading" : "available", version: info.version }),
    );
    autoUpdater.on("download-progress", (p) => this.set({ state: "downloading", version: this.status.version, percent: p.percent }));
    autoUpdater.on("update-downloaded", (info) => this.set({ state: "ready", version: info.version }));
    autoUpdater.on("error", (error) => this.set({ state: "error", message: error.message.split("\n")[0] }));

    this.status = { state: "idle", mode: this.mode, releaseUrl: releasesUrl() };
    setTimeout(() => void this.check(), 15_000);
    setInterval(() => void this.check(), SIX_HOURS);
  }

  async check(): Promise<UpdateStatus> {
    if (this.status.state === "disabled") return this.status;
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      this.set({ state: "error", message: error instanceof Error ? error.message.split("\n")[0] : String(error) });
    }
    return this.status;
  }

  install() {
    if (this.status.state === "ready") autoUpdater.quitAndInstall();
  }
}
