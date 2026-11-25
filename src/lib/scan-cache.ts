import { idbStorage, keysWithPrefix, type KeyValueStorage } from "./kv";
import type { ScanResult, SpFile } from "./types";

/**
 * Cache of the last scan per site. Large sites have a million files: written as one entry, every save
 * (after each delete, restore, …) blocked the app for seconds and briefly doubled its memory. So the files
 * are written in chunks with breaks in between, and only then the index is switched to the new chunks –
 * a reader sees either the complete old or the complete new scan, never a mix.
 *
 *   scan:<siteId>               index: { v: 2, gen, chunks, count, scan without files }
 *   scan:<siteId>:<gen>:<n>     files of chunk n of generation gen
 *
 * Caches of older versions (the whole scan in `scan:<siteId>`) are still read.
 */

const indexKey = (siteId: string) => `scan:${siteId}`;
const chunkPrefix = (siteId: string) => `scan:${siteId}:`;
const chunkKey = (siteId: string, gen: string, n: number) => `${chunkPrefix(siteId)}${gen}:${n}`;

export const CACHE_CHUNK = 20_000;

interface CacheIndex {
  v: 2;
  gen: string;
  chunks: number;
  count: number;
  scan: Omit<ScanResult, "files">;
}

const isIndex = (value: unknown): value is CacheIndex => (value as CacheIndex | undefined)?.v === 2;

const isScan = (value: unknown): value is ScanResult => {
  const s = value as ScanResult | undefined;
  return Boolean(s && Array.isArray(s.files) && Array.isArray(s.drives) && s.site);
};

/** Lets the app render between chunks (a message task, not throttled in hidden windows like setTimeout). */
function yieldToUi(): Promise<void> {
  if (typeof MessageChannel === "undefined") return Promise.resolve();
  return new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => {
      port1.close();
      resolve();
    };
    port2.postMessage(null);
  });
}

/** The cached scan of a site; undefined when there is none or it is incomplete or unreadable. */
export async function loadScan(siteId: string, storage: KeyValueStorage = idbStorage): Promise<ScanResult | undefined> {
  const [stored] = await storage.getMany<unknown>([indexKey(siteId)]);
  if (!isIndex(stored)) return isScan(stored) ? stored : undefined;
  const files: SpFile[] = [];
  for (let n = 0; n < stored.chunks; n++) {
    // one chunk per request: each is unpacked separately, the app stays responsive
    const [chunk] = await storage.getMany<SpFile[]>([chunkKey(siteId, stored.gen, n)]);
    if (!Array.isArray(chunk)) return undefined;
    for (const f of chunk) files.push(f);
  }
  const scan = { ...stored.scan, files };
  return files.length === stored.count && isScan(scan) ? scan : undefined;
}

/** latest save per site – an older one stops and hands over to it */
const latest = new Map<string, { token: number; done: Promise<boolean> }>();
let counter = 0;

/**
 * Saves a scan; resolves true once it is completely cached. A save that is overtaken by a newer one for the
 * same site stops and resolves with the result of the newer one. Errors (e.g. storage full) reject.
 */
export function saveScan(scan: ScanResult, storage: KeyValueStorage = idbStorage): Promise<boolean> {
  // registered before writing starts – the write checks right away whether it is still the latest
  const entry = { token: ++counter, done: Promise.resolve(false) };
  latest.set(scan.site.id, entry);
  entry.done = writeScan(scan, entry.token, storage);
  return entry.done;
}

async function writeScan(scan: ScanResult, token: number, storage: KeyValueStorage): Promise<boolean> {
  const siteId = scan.site.id;
  const overtaken = () => latest.get(siteId)?.token !== token;
  // unique across sessions, so leftovers of an earlier session never collide
  const gen = `${Date.now().toString(36)}-${token.toString(36)}`;
  const { files, ...rest } = scan;

  let chunks = 0;
  for (let i = 0; i < files.length || chunks === 0; i += CACHE_CHUNK) {
    if (overtaken()) return latest.get(siteId)!.done;
    await storage.setMany([[chunkKey(siteId, gen, chunks++), files.slice(i, i + CACHE_CHUNK)]]);
    await yieldToUi();
  }
  if (overtaken()) return latest.get(siteId)!.done;
  const index: CacheIndex = { v: 2, gen, chunks, count: files.length, scan: rest };
  await storage.setMany([[indexKey(siteId), index]]);

  // older generations and leftovers of interrupted saves are no longer referenced. Chunks of a save that
  // starts meanwhile are written after the key listing and therefore never in it.
  if (!overtaken()) {
    const stale = (await keysWithPrefix(storage, chunkPrefix(siteId))).filter((k) => !k.startsWith(`${chunkPrefix(siteId)}${gen}:`));
    if (stale.length && !overtaken()) await storage.delMany(stale);
  }
  return true;
}

/** Removes the cached scan of a site. */
export async function deleteScan(siteId: string, storage: KeyValueStorage = idbStorage): Promise<void> {
  await storage.delMany([indexKey(siteId)]);
  const chunks = await keysWithPrefix(storage, chunkPrefix(siteId));
  if (chunks.length) await storage.delMany(chunks);
}
