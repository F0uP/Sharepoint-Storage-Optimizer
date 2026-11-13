import { categorize, getExtension, OFFICE_EXT } from "./file-types";
import { formatBytes } from "./format";
import type { Snapshot } from "./trend";
import type {
  BulkResult,
  DriveSummary,
  FileCategory,
  LibraryVersionSetting,
  OwnerMail,
  Quota,
  RetentionInfo,
  ScanProgress,
  ScanResult,
  SiteRef,
  SpFile,
} from "./types";

/** Deterministic PRNG so the demo looks the same on every load. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MB = 1024 ** 2;
const GB = 1024 ** 3;

/** version history per demo file, generated together with the files */
const DEMO_VERSIONS = new Map<string, { count: number; bytes: number }>();

export const DEMO_SITES: SiteRef[] = [
  { id: "demo-marketing", name: "Marketing & Kommunikation", webUrl: "https://contoso.sharepoint.com/sites/marketing", description: "Kampagnen, Fotos, Videos und Pressematerial" },
  { id: "demo-projekte", name: "Projekte", webUrl: "https://contoso.sharepoint.com/sites/projekte", description: "Projektdokumentation und Lieferobjekte" },
  { id: "demo-hr", name: "Personal", webUrl: "https://contoso.sharepoint.com/sites/personal", description: "Richtlinien, Schulungen, Vorlagen" },
  { id: "demo-it", name: "IT & Infrastruktur", webUrl: "https://contoso.sharepoint.com/sites/it", description: "Handbücher, Images, Installationsquellen" },
  { id: "demo-vertrieb", name: "Vertrieb", webUrl: "https://contoso.sharepoint.com/sites/vertrieb", description: "Angebote, Präsentationen, Kundenunterlagen" },
  { id: "demo-service", name: "Kundenservice", webUrl: "https://contoso.sharepoint.com/sites/service", description: "Schulungsvideos, FAQ, Vorlagen" },
  { id: "demo-qm", name: "Qualitätsmanagement", webUrl: "https://contoso.sharepoint.com/sites/qm", description: "Audits, Zertifikate, Prozessdokumentation" },
  { id: "demo-gf", name: "Geschäftsführung", webUrl: "https://contoso.sharepoint.com/sites/gf", description: "Berichte und Beschlüsse" },
];

/** Sites without changes for a long time – suggested for archiving in the overall analysis. */
const INACTIVE_SITES = new Set(["demo-gf", "demo-qm"]);
const INACTIVE_SINCE = Date.parse("2025-03-14T10:00:00Z");

for (const site of DEMO_SITES) {
  site.lastModified = INACTIVE_SITES.has(site.id) ? new Date(INACTIVE_SINCE).toISOString() : new Date(Date.now() - 2 * 864e5).toISOString();
}

/** Files that exist in several sites – found by the cross-site duplicate check. */
const SHARED_FILES = [
  { name: "Imagefilm 2024 final.mp4", folder: "Videos/Kampagnen", size: 2.4 * GB, sites: 6 },
  { name: "Messe-Rundgang 2024.mp4", folder: "Videos/Kampagnen", size: 1.6 * GB, sites: 4 },
  { name: "Firmenpräsentation 2025.pptx", folder: "Präsentationen", size: 186 * MB, sites: 8 },
  { name: "Logo-Paket komplett.zip", folder: "Design", size: 740 * MB, sites: 5 },
  { name: "Mitarbeiterhandbuch.pdf", folder: "Dokumente", size: 48 * MB, sites: 7 },
];

/** Number of generated files per demo site (drives the site's size). */
const FILE_COUNT: Record<string, number> = {
  "demo-marketing": 3200,
  "demo-projekte": 1800,
  "demo-hr": 900,
  "demo-it": 2400,
  "demo-vertrieb": 1400,
  "demo-service": 1100,
  "demo-qm": 700,
  "demo-gf": 450,
};

