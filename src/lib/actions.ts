import { toast } from "sonner";
import { demoTrend } from "./demo";
import { desktopBridge, type CompressQuality } from "./desktop";
import { OFFICE_EXT } from "./file-types";
import { formatBytes, formatNumber } from "./format";
import { createEntry, loadHistory, restorableFiles, type HistoryEntry, type HistoryKind } from "./history";
import { getSource } from "./source";
import { loadCached, useApp } from "./store";
import { loadTrend, recordSnapshot } from "./trend";
import type { BulkResult, LibraryVersionSetting, ScanResult, SiteRef, SpFile } from "./types";

type Progress = (done: number, total: number) => void;

let scanController: AbortController | null = null;

function source() {
  const { mode } = useApp.getState();
  if (!mode) throw new Error("Nicht angemeldet.");
  return getSource(mode);
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}

const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;

/** History and storage trend of a site: persisted in live mode, generated for the demo. */
async function loadSiteData(site: SiteRef, scan: ScanResult, fresh: boolean) {
  const { mode } = useApp.getState();
  if (mode === "demo") {
    useApp.getState().setSiteData({ history: [], trend: scan.quota ? demoTrend(site, scan.quota) : [] });
    return;
  }
  const [history, trend] = await Promise.all([
    loadHistory(site.id),
    fresh && scan.quota ? recordSnapshot(site, scan.quota) : loadTrend(site.id),
  ]);
  if (useApp.getState().site?.id === site.id) useApp.getState().setSiteData({ history, trend });
}

/** Opens a site: uses the cached scan if available (live mode) unless a fresh scan is forced. */
export async function openSite(site: SiteRef, force = false) {
  const store = useApp.getState();
  store.selectSite(site);

  if (!force && store.mode === "live") {
    const cached = await loadCached(site.id);
    if (cached.scan) {
      store.setScan(cached.scan, cached.ai ?? null);
      void loadSiteData(site, cached.scan, false);
      return;
    }
  }

  scanController?.abort();
  const controller = new AbortController();
  scanController = controller;
  store.setProgress({ driveIndex: 0, driveCount: 0, items: 0 });

  try {
    const result = await source().scanSite(site, (p) => useApp.getState().setProgress(p), controller.signal);
    if (!controller.signal.aborted) {
      useApp.getState().setScan(result);
      void loadSiteData(site, result, true);
    }
  } catch (e) {
    useApp.getState().selectSite(null);
    if (!controller.signal.aborted) toast.error("Scan fehlgeschlagen", { description: errorMessage(e) });
  }
}

export function cancelScan() {
  scanController?.abort();
  useApp.getState().selectSite(null);
}

async function refreshQuota() {
  const { site, mode } = useApp.getState();
  if (!site || mode !== "live") return;
  const quota = await getSource(mode).refreshQuota(site).catch(() => undefined);
  useApp.getState().setQuota(quota);
  if (quota) useApp.getState().setTrend(await recordSnapshot(site, quota));
}

function reportFailures(result: BulkResult, verb: string) {
  if (!result.failed.length) return;
  const first = result.failed[0].error;
  toast.error(`${plural(result.failed.length, "Datei konnte", "Dateien konnten")} nicht ${verb} werden`, { description: first });
}

function record(
  kind: HistoryKind,
  files: SpFile[],
  bytes: number,
  extra?: Parameters<typeof createEntry>[3],
  at?: Date,
): HistoryEntry {
  const entry = createEntry(kind, files, bytes, extra, at);
  useApp.getState().pushHistory(entry);
  return entry;
}

/**
 * Updates the state after a delete and offers undo while the files are still in the recycle bin.
 * `startedAt` is when deleting began – restore matches recycle bin items deleted after that moment.
 */
