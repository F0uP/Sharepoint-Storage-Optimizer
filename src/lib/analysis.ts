import { CATEGORY_ORDER, INSTALLER_EXT, RAW_IMAGE_EXT } from "./file-types";
import { ageInYears, formatNumber } from "./format";
import type { AiResult, FileCategory, Quota, SpFile } from "./types";

const MB = 1024 ** 2;

export interface CategoryStat {
  category: FileCategory;
  count: number;
  bytes: number;
}

export function categoryStats(files: SpFile[]): CategoryStat[] {
  const map = new Map<FileCategory, CategoryStat>(CATEGORY_ORDER.map((c) => [c, { category: c, count: 0, bytes: 0 }]));
  for (const f of files) {
    const s = map.get(f.category)!;
    s.count++;
    s.bytes += f.size;
  }
  return CATEGORY_ORDER.map((c) => map.get(c)!);
}

export interface FolderStat {
  path: string;
  bytes: number;
  count: number;
}

/** Aggregates file sizes per folder at the given depth (library = depth 1). */
export function folderStats(files: SpFile[], depth = 2, limit = 8): FolderStat[] {
  const map = new Map<string, FolderStat>();
  for (const f of files) {
    const key = f.path.split("/").slice(0, depth).join("/");
    const s = map.get(key) ?? { path: key, bytes: 0, count: 0 };
    s.bytes += f.size;
    s.count++;
    map.set(key, s);
  }
  return [...map.values()].sort((a, b) => b.bytes - a.bytes).slice(0, limit);
}

export interface AgeStat {
  year: string;
  bytes: number;
  count: number;
}

export function ageStats(files: SpFile[]): AgeStat[] {
  const map = new Map<number, AgeStat>();
  for (const f of files) {
    const y = new Date(f.modified).getFullYear();
    const s = map.get(y) ?? { year: String(y), bytes: 0, count: 0 };
    s.bytes += f.size;
    s.count++;
    map.set(y, s);
  }
  const years = [...map.keys()].sort((a, b) => a - b);
  if (!years.length) return [];
  // fill gaps so the time axis is continuous
  const out: AgeStat[] = [];
  for (let y = years[0]; y <= years[years.length - 1]; y++) out.push(map.get(y) ?? { year: String(y), bytes: 0, count: 0 });
  return out;
}

/* ------------------------------------------------------------------ insights */

export type InsightId = "duplicates" | "videos" | "recordings" | "images" | "stale" | "archives" | "junk" | "versions" | "ai";

export interface InsightRow {
  file: SpFile;
  /** bytes that are freed by acting on this row */
  bytes: number;
  note?: string;
}

export interface Insight {
  id: InsightId;
  title: string;
  description: string;
  action: "delete" | "versions";
  rows: InsightRow[];
  savings: number;
}

/** Office lock files, temp, system and backup leftovers – one expression, tested once per file. */
const JUNK = /^~\$|\.tmp$|^thumbs\.db$|^\.ds_store$|^desktop\.ini$|\.bak$|\.old$|\.crdownload$|\.part$/i;

const RECORDING_NAME = /(meeting recording|besprechungsaufzeichnung|besprechungsaufnahme|aufzeichnung der besprechung)/i;
const RECORDING_FOLDER = /(^|\/)(recordings|aufzeichnungen)(\/|$)/i;

/** Teams stores meeting recordings as MP4 in "Recordings" folders, named "…-Meeting Recording.mp4". */
export function isTeamsRecording(f: SpFile): boolean {
  return f.category === "video" && (RECORDING_NAME.test(f.name) || RECORDING_FOLDER.test(f.path));
}

function bySize(rows: InsightRow[]) {
  return rows.sort((a, b) => b.bytes - a.bytes);
}

function insight(id: InsightId, title: string, description: string, rows: InsightRow[], action: Insight["action"] = "delete"): Insight {
  bySize(rows);
  return { id, title, description, action, rows, savings: rows.reduce((s, r) => s + r.bytes, 0) };
}

/** Adds a file to its hash bucket; a single file is stored as is (most hashes are unique). */
function addToBucket(buckets: Map<string, SpFile | SpFile[]>, f: SpFile) {
  const bucket = buckets.get(f.hash!);
  if (!bucket) buckets.set(f.hash!, f);
  else if (Array.isArray(bucket)) bucket.push(f);
  else buckets.set(f.hash!, [bucket, f]);
}

