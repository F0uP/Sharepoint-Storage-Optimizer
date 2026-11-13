import { Client } from "@microsoft/microsoft-graph-client";
import type { Drive, DriveItem, Site } from "@microsoft/microsoft-graph-types";
import { categorize, getExtension } from "./file-types";
import { APPROVAL_SCOPES, ARCHIVE_SCOPES, GRAPH_SCOPES, getAccessToken, MAIL_SCOPES, sharePointScopes } from "./msal";
import { leafNameFilter, matchRecycleItems, type RecycleItem } from "./recycle-bin";
import type {
  BulkResult,
  DriveSummary,
  LibraryVersionSetting,
  OwnerMail,
  Quota,
  RetentionInfo,
  ScanProgress,
  ScanResult,
  SiteRef,
  SpFile,
} from "./types";

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
    lastModified: site.lastModifiedDateTime ?? undefined,
  };
}

/** Sites the user can access; without a query all of them (paged, up to 500). */
export async function searchSites(query: string): Promise<SiteRef[]> {
  const q = query.trim() || "*";
  const sites: SiteRef[] = [];
  let res: { value: Site[]; "@odata.nextLink"?: string } = await graph()
    .api("/sites")
    .query({ search: q })
    .select("id,displayName,name,webUrl,description,lastModifiedDateTime")
    .top(100)
    .get();
  for (let page = 0; ; page++) {
    sites.push(...res.value.map(toSiteRef));
    if (!res["@odata.nextLink"] || q !== "*" || page >= 4) break;
    res = await graph().api(res["@odata.nextLink"]).get();
  }
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
      // SharePoint adds the editor's e-mail to the identity (not part of the generic type)
      modifiedByEmail: (item.lastModifiedBy?.user as { email?: string } | undefined)?.email ?? undefined,
      modifiedById: item.lastModifiedBy?.user?.id ?? undefined,
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

async function sharePointRest(
  siteUrl: string,
  path: string,
  method: "GET" | "POST" | "MERGE" = "POST",
  body?: Record<string, unknown>,
) {
  const token = await getAccessToken(sharePointScopes(siteUrl));
  const res = await fetch("/api/sharepoint", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ siteUrl, path, method, body }),
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

/* -------------------------------------------------------- site overview */

/** Quota of many sites at once (JSON batching) – the storage overview of the tenant. */
export async function siteQuotas(
  sites: SiteRef[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, Quota | undefined>> {
  const requests: BatchRequest[] = sites.map((site, i) => ({ id: String(i), method: "GET", url: `/sites/${site.id}/drive?$select=quota` }));
  const responses = await runBatched(requests, onProgress);
  return new Map(sites.map((site, i) => [site.id, toQuota(responses.get(String(i))?.body?.quota as Drive["quota"])]));
}

/* ------------------------------------------------------ version limits */

export async function getVersionSettings(site: SiteRef, drives: DriveSummary[]): Promise<LibraryVersionSetting[]> {
  const lists = await runBatched(drives.map((d, i) => ({ id: String(i), method: "GET" as const, url: `/drives/${d.id}/list?$select=id` })));
  const out: LibraryVersionSetting[] = [];
  for (const [i, drive] of drives.entries()) {
    const listId = lists.get(String(i))?.body?.id;
    if (typeof listId !== "string") continue;
    const data = await sharePointRest(site.webUrl, `/_api/web/lists(guid'${listId}')?$select=EnableVersioning,MajorVersionLimit`, "GET");
    const enabled = Boolean(data.EnableVersioning);
    out.push({ driveId: drive.id, driveName: drive.name, listId, enabled, majorLimit: enabled ? Number(data.MajorVersionLimit) || null : null });
  }
  return out;
}

/** Limits the number of major versions a library keeps (applies to new versions). */
export async function setVersionLimit(site: SiteRef, setting: LibraryVersionSetting, limit: number): Promise<void> {
  await sharePointRest(site.webUrl, `/_api/web/lists(guid'${setting.listId}')`, "MERGE", {
    EnableVersioning: true,
    MajorVersionLimit: limit,
  });
}

/* ------------------------------------------------------------- restore */

/** Restores files deleted by this app from the recycle bin (matched by name, folder and time). */
export async function restoreFiles(
  site: SiteRef,
  files: SpFile[],
  deletedAfter: string,
  onProgress?: (done: number, total: number) => void,
): Promise<BulkResult> {
  const lookup = async (subset: SpFile[]) => {
    const names = [...new Set(subset.map((f) => f.name))];
    const items: RecycleItem[] = [];
    for (let i = 0; i < names.length; i += 10) {
      const filter = encodeURIComponent(leafNameFilter(names.slice(i, i + 10)));
      const data = await sharePointRest(
        site.webUrl,
        `/_api/web/RecycleBin?$select=Id,LeafName,DirName,Size,DeletedDate&$top=1000&$filter=${filter}`,
        "GET",
      );
      items.push(...((data.value ?? []) as RecycleItem[]));
    }
    return matchRecycleItems(subset, items, deletedAfter);
  };
  // right after deleting, the recycle bin can lag a few seconds behind Graph
  const matches = await lookup(files);
  for (let attempt = 0; attempt < 3 && matches.size < files.length; attempt++) {
    await sleep(2000);
    for (const [id, itemId] of await lookup(files.filter((f) => !matches.has(f.id)))) matches.set(id, itemId);
  }
  const result: BulkResult = { succeeded: [], failed: [] };
  let done = 0;
  const queue = [...files];
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      const id = matches.get(f.id);
      try {
        if (!id) throw new Error("Nicht im Papierkorb gefunden");
        await sharePointRest(site.webUrl, `/_api/web/RecycleBin('${id}')/Restore()`);
        result.succeeded.push(f.id);
      } catch (e) {
        result.failed.push({ id: f.id, error: e instanceof Error ? e.message : String(e) });
      }
      onProgress?.(++done, files.length);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return result;
}

/* ------------------------------------------------ download & replace */

/** Pre-authenticated, short-lived download URLs (the desktop app downloads without a token). */
export async function getDownloadUrls(files: SpFile[]): Promise<Map<string, string>> {
  const responses = await runBatched(
    files.map((f, i) => ({
      id: String(i),
      method: "GET" as const,
      url: `/drives/${f.driveId}/items/${f.id}?$select=id,@microsoft.graph.downloadUrl`,
    })),
  );
  const out = new Map<string, string>();
  files.forEach((f, i) => {
    const url = responses.get(String(i))?.body?.["@microsoft.graph.downloadUrl"];
    if (typeof url === "string") out.set(f.id, url);
  });
  return out;
}

/** Upload session that replaces the content of an existing file (new version, same name and links). */
export async function createUploadSession(file: SpFile): Promise<string> {
  const res: { uploadUrl: string } = await graph()
    .api(`/drives/${file.driveId}/items/${file.id}/createUploadSession`)
    .post({ item: { "@microsoft.graph.conflictBehavior": "replace" } });
  return res.uploadUrl;
}

/* --------------------------------------------------------------- mail */

/** Sends one mail per owner from the signed-in user's mailbox (asks for Mail.Send consent once). */
export async function sendMails(mails: OwnerMail[], onProgress?: (done: number, total: number) => void): Promise<BulkResult> {
  const token = await getAccessToken(MAIL_SCOPES);
  const result: BulkResult = { succeeded: [], failed: [] };
  for (const [i, mail] of mails.entries()) {
    try {
      const res = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            subject: mail.subject,
            body: { contentType: "HTML", content: mail.html },
            toRecipients: [{ emailAddress: { address: mail.to.email, name: mail.to.name } }],
          },
          saveToSentItems: true,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
      }
      result.succeeded.push(mail.to.email);
    } catch (e) {
      result.failed.push({ id: mail.to.email, error: e instanceof Error ? e.message : String(e) });
    }
    onProgress?.(i + 1, mails.length);
  }
  return result;
}

/* ------------------------------------------------------------- previews */

/** Medium preview images (pre-authenticated URLs) for images, videos and documents. */
export async function getThumbnails(files: SpFile[]): Promise<Map<string, string>> {
  const responses = await runBatched(
    files.map((f, i) => ({ id: String(i), method: "GET" as const, url: `/drives/${f.driveId}/items/${f.id}/thumbnails/0/medium` })),
  );
  const out = new Map<string, string>();
  files.forEach((f, i) => {
    const url = responses.get(String(i))?.body?.url;
    if (typeof url === "string") out.set(f.id, url);
  });
  return out;
}

/* ------------------------------------------------------------ retention */

/** Retention labels of the given files (files without a label are missing from the map). */
export async function getRetentionLabels(files: SpFile[]): Promise<Map<string, RetentionInfo>> {
  const responses = await runBatched(
    files.map((f, i) => ({ id: String(i), method: "GET" as const, url: `/drives/${f.driveId}/items/${f.id}/retentionLabel` })),
  );
  const out = new Map<string, RetentionInfo>();
  files.forEach((f, i) => {
    const r = responses.get(String(i));
    const body = r?.body as
      | { name?: string; retentionSettings?: { isDeleteAllowed?: boolean; behaviorDuringRetentionPeriod?: string } }
      | undefined;
    if (r?.status !== 200 || !body?.name) return;
    out.set(f.id, {
      name: body.name,
      deleteAllowed: body.retentionSettings?.isDeleteAllowed !== false,
      retains: /^retain/i.test(body.retentionSettings?.behaviorDuringRetentionPeriod ?? ""),
    });
  });
  return out;
}

/**
 * Size of the Preservation Hold Library: with retention policies, deleted and changed files are kept
 * there and still count against the quota. null = the site has none.
 */
export async function getPreservationHold(site: SiteRef): Promise<{ bytes: number; files: number } | null> {
  const relative = new URL(site.webUrl).pathname.replace(/\/$/, "").replace(/'/g, "''");
  try {
    const data = await sharePointRest(
      site.webUrl,
      `/_api/web/GetFolderByServerRelativeUrl('${relative}/PreservationHoldLibrary')/StorageMetrics`,
      "GET",
    );
    return { bytes: Number(data.TotalSize ?? 0), files: Number(data.TotalFileCount ?? 0) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/not found|nicht gefunden|does not exist|404/i.test(message)) return null;
    throw e;
  }
}

/* ------------------------------------------------- Graph beta: archive, approvals */

const GRAPH_BETA = "https://graph.microsoft.com/beta";

async function betaRequest(url: string, scopes: string[], init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken(scopes);
  return fetch(url.startsWith("http") ? url : `${GRAPH_BETA}${url}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
  });
}

async function betaError(res: Response, fallback: string): Promise<Error> {
  const data = await res.json().catch(() => ({}));
  return new Error(data?.error?.message ?? `${fallback} (HTTP ${res.status})`);
}

/** Moves a site to Microsoft 365 Archive (Graph beta, SharePoint administrators only). */
export async function archiveSite(site: SiteRef): Promise<void> {
  const res = await betaRequest(`/sites/${site.id}/archive`, ARCHIVE_SCOPES, { method: "POST" });
  if (res.ok) return;
  if (res.status === 401 || res.status === 403) {
    throw new Error("Archivieren ist nur mit der Rolle SharePoint-Administrator und aktivem Microsoft 365 Archive möglich.");
  }
  throw await betaError(res, "Archivieren fehlgeschlagen");
}

export interface ApprovalRequest {
  title: string;
  description: string;
  approver: { id: string; name: string };
}

/**
 * Creates an approval in the Teams app "Approvals" (Graph beta). The id of the new item is delivered
 * through a long-running operation; if that is not readable, the item is found by its unique title.
 */
export async function createApproval({ title, description, approver }: ApprovalRequest): Promise<string> {
  const res = await betaRequest("/solutions/approval/approvalItems", APPROVAL_SCOPES, {
    method: "POST",
    body: JSON.stringify({
      displayName: title,
      description,
      approvalType: "basic",
      allowEmailNotification: true,
      approvers: [{ user: { id: approver.id, displayName: approver.name } }],
    }),
  });
  if (!res.ok) throw await betaError(res, "Freigabe konnte nicht angelegt werden");

  const location = res.headers.get("location");
  for (let i = 0; location && i < 10; i++) {
    await sleep(1500);
    const op = await betaRequest(location, APPROVAL_SCOPES);
    if (!op.ok) break;
    const data = (await op.json()) as { status?: string; resourceLocation?: string; error?: { message?: string } };
    if (data.resourceLocation) return data.resourceLocation.split("/").pop()!;
    if (data.status === "failed") throw new Error(data.error?.message ?? "Freigabe konnte nicht angelegt werden");
  }
  for (let i = 0; i < 6; i++) {
    await sleep(2000);
    const list = await betaRequest("/solutions/approval/approvalItems?$select=id,displayName&$top=100", APPROVAL_SCOPES);
    if (!list.ok) continue;
    const data = (await list.json()) as { value?: { id: string; displayName: string }[] };
    const hit = data.value?.find((item) => item.displayName === title);
    if (hit) return hit.id;
  }
  throw new Error("Die Freigabe wurde angelegt, ist aber noch nicht abrufbar.");
}

export async function getApproval(id: string): Promise<{ state: string; result?: string }> {
  const res = await betaRequest(`/solutions/approval/approvalItems/${id}?$select=state,result`, APPROVAL_SCOPES);
  if (!res.ok) throw await betaError(res, "Freigabe konnte nicht gelesen werden");
  return (await res.json()) as { state: string; result?: string };
}
