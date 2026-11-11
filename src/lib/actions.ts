import { toast } from "sonner";
import { OFFICE_EXT } from "./file-types";
import { formatBytes } from "./format";
import { getSource } from "./source";
import { loadCached, useApp } from "./store";
import type { BulkResult, SiteRef, SpFile } from "./types";

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

/** Opens a site: uses the cached scan if available (live mode) unless a fresh scan is forced. */
export async function openSite(site: SiteRef, force = false) {
  const store = useApp.getState();
  store.selectSite(site);

  if (!force && store.mode === "live") {
    const cached = await loadCached(site.id);
    if (cached.scan) {
      store.setScan(cached.scan, cached.ai ?? null);
      return;
    }
  }

  scanController?.abort();
  const controller = new AbortController();
  scanController = controller;
  store.setProgress({ driveIndex: 0, driveCount: 0, items: 0 });

  try {
    const result = await source().scanSite(site, (p) => useApp.getState().setProgress(p), controller.signal);
    if (!controller.signal.aborted) useApp.getState().setScan(result);
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
}

function reportFailures(result: BulkResult, verb: string) {
  if (!result.failed.length) return;
  const first = result.failed[0].error;
  toast.error(`${result.failed.length} Dateien konnten nicht ${verb} werden`, { description: first });
}

export async function deleteFilesAction(files: SpFile[], permanent: boolean, onProgress?: Progress) {
  const result = await source().deleteFiles(files, permanent, onProgress);
  const ok = new Set(result.succeeded);
  const freed = files.filter((f) => ok.has(f.id)).reduce((s, f) => s + f.size, 0);
  useApp.getState().removeFiles(result.succeeded, permanent);
  if (result.succeeded.length) {
    toast.success(`${result.succeeded.length} Dateien gelöscht`, {
      description: permanent
        ? `${formatBytes(freed)} sofort freigegeben.`
        : `${formatBytes(freed)} liegen jetzt im Papierkorb – leere ihn, um den Speicher freizugeben.`,
    });
  }
  reportFailures(result, "gelöscht");
  void refreshQuota();
  return result;
}

export async function cleanVersionsAction(files: SpFile[], onProgress?: Progress) {
  const result = await source().cleanVersions(files, onProgress);
  const ok = new Set(result.succeeded);
  const freed = files.filter((f) => ok.has(f.id)).reduce((s, f) => s + (f.versionBytes ?? 0), 0);
  useApp.getState().clearVersions(result.succeeded);
  if (result.succeeded.length) {
    toast.success(`Versionsverlauf von ${result.succeeded.length} Dateien bereinigt`, {
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
  const { site } = useApp.getState();
  if (!site) return;
  try {
    const { secondStage } = await source().emptyRecycleBin(site);
    useApp.getState().recycleBinEmptied(secondStage);
    if (secondStage) toast.success("Papierkorb geleert", { description: "Der Speicher ist freigegeben." });
    else
      toast.warning("Papierkorb (Stufe 1) geleert", {
        description: "Für den endgültigen Papierkorb (Stufe 2) sind Websitesammlungs-Adminrechte nötig.",
      });
    void refreshQuota();
  } catch (e) {
    toast.error("Papierkorb konnte nicht geleert werden", { description: errorMessage(e) });
  }
}
