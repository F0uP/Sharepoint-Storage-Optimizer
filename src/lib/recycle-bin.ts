import type { SpFile } from "./types";

/** Item of the SharePoint recycle bin (`/_api/web/RecycleBin`). */
export interface RecycleItem {
  Id: string;
  LeafName: string;
  /** server-relative folder, e.g. "sites/marketing/Shared Documents/Videos/2024" */
  DirName: string;
  Size: string | number;
  DeletedDate: string;
}

/** Folder path below the library (the library's display name differs from its URL name). */
export function folderTail(path: string): string {
  return path.split("/").slice(1).join("/");
}

/**
 * Finds the recycle bin entry of each deleted file: same name, same folder, deleted after the action
 * started. Same size is preferred (the recycle bin size can include old versions), then the newest.
 */
export function matchRecycleItems(files: SpFile[], items: RecycleItem[], deletedAfter: string): Map<string, string> {
  const since = Date.parse(deletedAfter) - 5 * 60_000;
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const f of files) {
    const tail = folderTail(f.path).toLowerCase();
    const candidates = items.filter((item) => {
      if (used.has(item.Id) || item.LeafName !== f.name || Date.parse(item.DeletedDate) < since) return false;
      if (!tail) return true;
      let dir = item.DirName;
      try {
        dir = decodeURIComponent(dir);
      } catch {
        // keep raw
      }
      return dir.toLowerCase().endsWith(`/${tail}`);
    });
    const best = candidates.toSorted(
      (a, b) =>
        Number(Number(b.Size) === f.size) - Number(Number(a.Size) === f.size) ||
        Date.parse(b.DeletedDate) - Date.parse(a.DeletedDate),
    )[0];
    if (best) {
      used.add(best.Id);
      out.set(f.id, best.Id);
    }
  }
  return out;
}

/** OData filter for a batch of file names (quotes are doubled). */
export function leafNameFilter(names: string[]): string {
  return names.map((n) => `LeafName eq '${n.replace(/'/g, "''")}'`).join(" or ");
}
