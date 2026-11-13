import { get as idbGet, set as idbSet } from "idb-keyval";
import type { SpFile } from "./types";

/** Everything the app changed in SharePoint – shown in "Verlauf", the basis for undo and the report. */
export type HistoryKind =
  | "delete"
  | "backup"
  | "versions"
  | "recycle-bin"
  | "compress"
  | "version-limit"
  | "restore"
  | "notify";

export interface HistoryEntry {
  id: string;
  at: string;
  kind: HistoryKind;
  /** affected files as they were before the action (needed to put restored files back) */
  files: SpFile[];
  fileCount: number;
  /** bytes released from the quota (or moved to the recycle bin for non-permanent deletes) */
  bytes: number;
  permanent?: boolean;
  restoredIds?: string[];
  note?: string;
}

const MAX_ENTRIES = 100;
const MAX_FILES = 5000;
/** SharePoint keeps deleted items 93 days (both recycle bin stages together). */
const RECYCLE_DAYS = 93;

let counter = 0;

export function createEntry(
  kind: HistoryKind,
  files: SpFile[],
  bytes: number,
  extra: Partial<Pick<HistoryEntry, "permanent" | "note">> = {},
  at = new Date(),
): HistoryEntry {
  return {
    id: `${at.getTime().toString(36)}-${(counter++).toString(36)}`,
    at: at.toISOString(),
    kind,
    files: files.slice(0, MAX_FILES),
    fileCount: files.length,
    bytes,
    ...extra,
  };
}

/** Newest first, capped. */
export function addEntry(entries: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return [entry, ...entries].slice(0, MAX_ENTRIES);
}

export function restorableFiles(entry: HistoryEntry, now = Date.now()): SpFile[] {
  if ((entry.kind !== "delete" && entry.kind !== "backup") || entry.permanent) return [];
  if (now - Date.parse(entry.at) > RECYCLE_DAYS * 864e5) return [];
  const restored = new Set(entry.restoredIds ?? []);
  return entry.files.filter((f) => !restored.has(f.id));
}

/** Bytes actually released from the quota by all actions (recycle bin moves don't count until emptied). */
export function totalFreed(entries: HistoryEntry[]): number {
  return entries.reduce((sum, e) => {
    switch (e.kind) {
      case "versions":
      case "recycle-bin":
      case "compress":
        return sum + e.bytes;
      case "delete":
      case "backup":
        return sum + (e.permanent ? e.bytes : 0);
      default:
        return sum;
    }
  }, 0);
}

const key = (siteId: string) => `history:${siteId}`;

export async function loadHistory(siteId: string): Promise<HistoryEntry[]> {
  try {
    return (await idbGet<HistoryEntry[]>(key(siteId))) ?? [];
  } catch {
    return [];
  }
}

export function saveHistory(siteId: string, entries: HistoryEntry[]) {
  idbSet(key(siteId), entries).catch(() => {});
}
