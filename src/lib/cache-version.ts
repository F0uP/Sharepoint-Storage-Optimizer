import { idbStorage, type KeyValueStorage } from "./kv";

/**
 * After an update the cached scans are dropped: a new version may read sites more completely or store them
 * differently, and a scan cached by an older version would hide that. Every site is then read completely
 * again the next time it is opened. History, storage trend, rules, jobs and settings stay – they are records,
 * not caches.
 */

const VERSION_KEY = "cache-version";

/** scans, progress of interrupted scans, AI results (they refer to scanned files) and the overall analysis */
const CACHE_PREFIXES = ["scan:", "scan-resume:", "ai:", "tenant:"];

const isCacheKey = (key: IDBValidKey): key is string => typeof key === "string" && CACHE_PREFIXES.some((p) => key.startsWith(p));

/** Removes every cached scan (also used for a complete fresh start). Returns the number of removed entries. */
export async function clearScanCaches(storage: KeyValueStorage = idbStorage): Promise<number> {
  const keys = (await storage.keys()).filter(isCacheKey);
  if (keys.length) await storage.delMany(keys);
  return keys.length;
}

/**
 * Drops the caches when they were written by another version than `version`. Resolves true when something
 * was dropped. Storage problems never block the start – the caches then simply stay.
 */
export async function dropOutdatedCaches(version: string | undefined, storage: KeyValueStorage = idbStorage): Promise<boolean> {
  if (!version) return false;
  try {
    const [stored] = await storage.getMany<string>([VERSION_KEY]);
    if (stored === version) return false;
    const removed = await clearScanCaches(storage);
    // written last: if clearing fails, the next start tries again
    await storage.setMany([[VERSION_KEY, version]]);
    return removed > 0;
  } catch (e) {
    console.warn("Zwischenspeicher konnte nicht geprüft werden", e);
    return false;
  }
}

let check: Promise<boolean> | null = null;

/** Once per app start, before any cached scan is read. */
export function clearCachesAfterUpdate(): Promise<boolean> {
  check ??= dropOutdatedCaches(process.env.APP_VERSION);
  return check;
}
