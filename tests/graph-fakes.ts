import type { DriveItem } from "@microsoft/microsoft-graph-types";
import type { DeltaPage } from "@/lib/delta";
import type { KeyValueStorage } from "@/lib/kv";

/** Delta items as Microsoft Graph returns them. */
export const rootItem = (id = "root"): DriveItem => ({ id, name: "root", root: {}, folder: {} });

export const folderItem = (id: string, name: string, parent = "root"): DriveItem => ({
  id,
  name,
  folder: { childCount: 0 },
  parentReference: { id: parent },
});

export const fileItem = (id: string, name: string, parent = "root", extra: DriveItem = {}): DriveItem => ({
  id,
  name,
  size: 100,
  file: { mimeType: "application/pdf", hashes: { quickXorHash: `h-${id}` } },
  parentReference: { id: parent },
  createdDateTime: "2024-01-01T00:00:00Z",
  lastModifiedDateTime: "2024-02-01T00:00:00Z",
  webUrl: `https://contoso.sharepoint.com/${id}`,
  ...extra,
});

export const deletedItem = (id: string): DriveItem => ({ id, deleted: { state: "deleted" } });

/** Error as thrown by the Graph SDK. */
export const graphError = (statusCode: number, message = `HTTP ${statusCode}`) => Object.assign(new Error(message), { statusCode });

/**
 * A fake delta endpoint: `chains` maps a start URL to its pages; every page links to the next one,
 * the last one returns `deltaLink`. Records every requested URL.
 */
export function deltaServer() {
  const pages = new Map<string, DeltaPage | (() => DeltaPage)>();
  const requested: string[] = [];
  return {
    requested,
    /** registers pages reachable from `start`; the last page ends the round with `deltaLink` */
    chain(start: string, contents: DriveItem[][], deltaLink: string) {
      contents.forEach((value, i) => {
        const url = i === 0 ? start : `${start}#page${i}`;
        const last = i === contents.length - 1;
        pages.set(url, last ? { value, "@odata.deltaLink": deltaLink } : { value, "@odata.nextLink": `${start}#page${i + 1}` });
      });
    },
    /** answers `url` with an error (or anything else) */
    on(url: string, handler: () => DeltaPage) {
      pages.set(url, handler);
    },
    async fetchPage(url: string): Promise<DeltaPage> {
      requested.push(url);
      const page = pages.get(url);
      if (!page) throw graphError(404, `Unbekannte URL ${url}`);
      return typeof page === "function" ? page() : structuredClone(page);
    },
  };
}

/** In-memory replacement for IndexedDB (values are cloned like IndexedDB does). */
export function memoryStorage(): KeyValueStorage & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    getMany: async <T>(keys: string[]) => keys.map((k) => (data.has(k) ? (structuredClone(data.get(k)) as T) : undefined)),
    setMany: async (entries) => {
      for (const [k, v] of entries) data.set(k, structuredClone(v));
    },
    delMany: async (keys) => {
      for (const k of keys) data.delete(k);
    },
    keys: async () => [...data.keys()],
  };
}
