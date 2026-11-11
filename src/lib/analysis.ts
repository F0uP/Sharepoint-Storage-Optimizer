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

export type InsightId = "duplicates" | "videos" | "images" | "stale" | "archives" | "junk" | "versions" | "ai";

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

const JUNK_PATTERNS = [/^~\$/, /\.tmp$/i, /^thumbs\.db$/i, /^\.ds_store$/i, /^desktop\.ini$/i, /\.bak$/i, /\.old$/i, /\.crdownload$/i, /\.part$/i, /^~.*\.tmp$/i];

function bySize(rows: InsightRow[]) {
  return rows.sort((a, b) => b.bytes - a.bytes);
}

function insight(id: InsightId, title: string, description: string, rows: InsightRow[], action: Insight["action"] = "delete"): Insight {
  bySize(rows);
  return { id, title, description, action, rows, savings: rows.reduce((s, r) => s + r.bytes, 0) };
}

export function computeInsights(files: SpFile[], now = Date.now()): Insight[] {
  // duplicates: identical content hash + size → keep the oldest copy
  const groups = new Map<string, SpFile[]>();
  for (const f of files) {
    if (!f.hash || f.size < 1024) continue;
    const key = `${f.hash}:${f.size}`;
    const g = groups.get(key);
    if (g) g.push(f);
    else groups.set(key, [f]);
  }
  const duplicateRows: InsightRow[] = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const [original, ...copies] = g.toSorted((a, b) => Date.parse(a.created) - Date.parse(b.created));
    for (const c of copies) duplicateRows.push({ file: c, bytes: c.size, note: `Original: ${original.path}/${original.name}` });
  }

  const videos = files
    .filter((f) => f.category === "video" && f.size >= 100 * MB)
    .map((f) => ({ file: f, bytes: f.size, note: f.size >= 1024 * MB ? "Komprimieren spart oft 60–80 %" : undefined }));

  const images = files
    .filter((f) => f.category === "image" && (f.size >= 15 * MB || (RAW_IMAGE_EXT.has(f.ext) && f.size >= 5 * MB)))
    .map((f) => ({ file: f, bytes: f.size, note: RAW_IMAGE_EXT.has(f.ext) ? `RAW/Arbeitsdatei (.${f.ext})` : undefined }));

  const stale = files
    .filter((f) => f.size >= 10 * MB && ageInYears(f.modified, now) >= 2)
    .map((f) => ({ file: f, bytes: f.size, note: `Seit ${Math.floor(ageInYears(f.modified, now))} Jahren unverändert` }));

  const archives = files
    .filter((f) => (f.category === "archive" || INSTALLER_EXT.has(f.ext)) && f.size >= 10 * MB)
    .map((f) => ({ file: f, bytes: f.size, note: INSTALLER_EXT.has(f.ext) ? "Installationsdatei" : "Archiv" }));

  const junk = files
    .filter((f) => JUNK_PATTERNS.some((p) => p.test(f.name)))
    .map((f) => ({ file: f, bytes: f.size, note: f.name.startsWith("~$") ? "Office-Sperrdatei" : "Temporär / System" }));

  const versions = files
    .filter((f) => (f.versionBytes ?? 0) > 0)
    .map((f) => ({ file: f, bytes: f.versionBytes!, note: `${formatNumber(f.versionCount ?? 0)} Versionen` }));

  return [
    insight("duplicates", "Doppelte Dateien", "Identischer Inhalt an mehreren Orten. Das jeweils älteste Exemplar bleibt erhalten.", duplicateRows),
    insight("versions", "Versionsverlauf", "Alte Versionen belegen Speicher, ohne sichtbar zu sein. Die aktuelle Version bleibt erhalten.", versions, "versions"),
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
  const fileIds = new Map<string, number>();
  let versionBytes = 0;
  for (const i of insights) {
    for (const r of i.rows) {
      if (i.action === "versions") versionBytes += r.bytes;
      else fileIds.set(r.file.id, r.file.size);
    }
  }
  const fileBytes = [...fileIds.values()].reduce((s, b) => s + b, 0);
  const recycleBin = quota?.deleted ?? 0;
  const safeBytes = insights.filter((i) => LOW_RISK.includes(i.id)).reduce((s, i) => s + i.savings, 0) + recycleBin;
  return { bytes: fileBytes + versionBytes + recycleBin, files: fileIds.size, recycleBin, safeBytes };
}