function applyDeletion(
  files: SpFile[],
  result: BulkResult,
  permanent: boolean,
  kind: "delete" | "backup",
  startedAt: Date,
  note?: string,
) {
  const ok = new Set(result.succeeded);
  const deleted = files.filter((f) => ok.has(f.id));
  const freed = deleted.reduce((s, f) => s + f.size, 0);
  useApp.getState().removeFiles(result.succeeded, permanent);
  if (deleted.length) {
    const entry = record(kind, deleted, freed + deleted.reduce((s, f) => s + (f.versionBytes ?? 0), 0), { permanent, note }, startedAt);
    toast.success(`${plural(deleted.length, "Datei", "Dateien")} ${kind === "backup" ? "gesichert und gelöscht" : "gelöscht"}`, {
      description: permanent
        ? `${formatBytes(freed)} sofort freigegeben.`
        : `${formatBytes(freed)} liegen jetzt im Papierkorb – leere ihn, um den Speicher freizugeben.`,
      ...(permanent ? {} : { action: { label: "Rückgängig", onClick: () => void restoreEntryAction(entry.id) }, duration: 10_000 }),
    });
  }
  reportFailures(result, "gelöscht");
  void refreshQuota();
}

export async function deleteFilesAction(files: SpFile[], permanent: boolean, onProgress?: Progress) {
  const startedAt = new Date();
  const result = await source().deleteFiles(files, permanent, onProgress);
  applyDeletion(files, result, permanent, "delete", startedAt);
  return result;
}

/** Puts the files of a history entry back from the recycle bin. */
export async function restoreEntryAction(entryId: string, onProgress?: Progress): Promise<BulkResult | undefined> {
  const { history, site } = useApp.getState();
  const entry = history.find((e) => e.id === entryId);
  if (!entry || !site) return;
  const files = restorableFiles(entry);
  if (!files.length) {
    toast.info("Nichts wiederherzustellen");
    return;
  }
  try {
    const result = await source().restoreFiles(site, files, entry.at, onProgress);
    const ok = new Set(result.succeeded);
    const restored = files.filter((f) => ok.has(f.id));
    useApp.getState().addFiles(restored);
    useApp.getState().markRestored(entry.id, result.succeeded);
    if (restored.length) {
      const bytes = restored.reduce((s, f) => s + f.size, 0);
      record("restore", restored, bytes);
      toast.success(`${plural(restored.length, "Datei", "Dateien")} wiederhergestellt`, {
        description: `${formatBytes(bytes)} sind wieder an ihrem ursprünglichen Ort.`,
      });
    }
    reportFailures(result, "wiederhergestellt");
    void refreshQuota();
    return result;
  } catch (e) {
    toast.error("Wiederherstellen fehlgeschlagen", { description: errorMessage(e) });
  }
}

export async function cleanVersionsAction(files: SpFile[], onProgress?: Progress) {
  const result = await source().cleanVersions(files, onProgress);
  const ok = new Set(result.succeeded);
  const cleaned = files.filter((f) => ok.has(f.id));
  const freed = cleaned.reduce((s, f) => s + (f.versionBytes ?? 0), 0);
  useApp.getState().clearVersions(result.succeeded);
  if (cleaned.length) {
    record("versions", cleaned, freed);
    toast.success(`Versionsverlauf von ${plural(cleaned.length, "Datei", "Dateien")} bereinigt`, {
      description: `${formatBytes(freed)} freigegeben.`,
    });
  }
  reportFailures(result, "bereinigt");
  void refreshQuota();
  return result;
}

/** Reads the version history of the largest files – where old versions hurt most. */
export async function scanVersionsAction(onProgress?: Progress) {
  const { scan } = useApp.getState();
  if (!scan) return;
  const bySize = scan.files.toSorted((a, b) => b.size - a.size);
  const targets = new Map<string, SpFile>();
  for (const f of bySize.slice(0, 300)) targets.set(f.id, f);
  for (const f of bySize.filter((f) => OFFICE_EXT.has(f.ext)).slice(0, 300)) targets.set(f.id, f);

  try {
    const map = await source().scanVersions([...targets.values()], onProgress);
    useApp.getState().applyVersions(map);
    const bytes = [...map.values()].reduce((s, v) => s + v.bytes, 0);
    toast.success("Versionsverlauf analysiert", { description: `${formatBytes(bytes)} in alten Versionen gefunden.` });
  } catch (e) {
    toast.error("Versionsanalyse fehlgeschlagen", { description: errorMessage(e) });
  }
}

