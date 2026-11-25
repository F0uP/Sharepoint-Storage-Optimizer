import { createWriteStream } from "node:fs";
import { access, mkdir, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

/**
 * Local backup of SharePoint files ("Sichern & löschen"). Pure Node – no Electron imports, so it is
 * unit-tested directly. The renderer only passes pre-authenticated download URLs, never a token.
 */

export interface DownloadJob {
  id: string;
  url: string;
  relativePath: string;
  size?: number;
  /** last change in SharePoint (ISO) – becomes the modification date of the copy */
  modified?: string;
}

export interface DownloadResult {
  succeeded: string[];
  failed: { id: string; error: string }[];
  /** where each saved file ended up, relative to the chosen folder (may differ: "Bericht (2).docx") */
  paths: Record<string, string>;
}

const INVALID_CHARS = /[<>:"|?*\x00-\x1f\\]/g;
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const SHAREPOINT_HOST = /^[a-z0-9-]+\.sharepoint(-mil)?\.(com|us|cn|de)$/i;

/** Makes one path segment valid on Windows and macOS. */
export function safeSegment(segment: string): string {
  let s = segment.replace(INVALID_CHARS, "_").trim().replace(/[. ]+$/, "");
  if (!s || s === "." || s === "..") s = "_";
  if (RESERVED_NAMES.test(s)) s = `_${s}`;
  return s.slice(0, 120);
}

/** Resolves a SharePoint path below the chosen folder – never outside of it. */
export function resolveInside(base: string, relativePath: string): string {
  const parts = relativePath.split(/[\\/]+/).filter(Boolean).map(safeSegment);
  if (!parts.length) throw new Error("Leerer Dateipfad");
  const root = path.resolve(base);
  const target = path.resolve(root, ...parts);
  if (!target.startsWith(root + path.sep)) throw new Error("Pfad liegt außerhalb des Zielordners");
  return target;
}

async function exists(file: string) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/** "Bericht.docx" → "Bericht (2).docx" if the file already exists – backups never overwrite anything. */
export async function uniquePath(target: string): Promise<string> {
  if (!(await exists(target))) return target;
  const { dir, name, ext } = path.parse(target);
  for (let i = 2; i < 1000; i++) {
    const candidate = path.join(dir, `${name} (${i})${ext}`);
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error("Kein freier Dateiname gefunden");
}

/** Only SharePoint download URLs (and data: URLs for the demo) are fetched. */
export function isAllowedSource(url: string): boolean {
  if (url.startsWith("data:")) return true;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && SHAREPOINT_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Streams a URL into a file (".part" until complete) and verifies it is complete. The length the server
 * declares wins over `expectedSize`: SharePoint writes metadata into Office files on download, so they
 * can be larger than the size Graph reports.
 */
export async function downloadTo(
  url: string,
  target: string,
  expectedSize?: number,
  modified?: Date,
): Promise<{ path: string; bytes: number }> {
  if (!isAllowedSource(url)) throw new Error("Download-Quelle nicht erlaubt");
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download fehlgeschlagen (HTTP ${res.status})`);
  const declared = res.headers.get("content-length");
  const expected = declared !== null && declared !== "" ? Number(declared) : expectedSize;
  await mkdir(path.dirname(target), { recursive: true });
  const final = await uniquePath(target);
  const part = `${final}.part`;
  try {
    await pipeline(Readable.fromWeb(res.body as WebReadableStream<Uint8Array>), createWriteStream(part));
    const { size } = await stat(part);
    if (expected !== undefined && size !== expected) {
      throw new Error(`Unvollständig: ${size} statt ${expected} Bytes`);
    }
    await rename(part, final);
    if (modified) {
      // the copy shows when the file was last changed, not when it was saved – some network drives refuse that
      await utimes(final, new Date(), modified).catch(() => {});
    }
    return { path: final, bytes: size };
  } catch (error) {
    await rm(part, { force: true });
    throw error;
  }
}

function validDate(value: unknown): Date | undefined {
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Writes the table of contents of a backup ("Sicherung 2026-11-25 14-30.csv") into the chosen folder and
 * returns its path relative to it. Never overwrites an earlier one.
 */
export async function writeIndex(base: string, content: string, now = new Date()): Promise<string> {
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}`;
  const root = path.resolve(base);
  const target = await uniquePath(resolveInside(root, `Sicherung ${stamp}.csv`));
  await writeFile(target, content, "utf8");
  return path.relative(root, target);
}

export async function downloadAll(
  base: string,
  jobs: DownloadJob[],
  onProgress?: (done: number, total: number) => void,
  concurrency = 3,
): Promise<DownloadResult> {
  const result: DownloadResult = { succeeded: [], failed: [], paths: {} };
  const root = path.resolve(base);
  const queue = [...jobs];
  let done = 0;
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      try {
        const saved = await downloadTo(job.url, resolveInside(root, job.relativePath), job.size, validDate(job.modified));
        result.succeeded.push(job.id);
        result.paths[job.id] = path.relative(root, saved.path);
      } catch (error) {
        result.failed.push({ id: job.id, error: error instanceof Error ? error.message : String(error) });
      }
      onProgress?.(++done, jobs.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return result;
}