const PEOPLE = ["Anna Weber", "Jonas Keller", "Lea Hoffmann", "Max Braun", "Sophie Wagner", "Felix Schulz", "Mara Fischer"];
const emailOf = (name: string) => `${name.toLowerCase().replace(/\s+/g, ".")}@contoso.com`;
const idOf = (name: string) => `00000000-0000-4000-8000-${String(PEOPLE.indexOf(name) + 1).padStart(12, "0")}`;

interface Template {
  folder: string;
  names: string[];
  ext: string[];
  /** median size in bytes */
  median: number;
  spread: number;
  weight: number;
}

const TEMPLATES: Template[] = [
  { folder: "Videos/Kampagnen", names: ["Imagefilm", "Produktvideo", "Teaser", "Interview", "Messe-Rundgang", "Webinar-Aufzeichnung", "Kundenstimme"], ext: ["mp4", "mov", "mp4", "mkv"], median: 420 * MB, spread: 1.1, weight: 4 },
  { folder: "Recordings", names: ["Weekly Sync", "Jour fixe", "Kundentermin", "All Hands", "Sprint Review", "Projekt-Kickoff"], ext: ["mp4"], median: 260 * MB, spread: 0.7, weight: 3 },
  { folder: "Videos/Rohmaterial", names: ["DJI_", "C0", "GX0", "MVI_", "Clip_"], ext: ["mov", "mp4", "mts"], median: 1.6 * GB, spread: 0.8, weight: 2 },
  { folder: "Fotos/Events", names: ["IMG_", "DSC0", "Event_", "Sommerfest_", "Messe_"], ext: ["jpg", "jpg", "jpeg", "heic", "png"], median: 6 * MB, spread: 0.8, weight: 14 },
  { folder: "Fotos/Shootings", names: ["Shooting_", "Portrait_", "Produkt_", "_MG_"], ext: ["cr3", "nef", "arw", "dng", "jpg", "tif"], median: 38 * MB, spread: 0.6, weight: 7 },
  { folder: "Design", names: ["Plakat", "Flyer", "Banner", "Keyvisual", "Messestand", "Broschüre"], ext: ["psd", "ai", "pdf", "eps", "png"], median: 140 * MB, spread: 1.0, weight: 4 },
  { folder: "Dokumente", names: ["Konzept", "Protokoll", "Angebot", "Briefing", "Bericht", "Entwurf", "Freigabe", "Pressemitteilung", "Vertrag", "Rechnung"], ext: ["docx", "docx", "pdf", "xlsx", "pptx"], median: 1.2 * MB, spread: 1.2, weight: 30 },
  { folder: "Präsentationen", names: ["Quartalsreview", "Pitch", "Kickoff", "Strategie", "Vertriebsmeeting"], ext: ["pptx", "pptx", "pdf"], median: 28 * MB, spread: 0.9, weight: 7 },
  { folder: "Archiv", names: ["Backup", "Export", "Altdaten", "Projektarchiv", "Sicherung"], ext: ["zip", "zip", "rar", "7z"], median: 900 * MB, spread: 1.0, weight: 3 },
  { folder: "Software", names: ["Setup", "Installer", "Treiber", "Update"], ext: ["exe", "msi", "iso", "dmg"], median: 380 * MB, spread: 1.0, weight: 1 },
  { folder: "Audio", names: ["Podcast_Folge", "Sprachaufnahme", "Jingle", "Interview_Audio"], ext: ["wav", "mp3", "m4a"], median: 85 * MB, spread: 0.9, weight: 2 },
  { folder: "Daten", names: ["Auswertung", "Export", "Kundenliste", "Statistik", "Budget"], ext: ["xlsx", "csv", "xlsx"], median: 3 * MB, spread: 1.3, weight: 8 },
];

const SUBFOLDERS = ["2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026"];
const JUNK = ["Thumbs.db", ".DS_Store", "desktop.ini", "~$Konzept.docx", "~$Budget.xlsx", "Kopie.tmp", "alt.bak", "download.crdownload"];

