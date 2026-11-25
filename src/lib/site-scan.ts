import {
  cachedDrive,
  finishDrive,
  newDrive,
  runRound,
  snapshotDrive,
  type DeltaOp,
  type DeltaPage,
  type DriveState,
  type LibraryRef,
} from "./delta";
import { httpStatus, type RetryWait } from "./retry";
import { openCheckpoint, withScanLock, type Checkpoint } from "./scan-checkpoint";
import type { DriveSummary, Quota, ScanProgress, ScanResult, ScanSync, SiteRef, SpFile } from "./types";

/**
 * Scan of a site, independent of Microsoft Graph (injected) so it can be tested:
 * - without a previous scan every library is read completely (an interrupted read continues where it stopped)
 * - with a previous scan only the changes since are fetched (delta query); a library whose stored link
 *   is no longer accepted is read completely again – nothing else.
 */

export interface ScanDeps {
  libraries(siteId: string): Promise<LibraryRef[]>;
  quota(siteId: string): Promise<Quota | undefined>;
  fetchPage(url: string, onWait: (wait: RetryWait | undefined) => void, signal?: AbortSignal): Promise<DeltaPage>;
  openCheckpoint?: typeof openCheckpoint;
}

export interface ScanOptions {
  signal?: AbortSignal;
  /** previous scan – only its changes are fetched */
  base?: ScanResult | null;
  /** saves progress and continues an interrupted scan (interactive scans only) */
  resumable?: boolean;
  /** interim results of a complete read, so the site can be used while it is still being read */
  onPartial?: (scan: ScanResult) => void;
}

/** Pause between interim results: short at first, longer for big sites (each one is evaluated and rendered). */
export const partialInterval = (files: number) => Math.max(4000, files * 0.02);

/** A stored link (deltaLink or saved nextLink) that Graph no longer accepts: expired, invalid or resync required. */
export const isLinkRejected = (error: unknown) => [400, 404, 410].includes(httpStatus(error) ?? 0);

/** Library states of a cached scan, or null when it has no sync data (demo, caches of older versions). */
function fromBase(base: ScanResult | null | undefined, libraries: LibraryRef[]): Map<string, DriveState> | null {
  if (base?.sync?.v !== 1) return null;
  const byDrive = new Map<string, SpFile[]>();
  for (const f of base.files) {
    const list = byDrive.get(f.driveId);
    if (list) list.push(f);
    else byDrive.set(f.driveId, [f]);
  }
  const states = new Map<string, DriveState>();
  for (const library of libraries) {
    const sync = base.sync.drives.find((d) => d.id === library.id);
    if (sync?.deltaLink) states.set(library.id, cachedDrive(library, sync.deltaLink, sync.folders, byDrive.get(library.id) ?? []));
  }
  return states;
}

export async function scanSiteWith(
  deps: ScanDeps,
  site: SiteRef,
  onProgress: (p: ScanProgress) => void,
  { signal, base, resumable = false, onPartial }: ScanOptions = {},
): Promise<ScanResult> {
  const [libraries, quota] = await Promise.all([deps.libraries(site.id), deps.quota(site.id).catch(() => undefined)]);
  const cached = fromBase(base, libraries);
  const context = { deps, site, libraries, quota, cached, onProgress, signal, base, onPartial: cached ? undefined : onPartial };
  if (!resumable || cached) return scanLibraries(context, null);
  return withScanLock(site.id, async (held) =>
    scanLibraries(context, held ? await (deps.openCheckpoint ?? openCheckpoint)(site.id, libraries) : null),
  );
}

interface ScanContext {
  deps: ScanDeps;
  site: SiteRef;
  libraries: LibraryRef[];
  quota: Quota | undefined;
  cached: Map<string, DriveState> | null;
  onProgress: (p: ScanProgress) => void;
  signal: AbortSignal | undefined;
  base: ScanResult | null | undefined;
  onPartial?: (scan: ScanResult) => void;
}

function summarize(state: DriveState, files: SpFile[]): DriveSummary {
  let bytes = 0;
  for (const f of files) bytes += f.size;
  return { id: state.id, name: state.name, webUrl: state.webUrl, fileCount: files.length, totalBytes: bytes };
}

/** Interim result from the libraries read so far – nothing is finished or dropped. */
function partialResult({ site, quota, base }: ScanContext, states: DriveState[]): ScanResult {
  const files: SpFile[] = [];
  const drives: DriveSummary[] = [];
  for (const state of states) {
    const driveFiles = snapshotDrive(state);
    for (const f of driveFiles) files.push(f);
    drives.push(summarize(state, driveFiles));
  }
  return { site, quota, drives, files, scannedAt: new Date().toISOString(), versionsScannedAt: base?.versionsScannedAt, partial: true };
}

