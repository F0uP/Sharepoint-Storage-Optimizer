import { applyOp, initialLink, newDrive, type DeltaOp, type DriveState, type LibraryRef } from "./delta";
import { idbStorage, keysWithPrefix, type KeyValueStorage } from "./kv";

/**
 * Progress of a full scan is saved in chunks while it runs. When the scan is interrupted (connection lost,
 * app closed, crash), the next scan of the site replays the chunks and continues at the saved delta link
 * instead of starting from zero – a large site can take an hour to read.
 *
 * Each save writes the new changes as a chunk together with the updated index in one transaction, so the
 * index only ever points to complete chunks.
 */

interface DriveIndex {
  id: string;
  link: string;
  complete: boolean;
  chunks: number;
}

interface CheckpointIndex {
  v: 1;
  siteId: string;
  startedAt: string;
  /** changes saved so far (shown when the scan continues) */
  items: number;
  drives: DriveIndex[];
}

const indexKey = (siteId: string) => `scan-resume:${siteId}`;
const chunkKey = (siteId: string, driveId: string, n: number) => `scan-resume:${siteId}:${driveId}:${n}`;

/** older progress is not worth continuing – the delta links may have expired, too */
const MAX_AGE = 14 * 864e5;
const FLUSH_OPS = 5000;
const FLUSH_MS = 15_000;

export interface Checkpoint {
  /** changes captured by the interrupted scan (0 = nothing to continue) */
  resumedItems: number;
  /** library state rebuilt from the saved chunks, if any */
  drive(library: LibraryRef): DriveState | undefined;
  /** remembers the changes of one page; written in chunks */
  save(state: DriveState, ops: DeltaOp[]): Promise<void>;
  /** forgets a library (its saved link was rejected – it is read again from the start) */
  reset(driveId: string): Promise<void>;
}

function isIndex(value: unknown, siteId: string): value is CheckpointIndex {
  const v = value as CheckpointIndex | undefined;
  return Boolean(v && v.v === 1 && v.siteId === siteId && Array.isArray(v.drives) && typeof v.startedAt === "string");
}

const chunkKeys = (siteId: string, d: DriveIndex) => Array.from({ length: d.chunks }, (_, n) => chunkKey(siteId, d.id, n));

/**
 * Opens the checkpoint of a site: restores saved progress for libraries that still exist and drops the rest.
 * Unreadable or outdated progress is discarded – the scan then simply starts from the beginning.
 */