/** Same text → same string: a large site would otherwise create hundreds of thousands of identical notes. */
function memoNote(make: (n: number) => string) {
  const notes = new Map<number, string>();
  return (n: number) => {
    let note = notes.get(n);
    if (note === undefined) notes.set(n, (note = make(n)));
    return note;
  };
}

/**
 * Rule-based findings. One pass over all files – sites can hold a million of them, and the result is
 * recomputed whenever the file list changes.
 */
export function computeInsights(files: SpFile[], now = Date.now()): Insight[] {
  const staleNote = memoNote((years) => `Seit ${years} Jahren unverändert`);
  const recordedNote = memoNote((days) => `Aufgezeichnet vor ${formatNumber(days)} Tagen`);
  const versionsNote = memoNote((count) => `${formatNumber(count)} Versionen`);
  // duplicates: identical content hash + size → keep the oldest copy
  const buckets = new Map<string, SpFile | SpFile[]>();
  const recordings: InsightRow[] = [];
  const videos: InsightRow[] = [];
  const images: InsightRow[] = [];
  const stale: InsightRow[] = [];
  const archives: InsightRow[] = [];
  const junk: InsightRow[] = [];
  const versions: InsightRow[] = [];

  for (const f of files) {
    if (f.hash && f.size >= 1024) addToBucket(buckets, f);

    if (f.category === "video") {
      if (isTeamsRecording(f)) {
        const days = Math.floor((now - Date.parse(f.created)) / 864e5);
        recordings.push({ file: f, bytes: f.size, note: days >= 1 ? recordedNote(days) : undefined });
      } else if (f.size >= 100 * MB) {
        videos.push({ file: f, bytes: f.size, note: f.size >= 1024 * MB ? "Komprimieren spart oft 60–80 %" : undefined });
      }
    } else if (f.category === "image" && (f.size >= 15 * MB || (RAW_IMAGE_EXT.has(f.ext) && f.size >= 5 * MB))) {
      images.push({ file: f, bytes: f.size, note: RAW_IMAGE_EXT.has(f.ext) ? `RAW/Arbeitsdatei (.${f.ext})` : undefined });
    }

    if (f.size >= 10 * MB) {
      const age = ageInYears(f.modified, now);
      if (age >= 2) stale.push({ file: f, bytes: f.size, note: staleNote(Math.floor(age)) });
      if (f.category === "archive" || INSTALLER_EXT.has(f.ext)) {
        archives.push({ file: f, bytes: f.size, note: INSTALLER_EXT.has(f.ext) ? "Installationsdatei" : "Archiv" });
      }
    }

    if (JUNK.test(f.name)) junk.push({ file: f, bytes: f.size, note: f.name.startsWith("~$") ? "Office-Sperrdatei" : "Temporär / System" });
    if ((f.versionBytes ?? 0) > 0) versions.push({ file: f, bytes: f.versionBytes!, note: versionsNote(f.versionCount ?? 0) });
  }

  const duplicateRows: InsightRow[] = [];
  for (const bucket of buckets.values()) {
    if (!Array.isArray(bucket)) continue;
    // the same hash with a different size is a different file
    const bySize = new Map<number, SpFile[]>();
    for (const f of bucket) {
      const same = bySize.get(f.size);
      if (same) same.push(f);
      else bySize.set(f.size, [f]);
    }
    for (const g of bySize.values()) {
      if (g.length < 2) continue;
      const [original, ...copies] = g.toSorted((a, b) => Date.parse(a.created) - Date.parse(b.created));
      for (const c of copies) duplicateRows.push({ file: c, bytes: c.size, note: `Original: ${original.path}/${original.name}` });
    }
  }

  return [
    insight("duplicates", "Doppelte Dateien", "Identischer Inhalt an mehreren Orten. Das jeweils älteste Exemplar bleibt erhalten.", duplicateRows),
    insight("versions", "Versionsverlauf", "Alte Versionen belegen Speicher, ohne sichtbar zu sein. Die aktuelle Version bleibt erhalten.", versions, "versions"),
    insight("recordings", "Teams-Aufnahmen", "Besprechungsaufzeichnungen aus Teams – meist nur wenige Wochen relevant.", recordings),
    insight("videos", "Große Videos", "Videos ab 100 MB – komprimieren, archivieren oder löschen.", videos),
    insight("stale", "Lange nicht genutzt", "Dateien ab 10 MB, die seit mehr als 2 Jahren nicht geändert wurden.", stale),
    insight("archives", "Archive & Installer", "ZIP-, ISO- und Setup-Dateien ab 10 MB – meist Einmal-Downloads oder Backups.", archives),
    insight("images", "Große Bilder & RAW", "Bilder ab 15 MB sowie RAW- und Arbeitsdateien (PSD, TIFF …).", images),
    insight("junk", "Temporäre Dateien", "Sperr-, Temp- und Systemdateien wie ~$…, Thumbs.db, .DS_Store.", junk),
  ];
}