async function scanLibraries(context: ScanContext, checkpoint: Checkpoint | null): Promise<ScanResult> {
  const { deps, site, libraries, quota, cached, onProgress, signal, base, onPartial } = context;
  const kind = cached ? "delta" : "full";
  const resumed = checkpoint?.resumedItems || undefined;
  let items = resumed ?? 0;
  const states: DriveState[] = [];
  // the first interim result comes right after the first page
  let nextPartial = 0;

  for (const [index, library] of libraries.entries()) {
    let waiting: RetryWait | undefined;
    const report = () =>
      onProgress({
        driveName: library.name,
        driveIndex: index,
        driveCount: libraries.length,
        items,
        kind,
        resumed,
        waiting: waiting && { reason: waiting.reason, until: waiting.until },
      });
    report();
    const fetchPage = (url: string) =>
      deps.fetchPage(
        url,
        (w) => {
          waiting = w;
          report();
        },
        signal,
      );
    const onPage = async (ops: DeltaOp[], state: DriveState) => {
      items += ops.length;
      report();
      await checkpoint?.save(state, ops);
      if (onPartial && Date.now() >= nextPartial) {
        const partial = partialResult(context, [...states, state]);
        onPartial(partial);
        nextPartial = Date.now() + partialInterval(partial.files.length);
      }
    };

    const stored = cached?.get(library.id) ?? checkpoint?.drive(library);
    let state = stored ?? newDrive(library);
    try {
      await runRound(state, fetchPage, { signal, onPage });
    } catch (error) {
      if (!stored || !isLinkRejected(error) || signal?.aborted) throw error;
      // the stored link expired or became invalid – this library is read completely again
      await checkpoint?.reset(library.id);
      state = newDrive(library);
      await runRound(state, fetchPage, { signal, onPage });
    }
    states.push(state);
  }

  const files: SpFile[] = [];
  const drives: DriveSummary[] = [];
  const sync: ScanSync = { v: 1, drives: [] };
  for (const state of states) {
    const driveFiles = finishDrive(state);
    // no spread: a library can hold hundreds of thousands of files
    for (const f of driveFiles) files.push(f);
    drives.push(summarize(state, driveFiles));
    sync.drives.push({ id: state.id, deltaLink: state.link, folders: [...state.folders.values()] });
  }

  return { site, quota, drives, files, scannedAt: new Date().toISOString(), versionsScannedAt: base?.versionsScannedAt, sync };
}

/* ------------------------------------------------------------------ merge */

export interface ScanChanges {
  added: number;
  changed: number;
  removed: number;
}

function recount(drives: DriveSummary[], files: SpFile[]): DriveSummary[] {
  const totals = new Map<string, { count: number; bytes: number }>();
  for (const f of files) {
    const t = totals.get(f.driveId) ?? { count: 0, bytes: 0 };
    t.count++;
    t.bytes += f.size;
    totals.set(f.driveId, t);
  }
  return drives.map((d) => ({ ...d, fileCount: totals.get(d.id)?.count ?? 0, totalBytes: totals.get(d.id)?.bytes ?? 0 }));
}

/**
 * Brings the result of a background scan into the scan that is shown. `base` is what the scan started from,
 * `current` what is shown now – the user may have deleted, restored or compressed files meanwhile.
 * Those local changes win: a file deleted meanwhile does not come back, a file changed meanwhile keeps the
 * local state. The next delta round reports anything that is still different.
 */
export function mergeScan(
  base: ScanResult,
  current: ScanResult,
  result: ScanResult,
  /** false skips counting changes – then nothing has to be compared when nothing happened meanwhile */
  count = true,
): { scan: ScanResult; changes: ScanChanges } {
  const untouched = current.files === base.files;
  if (untouched && !count) {
    return {
      scan: { ...result, quota: result.quota ?? current.quota, versionsScannedAt: current.versionsScannedAt ?? result.versionsScannedAt },
      changes: { added: 0, changed: 0, removed: 0 },
    };
  }
  const baseById = new Map(base.files.map((f) => [f.id, f]));
  const currentById = untouched ? baseById : new Map(current.files.map((f) => [f.id, f]));
  const resultIds = new Set<string>();
  const files: SpFile[] = [];
  const changes: ScanChanges = { added: 0, changed: 0, removed: 0 };

  for (const f of result.files) {
    resultIds.add(f.id);
    const before = baseById.get(f.id);
    if (!before) changes.added++;
    else if (before !== f && (before.size !== f.size || before.modified !== f.modified || before.path !== f.path || before.name !== f.name)) {
      changes.changed++;
    }
    if (untouched) continue;
    const now = currentById.get(f.id);
    if (before && !now) continue;
    files.push(before && now !== before ? now! : f);
  }
  for (const f of base.files) if (!resultIds.has(f.id)) changes.removed++;
  if (!untouched) for (const f of current.files) if (!baseById.has(f.id) && !resultIds.has(f.id)) files.push(f);

  return {
    scan: {
      ...result,
      quota: result.quota ?? current.quota,
      versionsScannedAt: current.versionsScannedAt ?? result.versionsScannedAt,
      drives: untouched ? result.drives : recount(result.drives, files),
      files: untouched ? result.files : files,
    },
    changes,
  };
}