export async function emptyRecycleBinAction() {
  const { site, scan } = useApp.getState();
  if (!site) return;
  try {
    const before = scan?.quota?.deleted ?? 0;
    const { secondStage } = await source().emptyRecycleBin(site);
    useApp.getState().recycleBinEmptied(secondStage);
    if (secondStage) {
      record("recycle-bin", [], before);
      toast.success("Papierkorb geleert", { description: "Der Speicher ist freigegeben." });
    } else {
      record("recycle-bin", [], 0, { note: "Nur Stufe 1 – Stufe 2 erfordert Websitesammlungs-Adminrechte" });
      toast.warning("Papierkorb (Stufe 1) geleert", {
        description: "Für den endgültigen Papierkorb (Stufe 2) sind Websitesammlungs-Adminrechte nötig.",
      });
    }
    void refreshQuota();
  } catch (e) {
    toast.error("Papierkorb konnte nicht geleert werden", { description: errorMessage(e) });
  }
}

/* --------------------------------------------------------- version limits */

export async function loadVersionSettings(): Promise<LibraryVersionSetting[]> {
  const { site, scan } = useApp.getState();
  if (!site || !scan) return [];
  return source().getVersionSettings(site, scan.drives);
}

export async function setVersionLimitAction(setting: LibraryVersionSetting, limit: number) {
  const { site } = useApp.getState();
  if (!site) return false;
  try {
    await source().setVersionLimit(site, setting, limit);
    record("version-limit", [], 0, { note: `${setting.driveName}: höchstens ${formatNumber(limit)} Versionen` });
    toast.success(`Versionslimit für „${setting.driveName}“ gesetzt`, {
      description: `Ab sofort höchstens ${formatNumber(limit)} Versionen pro Datei.`,
    });
    return true;
  } catch (e) {
    toast.error("Versionslimit konnte nicht gesetzt werden", { description: errorMessage(e) });
    return false;
  }
}

/* ------------------------------------------------- backup & delete (desktop) */

export function canUseDesktopFeatures() {
  return Boolean(desktopBridge());
}

/** Downloads the files into a local folder (keeping the folder structure), then deletes what was saved. */
export async function backupAndDeleteAction(
  files: SpFile[],
  { folder, permanent }: { folder: string; permanent: boolean },
  onProgress?: (phase: "download" | "delete", done: number, total: number) => void,
) {
  const bridge = desktopBridge();
  if (!bridge) throw new Error("Nur in der Desktop-App verfügbar.");
  const { mode } = useApp.getState();
  const saved: SpFile[] = [];
  const failed: BulkResult["failed"] = [];

  for (let i = 0; i < files.length; i += 20) {
    const chunk = files.slice(i, i + 20);
    const urls = await source().getDownloadUrls(chunk);
    const jobs = chunk.flatMap((f) => {
      const url = urls.get(f.id);
      if (!url) {
        failed.push({ id: f.id, error: "Download-Link nicht verfügbar" });
        return [];
      }
      return [{ id: f.id, url, relativePath: `${f.path}/${f.name}`, size: mode === "live" ? f.size : undefined }];
    });
    const res = await bridge.downloadFiles(folder, jobs);
    const ok = new Set(res.succeeded);
    saved.push(...chunk.filter((f) => ok.has(f.id)));
    failed.push(...res.failed);
    onProgress?.("download", Math.min(i + chunk.length, files.length), files.length);
  }

  if (failed.length) {
    toast.error(`${plural(failed.length, "Datei konnte", "Dateien konnten")} nicht gesichert werden – sie bleiben in SharePoint`, {
      description: failed[0].error,
    });
  }
  if (!saved.length) return { succeeded: [], failed };

  const startedAt = new Date();
  const result = await source().deleteFiles(saved, permanent, (d, t) => onProgress?.("delete", d, t));
  applyDeletion(saved, result, permanent, "backup", startedAt, `Gesichert in ${folder}`);
  return { succeeded: result.succeeded, failed: [...failed, ...result.failed] };
}

/* -------------------------------------------------- compress media (desktop) */