export async function openCheckpoint(
  siteId: string,
  libraries: LibraryRef[],
  storage: KeyValueStorage = idbStorage,
  { now = Date.now(), flushOps = FLUSH_OPS, flushMs = FLUSH_MS }: { now?: number; flushOps?: number; flushMs?: number } = {},
): Promise<Checkpoint> {
  const [stored] = await storage.getMany<CheckpointIndex>([indexKey(siteId)]).catch(() => [undefined]);
  let index: CheckpointIndex = { v: 1, siteId, startedAt: new Date(now).toISOString(), items: 0, drives: [] };
  const restored = new Map<string, DriveState>();

  if (isIndex(stored, siteId) && now - Date.parse(stored.startedAt) < MAX_AGE) {
    const wanted = new Map(libraries.map((l) => [l.id, l]));
    const kept = stored.drives.filter((d) => wanted.has(d.id) && d.chunks > 0);
    try {
      for (const d of kept) {
        const chunks = await storage.getMany<DeltaOp[]>(chunkKeys(siteId, d));
        if (chunks.some((c) => !Array.isArray(c))) throw new Error("Checkpoint unvollständig");
        const state = newDrive(wanted.get(d.id)!);
        for (const chunk of chunks) for (const op of chunk!) applyOp(state, op);
        state.link = d.link;
        state.complete = d.complete;
        restored.set(d.id, state);
      }
      index = { ...stored, drives: kept };
      // libraries removed since then
      const dropped = stored.drives.filter((d) => !kept.includes(d)).flatMap((d) => chunkKeys(siteId, d));
      if (dropped.length) await storage.delMany(dropped).catch(() => {});
    } catch {
      restored.clear();
      await clearCheckpoint(siteId, storage);
    }
  } else if (stored) {
    await clearCheckpoint(siteId, storage);
  }

  const pending = new Map<string, DeltaOp[]>();
  let lastFlush = now;
  let broken = false;

  const entry = (driveId: string) => {
    let d = index.drives.find((x) => x.id === driveId);
    if (!d) {
      d = { id: driveId, link: initialLink(driveId), complete: false, chunks: 0 };
      index.drives.push(d);
    }
    return d;
  };

  return {
    resumedItems: restored.size ? index.items : 0,
    drive: (library) => {
      const state = restored.get(library.id);
      if (state) Object.assign(state, { name: library.name, webUrl: library.webUrl });
      return state;
    },
    async save(state, ops) {
      if (broken) return;
      const list = pending.get(state.id) ?? [];
      for (const op of ops) list.push(op);
      pending.set(state.id, list);
      // a finished library is always written – its index entry then holds the deltaLink
      const due = state.complete || (list.length > 0 && (list.length >= flushOps || Date.now() - lastFlush >= flushMs));
      if (!due) return;
      const d = entry(state.id);
      const next: DriveIndex = { ...d, link: state.link, complete: state.complete, chunks: d.chunks + 1 };
      const nextIndex: CheckpointIndex = { ...index, items: index.items + list.length, drives: index.drives.map((x) => (x === d ? next : x)) };
      try {
        await storage.setMany([
          [chunkKey(siteId, state.id, d.chunks), list],
          [indexKey(siteId), nextIndex],
        ]);
        index = nextIndex;
        pending.set(state.id, []);
        lastFlush = Date.now();
      } catch (e) {
        // e.g. storage full: the scan goes on, it just cannot be continued after an interruption
        broken = true;
        console.warn("Scan-Fortschritt kann nicht gespeichert werden", e);
      }
    },
    async reset(driveId) {
      pending.delete(driveId);
      const d = index.drives.find((x) => x.id === driveId);
      if (!d) return;
      const nextIndex = { ...index, drives: index.drives.filter((x) => x !== d) };
      try {
        await storage.setMany([[indexKey(siteId), nextIndex]]);
        index = nextIndex;
        // chunks of the new run reuse the same keys from 0 – leftovers would only be overwritten
        await storage.delMany(chunkKeys(siteId, d));
      } catch {
        broken = true;
      }
    },
  };
}

/** Removes saved progress (after the finished scan is cached, or before a deliberate complete rescan). */
export async function clearCheckpoint(siteId: string, storage: KeyValueStorage = idbStorage): Promise<void> {
  try {
    // index first: without it the chunks are never read again, even if deleting them fails
    await storage.delMany([indexKey(siteId)]);
    const chunks = await keysWithPrefix(storage, `${indexKey(siteId)}:`);
    if (chunks.length) await storage.delMany(chunks);
  } catch {
    // nothing stored, or storage unavailable
  }
}

/** Whether an interrupted scan of the site can be continued. */
export async function hasCheckpoint(siteId: string, storage: KeyValueStorage = idbStorage): Promise<boolean> {
  try {
    const [stored] = await storage.getMany<CheckpointIndex>([indexKey(siteId)]);
    return isIndex(stored, siteId) && stored.drives.some((d) => d.chunks > 0);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ lock */

const heldHere = new Set<string>();

/**
 * Only one scan per site may write checkpoints – also across browser tabs (Web Locks). A scan that does not get
 * the lock runs anyway, just without saving progress (`held` = false).
 */
export async function withScanLock<T>(siteId: string, fn: (held: boolean) => Promise<T>): Promise<T> {
  if (heldHere.has(siteId)) return fn(false);
  heldHere.add(siteId);
  try {
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (!locks) return await fn(true);
    return await locks.request(`spo-scan:${siteId}`, { ifAvailable: true }, (lock) => fn(lock !== null));
  } finally {
    heldHere.delete(siteId);
  }
}
