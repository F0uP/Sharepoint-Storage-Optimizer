import { app } from "electron";
import { autoUpdater } from "electron-updater";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Updates from GitHub Releases (or a generic server). Windows installs updates automatically.
 * macOS can only auto-update signed builds – ad-hoc signed builds just point to the download page.
 *
 * A downloaded update is installed
 * - right away when the user clicks "Jetzt neu starten" (settings, notification, tray menu),
 * - when the window is closed to the tray (silently; the app comes back in the tray),
 * - otherwise when the app quits.
 * Waiting for a quit alone is not enough: in background mode the app hardly ever quits, and when
 * Windows shuts down the app is ended before the installer can run.
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
/** written before an update restart from the tray – the new version then starts in the tray as well */
const HIDDEN_RESTART = "restart-hidden";

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

/** Small log file (userData/logs/updater.log, about 1 MB) – without it a failed update leaves no trace. */
export function fileLogger(file: string) {
  const write = (level: string, args: unknown[]) => {
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      if (existsSync(file) && statSync(file).size > 1_000_000) renameSync(file, `${file}.old`);
      const text = args.map((a) => (a instanceof Error ? (a.stack ?? a.message) : typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      appendFileSync(file, `${new Date().toISOString()} ${level} ${text}\n`);
    } catch {
      // logging must never break updating
    }
  };
  return {
    info: (...args: unknown[]) => write("INFO", args),
    warn: (...args: unknown[]) => write("WARN", args),
    error: (...args: unknown[]) => write("ERROR", args),
    debug: () => {},
  };
}

/** True once after an update restart from the tray: the new version should start hidden again. */
export function consumeHiddenRestart(userData = app.getPath("userData")): boolean {
  const flag = path.join(userData, HIDDEN_RESTART);
  if (!existsSync(flag)) return false;
  rmSync(flag, { force: true });
  return true;
}

export class Updates {
  status: UpdateStatus = { state: "disabled" };
  private mode: "auto" | "notify" = "auto";

  constructor(
    private readonly publish: (status: UpdateStatus) => void,
    /** a downloaded update is ready to be installed */
    private readonly onReady: (version: string | undefined) => void = () => {},
  ) {}

  private set(status: UpdateStatus) {
    this.status = { mode: this.mode, releaseUrl: releasesUrl(), ...status };
    this.publish(this.status);
  }

  get ready() {
    return this.status.state === "ready";
  }

  init() {
    // app-update.yml is written by electron-builder only when a publish target is configured
    if (!app.isPackaged || !existsSync(path.join(process.resourcesPath, "app-update.yml"))) return;
    this.mode = isAdHocSignedMac() ? "notify" : "auto";
    autoUpdater.autoDownload = this.mode === "auto";
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = fileLogger(path.join(app.getPath("userData"), "logs", "updater.log"));

    autoUpdater.on("checking-for-update", () => this.set({ state: "checking" }));
    autoUpdater.on("update-not-available", () => this.set({ state: "none" }));
    autoUpdater.on("update-available", (info) =>
      this.set({ state: this.mode === "auto" ? "downloading" : "available", version: info.version, percent: 0 }),
    );
    autoUpdater.on("download-progress", (p) => this.set({ state: "downloading", version: this.status.version, percent: Math.round(p.percent) }));
    autoUpdater.on("update-downloaded", (info) => {
      this.set({ state: "ready", version: info.version });
      this.onReady(info.version);
    });
    autoUpdater.on("error", (error) => {
      // a failed check must not hide an update that is already downloaded
      if (!this.ready) this.set({ state: "error", message: error.message.split("\n")[0] });
    });

    this.status = { state: "idle", mode: this.mode, releaseUrl: releasesUrl() };
    setTimeout(() => void this.check(), 15_000);
    setInterval(() => void this.check(), SIX_HOURS);
  }

  async check(): Promise<UpdateStatus> {
    // nothing to do: updates off, a check or download is running, or the update waits for the restart
    if (["disabled", "checking", "downloading", "ready"].includes(this.status.state)) return this.status;
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      this.set({ state: "error", message: error instanceof Error ? error.message.split("\n")[0] : String(error) });
    }
    return this.status;
  }

  /**
   * Quits, installs silently and starts the new version. `hidden`: the app was in the tray – the new
   * version starts there again instead of opening a window.
   */
  install({ hidden = false }: { hidden?: boolean } = {}) {
    if (!this.ready) return;
    if (hidden) {
      try {
        writeFileSync(path.join(app.getPath("userData"), HIDDEN_RESTART), "");
      } catch {
        // then the window simply opens after the update
      }
    }
    autoUpdater.quitAndInstall(true, true);
  }
}