/** The AI's delete recommendations as a regular insight (empty until an analysis has run). */
export function aiInsight(files: SpFile[], ai: AiResult | null): Insight {
  const byId = new Map(files.map((f) => [f.id, f]));
  const rows: InsightRow[] = (ai?.recommendations ?? []).flatMap((r) => {
    const file = r.action === "delete" ? byId.get(r.fileId) : undefined;
    return file ? [{ file, bytes: file.size, note: r.reason }] : [];
  });
  return insight("ai", "KI-Löschempfehlungen", "Dateien, die die KI-Analyse als verzichtbar eingestuft hat – mit Begründung.", rows);
}

export interface PotentialSummary {
  /** everything that could be freed (all insights + recycle bin) */
  bytes: number;
  files: number;
  recycleBin: number;
  /** low-risk share: duplicates, temp files, old versions and the recycle bin */
  safeBytes: number;
}

const LOW_RISK: InsightId[] = ["duplicates", "junk", "versions"];

/** Total reclaimable space without double counting files that appear in several insights. */
export function potential(insights: Insight[], quota?: Quota): PotentialSummary {
  const counted = new Set<string>();
  let fileBytes = 0;
  let versionBytes = 0;
  for (const i of insights) {
    for (const r of i.rows) {
      if (i.action === "versions") versionBytes += r.bytes;
      else if (!counted.has(r.file.id)) {
        counted.add(r.file.id);
        fileBytes += r.file.size;
      }
    }
  }
  const recycleBin = quota?.deleted ?? 0;
  const safeBytes = insights.filter((i) => LOW_RISK.includes(i.id)).reduce((s, i) => s + i.savings, 0) + recycleBin;
  return { bytes: fileBytes + versionBytes + recycleBin, files: counted.size, recycleBin, safeBytes };
}

/**
 * The `count` largest items (largest first; equal sizes keep their order) – without sorting a whole site.
 * A min-heap of `count` entries: O(n log count) instead of O(n log n).
 */
export function largest<T>(items: Iterable<T>, count: number, size: (item: T) => number, keep: (item: T) => boolean = () => true): T[] {
  type Entry = { item: T; size: number; order: number };
  // "smaller" = less wanted: smaller size, or later in the input at equal size
  const less = (a: Entry, b: Entry) => a.size < b.size || (a.size === b.size && a.order > b.order);
  const heap: Entry[] = [];
  const swap = (i: number, j: number) => ([heap[i], heap[j]] = [heap[j], heap[i]]);
  const down = (i: number) => {
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < heap.length && less(heap[l], heap[m])) m = l;
      if (r < heap.length && less(heap[r], heap[m])) m = r;
      if (m === i) return;
      swap(i, m);
      i = m;
    }
  };
  if (count <= 0) return [];
  let order = 0;
  for (const item of items) {
    if (!keep(item)) continue;
    const entry = { item, size: size(item), order: order++ };
    if (heap.length < count) {
      heap.push(entry);
      for (let i = heap.length - 1; i > 0 && less(heap[i], heap[(i - 1) >> 1]); i = (i - 1) >> 1) swap(i, (i - 1) >> 1);
    } else if (less(heap[0], entry)) {
      heap[0] = entry;
      down(0);
    }
  }
  return heap.sort((a, b) => b.size - a.size || a.order - b.order).map((e) => e.item);
}