function pick<T>(rnd: () => number, list: T[]): T {
  return list[Math.floor(rnd() * list.length)];
}

function logNormal(rnd: () => number, median: number, spread: number) {
  const u = Math.max(rnd(), 1e-9);
  const v = rnd();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.max(1024, Math.round(median * Math.exp(z * spread)));
}

export function generateDemoScan(site: SiteRef): ScanResult {
  const seed = [...site.id].reduce((s, c) => s * 31 + c.charCodeAt(0), 7);
  const rnd = mulberry32(seed);
  const libraries = ["Dokumente", "Marketing-Assets", "Projektarchiv"];
  const totalWeight = TEMPLATES.reduce((s, t) => s + t.weight, 0);
  const files: SpFile[] = [];
  const now = Date.now();
  const count = FILE_COUNT[site.id] ?? 1800;
  let n = 0;

  const make = (driveName: string, folder: string, name: string, size: number, modified: number, hash?: string): SpFile => {
    const id = `${site.id}-${n++}`;
    const ext = getExtension(name);
    // inactive demo sites: nothing changed after INACTIVE_SINCE
    if (INACTIVE_SITES.has(site.id)) modified = Math.min(modified, INACTIVE_SINCE);
    const modifiedIso = new Date(modified).toISOString();
    const person = pick(rnd, PEOPLE);
    return {
      id,
      driveId: `${site.id}-${driveName}`,
      driveName,
      name,
      ext,
      path: `${driveName}/${folder}`,
      size,
      category: categorize(name),
      created: new Date(modified - rnd() * 90 * 864e5).toISOString(),
      modified: modifiedIso,
      modifiedBy: person,
      modifiedByEmail: emailOf(person),
      modifiedById: idOf(person),
      webUrl: `${site.webUrl}/${encodeURIComponent(driveName)}/${folder.split("/").map(encodeURIComponent).join("/")}/${encodeURIComponent(name)}`,
      hash: hash ?? `h${seed}-${n}`,
    };
  };

  for (let i = 0; i < count; i++) {
    let r = rnd() * totalWeight;
    const t = TEMPLATES.find((tpl) => (r -= tpl.weight) < 0) ?? TEMPLATES[0];
    const driveName = t.folder === "Recordings" ? "Dokumente" : t.folder.startsWith("Videos") || t.folder.startsWith("Fotos") || t.folder === "Design" ? "Marketing-Assets" : t.folder === "Archiv" || t.folder === "Software" ? "Projektarchiv" : pick(rnd, libraries);
    const year = pick(rnd, SUBFOLDERS);
    const folder = `${t.folder}/${year}`;
    const base = pick(rnd, t.names);
    const ext = pick(rnd, t.ext);
    const stamp = () => `${year}${String(1 + Math.floor(rnd() * 12)).padStart(2, "0")}${String(1 + Math.floor(rnd() * 28)).padStart(2, "0")}_${String(8 + Math.floor(rnd() * 9)).padStart(2, "0")}0${Math.floor(rnd() * 6)}12`;
    const name = t.folder === "Recordings"
      ? `${base}-${stamp()}-Besprechungsaufzeichnung.mp4`
      : /_$|0$/.test(base) ? `${base}${String(Math.floor(rnd() * 9000) + 1000)}.${ext}` : `${base} ${year}${rnd() > 0.6 ? ` v${Math.ceil(rnd() * 4)}` : ""}${rnd() > 0.85 ? " final" : ""}.${ext}`;
    const yearStart = Date.UTC(Number(year), 0, 1);
    const modified = Math.min(INACTIVE_SITES.has(site.id) ? INACTIVE_SINCE : now - 864e5, yearStart + rnd() * 365 * 864e5);
    files.push(make(driveName, folder, name, logNormal(rnd, t.median, t.spread), modified));
  }

  // duplicates: copies of existing files in other folders
  const dupSources = files.filter(() => rnd() < 0.045);
  for (const src of dupSources) {
    const copies = 1 + Math.floor(rnd() * 3);
    for (let c = 0; c < copies; c++) {
      const folder = pick(rnd, ["Kopien", "Ablage", "Austausch/Extern", "Alt", "Dokumente/Backup"]);
      const name = rnd() > 0.5 ? src.name : src.name.replace(/(\.[^.]+)$/, ` - Kopie$1`);
      files.push(make(src.driveName, folder, name, src.size, new Date(src.modified).getTime() + rnd() * 30 * 864e5, src.hash));
    }
  }

  // the same files in several sites (cross-site duplicates)
  const siteIndex = DEMO_SITES.findIndex((s) => s.id === site.id);
  SHARED_FILES.forEach((shared, i) => {
    if (siteIndex < 0 || siteIndex >= shared.sites) return;
    const modified = Math.min(INACTIVE_SITES.has(site.id) ? INACTIVE_SINCE : now - 864e5, Date.parse("2025-01-20T09:00:00Z") + i * 864e5);
    files.push(make(siteIndex % 2 ? "Dokumente" : "Marketing-Assets", shared.folder, shared.name, shared.size, modified, `shared-${i}`));
  });

  // junk files
  for (let i = 0; i < 140; i++) {
    const name = pick(rnd, JUNK);
    files.push(make(pick(rnd, libraries), `${pick(rnd, TEMPLATES).folder}/${pick(rnd, SUBFOLDERS)}`, name, logNormal(rnd, 40 * 1024, 1.5), now - rnd() * 6 * 365 * 864e5));
  }

  const drives: DriveSummary[] = libraries.map((name) => {
    const df = files.filter((f) => f.driveName === name);
    return {
      id: `${site.id}-${name}`,
      name,
      webUrl: `${site.webUrl}/${encodeURIComponent(name)}`,
      fileCount: df.length,
      totalBytes: df.reduce((s, f) => s + f.size, 0),
    };
  });

  // hidden version history – revealed by the version scan, but already part of the quota
  let versionBytes = 0;
  for (const f of files) {
    let info = { count: 1, bytes: 0 };
    if (OFFICE_EXT.has(f.ext) && rnd() < 0.65) {
      const count = 2 + Math.floor(rnd() * (rnd() > 0.85 ? 90 : 18));
      info = { count, bytes: Math.round(f.size * (count - 1) * (0.5 + rnd() * 0.4)) };
    } else if (f.category === "video" && rnd() < 0.06) {
      const count = 2 + Math.floor(rnd() * 2);
      info = { count, bytes: f.size * (count - 1) };
    }
    DEMO_VERSIONS.set(f.id, info);
    versionBytes += info.bytes;
  }
  const fileBytes = files.reduce((s, f) => s + f.size, 0);
  const deleted = 42 * GB;
  const used = fileBytes + versionBytes + deleted;
  const total = Math.ceil((used / 0.86) / (100 * GB)) * 100 * GB;
  const quota: Quota = { total, used, remaining: total - used, deleted, state: "nearing" };

  return { site, quota, drives, files, scannedAt: new Date().toISOString() };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const quotaCache = new Map<string, Quota>();

/** Quota of a demo site – derived from the same generator as the scan, so both always agree. */
export function demoQuota(site: SiteRef): Quota {
  let quota = quotaCache.get(site.id);
  if (!quota) {
    quota = generateDemoScan(site).quota!;
    quotaCache.set(site.id, quota);
  }
  return quota;
}

export async function demoSiteQuotas(sites: SiteRef[], onProgress?: (d: number, t: number) => void) {
  const out = new Map<string, Quota | undefined>();
  for (const [i, site] of sites.entries()) {
    await sleep(60);
    out.set(site.id, demoQuota(site));
    onProgress?.(i + 1, sites.length);
  }
  return out;
}

/** Six months of weekly readings that end at the current quota – shows the trend chart in the demo. */
export function demoTrend(site: SiteRef, quota: Quota, now = Date.now()): Snapshot[] {
  const rnd = mulberry32([...site.id].reduce((s, c) => s * 33 + c.charCodeAt(0), 11));
  const weeks = 26;
  const start = quota.used * 0.78;
  return Array.from({ length: weeks + 1 }, (_, i) => {
    const progress = i / weeks;
    const noise = i === weeks ? 0 : (rnd() - 0.5) * quota.used * 0.015;
    return {
      at: new Date(now - (weeks - i) * 7 * 864e5).toISOString(),
      used: Math.round(i === weeks ? quota.used : start + (quota.used - start) * progress + noise),
      total: quota.total,
      deleted: Math.round(quota.deleted * (0.4 + 0.6 * progress)),
    };
  });
}

const versionSettings = new Map<string, LibraryVersionSetting[]>();

export async function demoVersionSettings(site: SiteRef, drives: DriveSummary[]): Promise<LibraryVersionSetting[]> {
  await sleep(300);
  let list = versionSettings.get(site.id);
  if (!list) {
    list = drives.map((d, i) => ({ driveId: d.id, driveName: d.name, listId: `00000000-0000-0000-0000-00000000000${i}`, enabled: true, majorLimit: 500 }));
    versionSettings.set(site.id, list);
  }
  return list.map((s) => ({ ...s }));
}

export async function demoSetVersionLimit(site: SiteRef, setting: LibraryVersionSetting, limit: number) {
  await sleep(250);
  const list = versionSettings.get(site.id) ?? [];
  versionSettings.set(
    site.id,
    list.map((s) => (s.driveId === setting.driveId ? { ...s, enabled: true, majorLimit: limit } : s)),
  );
}

export async function demoRestoreFiles(_site: SiteRef, files: SpFile[], _since: string, onProgress?: (d: number, t: number) => void): Promise<BulkResult> {
  return demoDeleteFiles(files, false, onProgress);
}

/** Placeholder content instead of real files – the desktop app writes these during a demo backup. */
export async function demoDownloadUrls(files: SpFile[]): Promise<Map<string, string>> {
  return new Map(
    files.map((f) => [
      f.id,
      `data:text/plain;charset=utf-8,${encodeURIComponent(`Demo-Platzhalter für „${f.name}“ (${formatBytes(f.size)}) – im echten Betrieb liegt hier die Originaldatei.`)}`,
    ]),
  );
}

export async function demoSendMails(mails: OwnerMail[], onProgress?: (d: number, t: number) => void): Promise<BulkResult> {
  for (let i = 0; i < mails.length; i++) {
    await sleep(200);
    onProgress?.(i + 1, mails.length);
  }
  return { succeeded: mails.map((m) => m.to.email), failed: [] };
}

const DEMO_COLORS: Record<FileCategory, [string, string]> = {
  video: ["#2a78d6", "#123e73"],
  image: ["#eb6834", "#8a3412"],
  document: ["#1baf7a", "#0d5c40"],
  archive: ["#eda100", "#7a5300"],
  audio: ["#e87ba4", "#7d2c4b"],
  other: ["#737373", "#262626"],
};

/** Generated preview for the demo: a gradient with the file type. */
function demoThumbnail(file: SpFile): string {
  const [from, to] = DEMO_COLORS[file.category];
  const seed = [...file.id].reduce((s, c) => s + c.charCodeAt(0), 0);
  const angle = seed % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">
<defs><linearGradient id="g" gradientTransform="rotate(${angle} .5 .5)"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
<rect width="320" height="200" fill="url(#g)"/>
<circle cx="${60 + (seed % 200)}" cy="${40 + (seed % 120)}" r="${30 + (seed % 40)}" fill="#fff" fill-opacity=".12"/>
<text x="160" y="112" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="34" font-weight="600" fill="#fff" fill-opacity=".9" text-anchor="middle">.${file.ext.toUpperCase()}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export async function demoSearchSites(query: string): Promise<SiteRef[]> {
  await sleep(250);
  const q = query.trim().toLowerCase();
  return DEMO_SITES.filter((s) => !q || q === "*" || s.name.toLowerCase().includes(q));
}

export async function demoScanSite(site: SiteRef, onProgress: (p: ScanProgress) => void, signal?: AbortSignal): Promise<ScanResult> {
  const result = generateDemoScan(site);
  const perDrive = result.drives.map((d) => d.fileCount);
  let items = 0;
  for (const [i, drive] of result.drives.entries()) {
    const steps = 8;
    for (let s = 1; s <= steps; s++) {
      if (signal?.aborted) throw new DOMException("Scan abgebrochen", "AbortError");
      await sleep(110);
      onProgress({ driveName: drive.name, driveIndex: i, driveCount: result.drives.length, items: items + Math.round((perDrive[i] * s) / steps) });
    }
    items += perDrive[i];
  }
  return result;
}

export async function demoDeleteFiles(files: SpFile[], _permanent: boolean, onProgress?: (d: number, t: number) => void): Promise<BulkResult> {
  for (let i = 0; i < files.length; i += 20) {
    await sleep(60);
    onProgress?.(Math.min(i + 20, files.length), files.length);
  }
  return { succeeded: files.map((f) => f.id), failed: [] };
}

export async function demoScanVersions(files: SpFile[], onProgress?: (d: number, t: number) => void) {
  for (let i = 0; i < files.length; i += 20) {
    await sleep(45);
    onProgress?.(Math.min(i + 20, files.length), files.length);
  }
  return new Map(files.map((f) => [f.id, DEMO_VERSIONS.get(f.id) ?? { count: 1, bytes: 0 }] as const));
}

export async function demoCleanVersions(files: SpFile[], onProgress?: (d: number, t: number) => void): Promise<BulkResult> {
  return demoDeleteFiles(files, true, onProgress);
}

/* ----------------------------------------------------- previews, retention */

export async function demoThumbnails(files: SpFile[]): Promise<Map<string, string>> {
  await sleep(120);
  return new Map(files.map((f) => [f.id, demoThumbnail(f)]));
}

/** Contracts are records (cannot be deleted), invoices are retained (deletable, but kept for 10 years). */
export async function demoRetentionLabels(files: SpFile[]): Promise<Map<string, RetentionInfo>> {
  await sleep(250);
  const out = new Map<string, RetentionInfo>();
  for (const f of files) {
    if (/^vertrag/i.test(f.name)) out.set(f.id, { name: "Verträge – 10 Jahre (Datensatz)", deleteAllowed: false, retains: true });
    else if (/^rechnung/i.test(f.name)) out.set(f.id, { name: "Rechnungen – 10 Jahre", deleteAllowed: true, retains: true });
  }
  return out;
}

export async function demoPreservationHold(site: SiteRef): Promise<{ bytes: number; files: number } | null> {
  await sleep(400);
  if (site.id === "demo-gf") return null;
  const quota = demoQuota(site);
  return { bytes: Math.round(quota.used * 0.021), files: 180 + (site.id.length * 37) % 400 };
}

export async function demoArchiveSite(): Promise<void> {
  await sleep(700);
}

/* ------------------------------------------------- approvals (simulated) */

const demoApprovals = new Map<string, number>();
let approvalCounter = 0;

export async function demoCreateApproval(): Promise<string> {
  await sleep(300);
  const id = `demo-approval-${approvalCounter}`;
  demoApprovals.set(id, approvalCounter++);
  return id;
}

/** Every third owner approves, the next one rejects, the rest has not answered yet. */
export async function demoGetApproval(id: string): Promise<{ state: string; result?: string }> {
  await sleep(150);
  const n = demoApprovals.get(id) ?? 2;
  if (n % 3 === 0) return { state: "completed", result: "Approved" };
  if (n % 3 === 1) return { state: "completed", result: "Rejected" };
  return { state: "pending" };
}
