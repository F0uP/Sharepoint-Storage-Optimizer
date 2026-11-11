import { Client } from "@microsoft/microsoft-graph-client";
import type { Drive, DriveItem, Site } from "@microsoft/microsoft-graph-types";
import { categorize, getExtension } from "./file-types";
import { GRAPH_SCOPES, getAccessToken, sharePointScopes } from "./msal";
import type { BulkResult, DriveSummary, Quota, ScanProgress, ScanResult, SiteRef, SpFile } from "./types";

let client: Client | null = null;

/** Graph client with the SDK's default middleware chain (incl. retry on 429/503 with Retry-After). */
function graph(): Client {
  client ??= Client.initWithMiddleware({
    authProvider: { getAccessToken: () => getAccessToken(GRAPH_SCOPES) },
  });
  return client;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toSiteRef(site: Site): SiteRef {
  return {
    id: site.id!,
    name: site.displayName || site.name || site.webUrl || "Unbenannte Site",
    webUrl: site.webUrl ?? "",
    description: site.description ?? undefined,
  };
}

export async function searchSites(query: string): Promise<SiteRef[]> {
  const q = query.trim() || "*";
  const res = await graph()
    .api("/sites")
    .query({ search: q })
    .select("id,displayName,name,webUrl,description")
    .top(50)
    .get();
  const sites = (res.value as Site[]).map(toSiteRef);
  // personal OneDrive sites show up in search results – they are not SharePoint team sites
  return sites.filter((s) => !s.webUrl.includes("-my.sharepoint.com"));
}

function toQuota(q: Drive["quota"]): Quota | undefined {
  if (!q || q.total == null) return undefined;
  return {
    total: Number(q.total ?? 0),
    used: Number(q.used ?? 0),
    remaining: Number(q.remaining ?? 0),
    deleted: Number(q.deleted ?? 0),
    state: q.state ?? undefined,
  };
}

async function listLibraries(siteId: string): Promise<Drive[]> {
  const res = await graph().api(`/sites/${siteId}/drives`).select("id,name,webUrl,driveType").get();
  return (res.value as Drive[]).filter((d) => d.driveType === "documentLibrary");
}

export async function getSiteQuota(siteId: string): Promise<Quota | undefined> {
  const drive: Drive = await graph().api(`/sites/${siteId}/drive`).select("id,quota").get();
  return toQuota(drive.quota);
}

const DELTA_SELECT = [
  "id", "name", "size", "file", "folder", "package", "root", "deleted", "image", "video", "audio", "photo",
  "parentReference", "createdDateTime", "lastModifiedDateTime", "lastModifiedBy", "webUrl",
].join(",");

/**
 * Enumerates every file of a document library with the delta query –
 * the fastest way to get a complete inventory (one request per ~200–1000 items).
 * Delta responses do not contain paths, so they are rebuilt from the folder hierarchy.
 */
async function scanDrive(
  drive: Drive,
  onItems: (count: number) => void,
  signal?: AbortSignal,
): Promise<SpFile[]> {
  const folders = new Map<string, { name: string; parentId?: string; root: boolean }>();
  const rawFiles: DriveItem[] = [];
  let url: string | undefined = `/drives/${drive.id}/root/delta?$select=${DELTA_SELECT}`;
  let seen = 0;

  while (url) {
    if (signal?.aborted) throw new DOMException("Scan abgebrochen", "AbortError");
    const page: { value: DriveItem[]; "@odata.nextLink"?: string } = await graph().api(url).get();
    for (const item of page.value) {
      if (item.deleted) continue;
      if (item.folder || item.package || item.root) {
        folders.set(item.id!, { name: item.name ?? "", parentId: item.parentReference?.id ?? undefined, root: !!item.root });
      } else if (item.file) {
        rawFiles.push(item);
      }
    }
    seen += page.value.length;
    onItems(seen);
    url = page["@odata.nextLink"];
  }

  const pathCache = new Map<string, string>();
  const folderPath = (id: string | undefined, depth = 0): string => {
    if (!id || depth > 64) return drive.name!;
    const cached = pathCache.get(id);
    if (cached !== undefined) return cached;
    const f = folders.get(id);
    const path = !f || f.root ? drive.name! : `${folderPath(f.parentId, depth + 1)}/${f.name}`;
    pathCache.set(id, path);
    return path;
  };

  return rawFiles.map((item) => {
    const name = item.name ?? "";
    const hashes = item.file?.hashes;
    return {
      id: item.id!,
      driveId: drive.id!,
      driveName: drive.name!,
      name,
      ext: getExtension(name),
      path: folderPath(item.parentReference?.id ?? undefined),
      size: Number(item.size ?? 0),
      category: categorize(name, item.file?.mimeType ?? undefined, {
        video: !!item.video,
        image: !!(item.image || item.photo),
        audio: !!item.audio,
      }),
      mimeType: item.file?.mimeType ?? undefined,
      created: item.createdDateTime ?? item.lastModifiedDateTime ?? new Date().toISOString(),
      modified: item.lastModifiedDateTime ?? new Date().toISOString(),
      modifiedBy: item.lastModifiedBy?.user?.displayName ?? undefined,
      webUrl: item.webUrl ?? "",
      hash: hashes?.quickXorHash ?? hashes?.sha256Hash ?? hashes?.sha1Hash ?? undefined,
    } satisfies SpFile;
  });
}

export async function scanSite(
  site: SiteRef,
  onProgress: (p: ScanProgress) => void,
  signal?: AbortSignal,
): Promise<ScanResult> {
  const [libraries, quota] = await Promise.all([listLibraries(site.id), getSiteQuota(site.id).catch(() => undefined)]);
  const files: SpFile[] = [];
  const drives: DriveSummary[] = [];
  let total = 0;

  for (const [index, drive] of libraries.entries()) {
    const before = total;
    onProgress({ driveName: drive.name ?? "", driveIndex: index, driveCount: libraries.length, items: total });
    const driveFiles = await scanDrive(
      drive,
      (n) => onProgress({ driveName: drive.name ?? "", driveIndex: index, driveCount: libraries.length, items: before + n }),
      signal,
    );
    total = before + driveFiles.length;
    files.push(...driveFiles);
    drives.push({
      id: drive.id!,
      name: drive.name ?? "",
      webUrl: drive.webUrl ?? "",
      fileCount: driveFiles.length,
      totalBytes: driveFiles.reduce((s, f) => s + f.size, 0),
    });
  }

  return { site, quota, drives, files, scannedAt: new Date().toISOString() };
}

/* ---------------------------------------------------------------- batching */

interface BatchRequest {
  id: string;
  method: "GET" | "POST" | "DELETE";
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
}
interface BatchResponse {
  id: string;
  status: number;
  headers?: Record<string, string>;
  body?: { error?: { message?: string }; value?: unknown[] } & Record<string, unknown>;
}

/** Runs requests through JSON batching (20 per call) and retries throttled ones. */
async function runBatched(
  requests: BatchRequest[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, BatchResponse>> {
  const results = new Map<string, BatchResponse>();
  let queue = [...requests];
  let attempts = 0;

  while (queue.length && attempts < 6) {
    const retry: BatchRequest[] = [];
    let waitMs = 0;
    for (let i = 0; i < queue.length; i += 20) {
      const chunk = queue.slice(i, i + 20);
      const res: { responses: BatchResponse[] } = await graph().api("/$batch").post({ requests: chunk });
      for (const r of res.responses) {
        if (r.status === 429 || r.status === 503) {
          retry.push(chunk.find((c) => c.id === r.id)!);
          waitMs = Math.max(waitMs, Number(r.headers?.["Retry-After"] ?? 5) * 1000);
        } else {
          results.set(r.id, r);
        }
      }
      onProgress?.(results.size, requests.length);
    }
    queue = retry;
    attempts++;
    if (queue.length) await sleep(waitMs);
  }
  for (const r of queue) results.set(r.id, { id: r.id, status: 429, body: { error: { message: "Gedrosselt (429)" } } });
  return results;
}

const errorOf = (r?: BatchResponse) => r?.body?.error?.message ?? `HTTP ${r?.status ?? "?"}`;

export async function deleteFiles(
  files: SpFile[],
  permanent: boolean,
  onProgress?: (done: number, total: number) => void,
): Promise<BulkResult> {
  const requests: BatchRequest[] = files.map((f, i) =>
    permanent
      ? {
          id: String(i),
          method: "POST",
          url: `/drives/${f.driveId}/items/${f.id}/permanentDelete`,
          body: {},
          headers: { "Content-Type": "application/json" },
        }
      : { id: String(i), method: "DELETE", url: `/drives/${f.driveId}/items/${f.id}` },
  );
  const responses = await runBatched(requests, onProgress);
  const result: BulkResult = { succeeded: [], failed: [] };
  files.forEach((f, i) => {
    const r = responses.get(String(i));
    // 404 = already gone, counts as success
    if (r && ((r.status >= 200 && r.status < 300) || r.status === 404)) result.succeeded.push(f.id);
    else result.failed.push({ id: f.id, error: errorOf(r) });
  });
  return result;
}

interface VersionInfo {
  size?: number;
  lastModifiedDateTime?: string;
}

/** Reads the version history of the given files and returns the bytes held by old versions. */
export async function scanVersions(
  files: SpFile[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, { count: number; bytes: number }>> {
  const requests: BatchRequest[] = files.map((f, i) => ({
    id: String(i),
    method: "GET",
    url: `/drives/${f.driveId}/items/${f.id}/versions`,
  }));
  const responses = await runBatched(requests, onProgress);
  const out = new Map<string, { count: number; bytes: number }>();
  files.forEach((f, i) => {
    const r = responses.get(String(i));
    if (!r || r.status !== 200) return;
    const versions = ((r.body?.value ?? []) as VersionInfo[]).toSorted(
      (a, b) => Date.parse(b.lastModifiedDateTime ?? "") - Date.parse(a.lastModifiedDateTime ?? ""),
    );
    const bytes = versions.slice(1).reduce((s, v) => s + Number(v.size ?? 0), 0);
    out.set(f.id, { count: versions.length, bytes });
  });
  return out;
}

/* ------------------------------------------------- SharePoint REST (via proxy) */

async function sharePointRest(siteUrl: string, path: string, method: "GET" | "POST" = "POST") {
  const token = await getAccessToken(sharePointScopes(siteUrl));
  const res = await fetch("/api/sharepoint", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ siteUrl, path, method }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `SharePoint-Fehler (HTTP ${res.status})`);
  return data;
}

/** Deletes all previous versions of each file (current version stays untouched). */
export async function cleanVersions(
  files: SpFile[],
  onProgress?: (done: number, total: number) => void,
): Promise<BulkResult> {
  const idRequests: BatchRequest[] = files.map((f, i) => ({
    id: String(i),
    method: "GET",
    url: `/drives/${f.driveId}/items/${f.id}?$select=id,sharepointIds`,
  }));
  const idResponses = await runBatched(idRequests);
  const result: BulkResult = { succeeded: [], failed: [] };

  let done = 0;
  const queue = files.map((f, i) => ({ f, r: idResponses.get(String(i)) }));
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const ids = job.r?.body?.sharepointIds as { listItemUniqueId?: string; siteUrl?: string } | undefined;
      try {
        if (!ids?.listItemUniqueId || !ids.siteUrl) throw new Error(errorOf(job.r));
        await sharePointRest(ids.siteUrl, `/_api/web/GetFileById('${ids.listItemUniqueId}')/versions/DeleteAll()`);
        result.succeeded.push(job.f.id);
      } catch (e) {
        result.failed.push({ id: job.f.id, error: e instanceof Error ? e.message : String(e) });
      }
      onProgress?.(++done, files.length);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return result;
}

/** Empties the first- and second-stage recycle bin of the site collection. */
export async function emptyRecycleBin(site: SiteRef): Promise<{ secondStage: boolean }> {
  await sharePointRest(site.webUrl, "/_api/site/RecycleBin/DeleteAll()");
  try {
    await sharePointRest(site.webUrl, "/_api/site/RecycleBin/DeleteAllSecondStageItems()");
    return { secondStage: true };
  } catch {
    // only site collection admins may purge the second stage
    return { secondStage: false };
  }
}
