import { categorize, getExtension, OFFICE_EXT } from "./file-types";
import type { BulkResult, DriveSummary, Quota, ScanProgress, ScanResult, SiteRef, SpFile } from "./types";

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
];

const PEOPLE = ["Anna Weber", "Jonas Keller", "Lea Hoffmann", "Max Braun", "Sophie Wagner", "Felix Schulz", "Mara Fischer"];

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
  { folder: "Videos/Rohmaterial", names: ["DJI_", "C0", "GX0", "MVI_", "Clip_"], ext: ["mov", "mp4", "mts"], median: 1.6 * GB, spread: 0.8, weight: 2 },
  { folder: "Fotos/Events", names: ["IMG_", "DSC0", "Event_", "Sommerfest_", "Messe_"], ext: ["jpg", "jpg", "jpeg", "heic", "png"], median: 6 * MB, spread: 0.8, weight: 14 },
  { folder: "Fotos/Shootings", names: ["Shooting_", "Portrait_", "Produkt_", "_MG_"], ext: ["cr3", "nef", "arw", "dng", "jpg", "tif"], median: 38 * MB, spread: 0.6, weight: 7 },
  { folder: "Design", names: ["Plakat", "Flyer", "Banner", "Keyvisual", "Messestand", "Broschüre"], ext: ["psd", "ai", "pdf", "eps", "png"], median: 140 * MB, spread: 1.0, weight: 4 },
  { folder: "Dokumente", names: ["Konzept", "Protokoll", "Angebot", "Briefing", "Bericht", "Entwurf", "Freigabe", "Pressemitteilung"], ext: ["docx", "docx", "pdf", "xlsx", "pptx"], median: 1.2 * MB, spread: 1.2, weight: 30 },
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
  const count = site.id === "demo-marketing" ? 3200 : 1800;
  let n = 0;

  const make = (driveName: string, folder: string, name: string, size: number, modified: number, hash?: string): SpFile => {
    const id = `${site.id}-${n++}`;
    const ext = getExtension(name);
    const modifiedIso = new Date(modified).toISOString();
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
      modifiedBy: pick(rnd, PEOPLE),
      webUrl: `${site.webUrl}/${encodeURIComponent(driveName)}/${folder.split("/").map(encodeURIComponent).join("/")}/${encodeURIComponent(name)}`,
      hash: hash ?? `h${seed}-${n}`,
    };
  };

  for (let i = 0; i < count; i++) {
    let r = rnd() * totalWeight;
    const t = TEMPLATES.find((tpl) => (r -= tpl.weight) < 0) ?? TEMPLATES[0];
    const driveName = t.folder.startsWith("Videos") || t.folder.startsWith("Fotos") || t.folder === "Design" ? "Marketing-Assets" : t.folder === "Archiv" || t.folder === "Software" ? "Projektarchiv" : pick(rnd, libraries);
    const year = pick(rnd, SUBFOLDERS);
    const folder = `${t.folder}/${year}`;
    const base = pick(rnd, t.names);
    const ext = pick(rnd, t.ext);
    const name = /_$|0$/.test(base) ? `${base}${String(Math.floor(rnd() * 9000) + 1000)}.${ext}` : `${base} ${year}${rnd() > 0.6 ? ` v${Math.ceil(rnd() * 4)}` : ""}${rnd() > 0.85 ? " final" : ""}.${ext}`;
    const yearStart = Date.UTC(Number(year), 0, 1);
    const modified = Math.min(now - 864e5, yearStart + rnd() * 365 * 864e5);
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