export interface CompressOutcome {
  file: SpFile;
  status: "done" | "skipped" | "failed";
  before: number;
  after?: number;
  error?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Re-encodes videos/images locally, uploads the result as a new version of the same file and deletes
 * the old versions – only then is the space actually released. Optionally keeps the originals locally.
 */
export async function compressFilesAction(
  files: SpFile[],
  { quality, backupFolder }: { quality: CompressQuality; backupFolder?: string },
  onFile?: (index: number, outcome?: CompressOutcome) => void,
): Promise<CompressOutcome[]> {
  const { mode } = useApp.getState();
  const bridge = desktopBridge();
  const outcomes: CompressOutcome[] = [];

  for (const [index, file] of files.entries()) {
    onFile?.(index);
    const kind = file.category === "video" ? "video" : "image";
    let outcome: CompressOutcome;
    try {
      if (mode === "demo") {
        await sleep(450);
        const ratio = kind === "video" ? (quality === "strong" ? 0.28 : 0.42) : quality === "strong" ? 0.4 : 0.6;
        outcome = { file, status: "done", before: file.size, after: Math.round(file.size * ratio) };
      } else {
        if (!bridge) throw new Error("Nur in der Desktop-App verfügbar.");
        const url = (await source().getDownloadUrls([file])).get(file.id);
        if (!url) throw new Error("Download-Link nicht verfügbar");
        const res = await bridge.compressFile({
          url,
          name: file.name,
          kind,
          quality,
          ...(backupFolder ? { backupFolder, relativePath: `${file.path}/${file.name}` } : {}),
        });
        if (res.compressedBytes > res.originalBytes * 0.9) {
          await bridge.discardFile(res.tempId);
          outcome = { file, status: "skipped", before: res.originalBytes, after: res.compressedBytes };
        } else {
          await bridge.uploadFile(res.tempId, await source().createUploadSession(file));
          // the original is now an old version – delete it, otherwise nothing is freed
          const cleaned = await source().cleanVersions([file]);
          if (cleaned.failed.length) throw new Error(`Hochgeladen, aber alte Versionen nicht gelöscht: ${cleaned.failed[0].error}`);
          outcome = { file, status: "done", before: res.originalBytes, after: res.compressedBytes };
        }
      }
    } catch (e) {
      outcome = { file, status: "failed", before: file.size, error: errorMessage(e) };
    }
    outcomes.push(outcome);
    onFile?.(index, outcome);
  }

  const done = outcomes.filter((o) => o.status === "done");
  const sizes = new Map(done.map((o) => [o.file.id, o.after!]));
  const freed = done.reduce((s, o) => s + o.before - o.after! + (o.file.versionBytes ?? 0), 0);
  if (done.length) {
    useApp.getState().updateFiles(sizes, freed);
    record("compress", done.map((o) => o.file), freed, { note: quality === "strong" ? "Starke Komprimierung" : "Ausgewogene Komprimierung" });
    toast.success(`${plural(done.length, "Datei", "Dateien")} komprimiert`, { description: `${formatBytes(freed)} freigegeben.` });
    void refreshQuota();
  }
  return outcomes;
}

/* ---------------------------------------------------------------- retention */

export interface RetentionCheck {
  /** labelled as record – cannot be deleted, skipped */
  blocked: { file: SpFile; label: string }[];
  /** deletable, but retained: the space stays used in the Preservation Hold Library until the period ends */
  retained: { file: SpFile; label: string }[];
  checked: number;
}

/** Checks retention labels before deleting (up to 1000 files, the largest first). */
export async function checkRetention(files: SpFile[]): Promise<RetentionCheck> {
  const subset = files.toSorted((a, b) => b.size - a.size).slice(0, 1000);
  const labels = await source().getRetentionLabels(subset);
  const blocked: RetentionCheck["blocked"] = [];
  const retained: RetentionCheck["retained"] = [];
  for (const f of subset) {
    const info = labels.get(f.id);
    if (!info) continue;
    if (!info.deleteAllowed) blocked.push({ file: f, label: info.name });
    else if (info.retains) retained.push({ file: f, label: info.name });
  }
  return { blocked, retained, checked: subset.length };
}

export async function loadPreservationHold() {
  const { site } = useApp.getState();
  if (!site) return null;
  return source().getPreservationHold(site);
}
