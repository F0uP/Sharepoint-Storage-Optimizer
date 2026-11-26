import type { LibraryRef } from "./delta";
import { httpStatus } from "./retry";

/**
 * Every document library of a site: those of the site itself and of all its subsites, at any depth. Graph lists
 * libraries per web (`/sites/{id}/drives` – paged), while the storage quota and the file count SharePoint shows
 * cover the whole site collection. Without the subsites a scan silently misses their files.
 */

interface Page<T> {
  value?: T[];
  "@odata.nextLink"?: string;
}

interface DriveInfo {
  id?: string;
  name?: string;
  webUrl?: string;
  driveType?: string;
}

interface WebInfo {
  id?: string;
  name?: string;
  displayName?: string;
  webUrl?: string;
}

export type GetJson = <T>(url: string) => Promise<T>;

/** guards against cycles and absurd structures */
const MAX_WEBS = 2000;
const MAX_PAGES = 500;

async function readAll<T>(get: GetJson, url: string): Promise<T[]> {
  const items: T[] = [];
  let next: string | undefined = url;
  for (let page = 0; next && page < MAX_PAGES; page++) {
    const res: Page<T> = await get<Page<T>>(next);
    for (const item of res.value ?? []) items.push(item);
    next = res["@odata.nextLink"];
  }
  return items;
}

/** A subsite the account may not read (or that was just deleted) is skipped; any other error stops the scan. */
const isInaccessible = (error: unknown) => [401, 403, 404].includes(httpStatus(error) ?? 0);

/** A "/" in a subsite title must not become an extra folder level. */
const segment = (title: string) => title.replace(/[\\/]+/g, "-").trim() || "Unterwebsite";

export async function listAllLibraries(site: { id: string; webUrl: string }, get: GetJson): Promise<LibraryRef[]> {
  const libraries: LibraryRef[] = [];
  const seenDrives = new Set<string>();
  const seenWebs = new Set<string>();
  // breadth first: the site's own libraries come first, then those of its subsites
  const queue: { id: string; webUrl: string; prefix: string }[] = [{ id: site.id, webUrl: site.webUrl, prefix: "" }];

  while (queue.length && seenWebs.size < MAX_WEBS) {
    const web = queue.shift()!;
    if (seenWebs.has(web.id)) continue;
    seenWebs.add(web.id);
    const isRoot = web.prefix === "";

    let drives: DriveInfo[];
    try {
      drives = await readAll<DriveInfo>(get, `/sites/${web.id}/drives?$select=id,name,webUrl,driveType`);
    } catch (error) {
      if (isRoot || !isInaccessible(error)) throw error;
      continue;
    }
    for (const d of drives) {
      if (d.driveType !== "documentLibrary" || !d.id || seenDrives.has(d.id)) continue;
      seenDrives.add(d.id);
      // libraries of subsites carry the subsite in their name – their paths then start with it
      libraries.push({ id: d.id, name: `${web.prefix}${d.name ?? ""}`, webUrl: d.webUrl ?? "", siteUrl: web.webUrl });
    }

    let subsites: WebInfo[] = [];
    try {
      subsites = await readAll<WebInfo>(get, `/sites/${web.id}/sites?$select=id,name,displayName,webUrl`);
    } catch (error) {
      if (!isInaccessible(error)) throw error;
    }
    for (const s of subsites) {
      if (!s.id) continue;
      queue.push({ id: s.id, webUrl: s.webUrl ?? web.webUrl, prefix: `${web.prefix}${segment(s.displayName || s.name || "")}/` });
    }
  }
  return libraries;
}
