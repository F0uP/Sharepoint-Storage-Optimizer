import { largest, type Insight } from "./analysis";
import { ageInYears } from "./format";
import type { SpFile } from "./types";

/**
 * Folder tree of a site for the folder explorer and the folder report. Sizes always include subfolders –
 * that is what a folder costs when it is archived or cleaned up as a whole.
 */

export interface FolderNode {
  /** e.g. "Dokumente/Projekte/2021" – the library is the first segment */
  path: string;
  name: string;
  parent?: string;
  depth: number;
  /** all files below, subfolders included */
  bytes: number;
  count: number;
  /** files directly in this folder */
  ownBytes: number;
  ownCount: number;
  /** latest change below (ISO) */
  newest: string;
  /** largest first */
  children: FolderNode[];
}

export interface FolderTree {
  /** the libraries, largest first */
  roots: FolderNode[];
  byPath: Map<string, FolderNode>;
}

const bySize = (a: FolderNode, b: FolderNode) => b.bytes - a.bytes || a.name.localeCompare(b.name, "de");

/** Builds the tree in one pass over the files – a site has far fewer folders than files. */
export function folderTree(files: SpFile[]): FolderTree {
  const direct = new Map<string, { bytes: number; count: number; newest: string }>();
  for (const f of files) {
    const d = direct.get(f.path);
    if (!d) direct.set(f.path, { bytes: f.size, count: 1, newest: f.modified });
    else {
      d.bytes += f.size;
      d.count++;
      // Graph returns ISO timestamps – they compare as strings
      if (f.modified > d.newest) d.newest = f.modified;
    }
  }

  const byPath = new Map<string, FolderNode>();
  const node = (path: string): FolderNode => {
    let n = byPath.get(path);
    if (!n) {
      const cut = path.lastIndexOf("/");
      const parent = cut > 0 ? path.slice(0, cut) : undefined;
      n = {
        path,
        name: path.slice(cut + 1),
        parent,
        depth: parent === undefined ? 1 : node(parent).depth + 1,
        bytes: 0,
        count: 0,
        ownBytes: 0,
        ownCount: 0,
        newest: "",
        children: [],
      };
      byPath.set(path, n);
      if (parent !== undefined) byPath.get(parent)!.children.push(n);
    }
    return n;
  };

  for (const [path, d] of direct) {
    if (!path) continue;
    const own = node(path);
    own.ownBytes += d.bytes;
    own.ownCount += d.count;
    for (let n: FolderNode | undefined = own; n; n = n.parent === undefined ? undefined : byPath.get(n.parent)) {
      n.bytes += d.bytes;
      n.count += d.count;
      if (d.newest > n.newest) n.newest = d.newest;
    }
  }

  for (const n of byPath.values()) n.children.sort(bySize);
  const roots = [...byPath.values()].filter((n) => n.parent === undefined).sort(bySize);
  return { roots, byPath };
}

export function isInFolder(file: Pick<SpFile, "path">, folder: string): boolean {
  return file.path === folder || file.path.startsWith(`${folder}/`);
}

/** Folders whose name contains the query, at any depth, largest first. */
export function searchFolders(tree: FolderTree, query: string, limit = 200): FolderNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return largest(tree.byPath.values(), limit, (n) => n.bytes, (n) => n.name.toLowerCase().includes(q));
}

/** The parents of a folder, the library first – for the breadcrumb. */
export function ancestors(tree: FolderTree, path: string): FolderNode[] {
  const chain: FolderNode[] = [];
  for (let n = tree.byPath.get(path); n; n = n.parent === undefined ? undefined : tree.byPath.get(n.parent)) chain.unshift(n);
  return chain;
}

/* ------------------------------------------------------------- folder report */

export interface FolderSummary {
  folder: FolderNode;
  files: SpFile[];
  /** the site's findings, limited to this folder */
  insights: Insight[];
  /** old versions of the files below (known after a version scan) */
  versionBytes: number;
  /** files unchanged for two years or more */
  stale: { bytes: number; count: number };
  /** volume by time since the last change */
  ages: { label: string; bytes: number; count: number }[];
  /** who changed the files last, by volume */
  editors: { name: string; bytes: number; count: number }[];
  /** number of folders below, at any depth */
  subfolders: number;
}

const AGE_BUCKETS = [
  { label: "Im letzten Jahr geändert", below: 1 },
  { label: "Vor 1–2 Jahren", below: 2 },
  { label: "Vor 2–5 Jahren", below: 5 },
  { label: "Vor mehr als 5 Jahren", below: Infinity },
];

/** Everything the folder report shows. `insights` are those of the whole site (the app already has them). */
export function summarizeFolder(files: SpFile[], tree: FolderTree, path: string, insights: Insight[], now = Date.now()): FolderSummary | null {
  const folder = tree.byPath.get(path);
  if (!folder) return null;
  const inside = files.filter((f) => isInFolder(f, path));
  const ids = new Set(inside.map((f) => f.id));

  const stale = { bytes: 0, count: 0 };
  const ages = AGE_BUCKETS.map(({ label }) => ({ label, bytes: 0, count: 0 }));
  let versionBytes = 0;
  const editors = new Map<string, { name: string; bytes: number; count: number }>();
  for (const f of inside) {
    versionBytes += f.versionBytes ?? 0;
    const age = ageInYears(f.modified, now);
    if (age >= 2) {
      stale.bytes += f.size;
      stale.count++;
    }
    // an unreadable date belongs to no bucket
    const bucket = ages[AGE_BUCKETS.findIndex((b) => age < b.below)];
    if (bucket) {
      bucket.bytes += f.size;
      bucket.count++;
    }
    const name = f.modifiedBy?.trim() || "Unbekannt";
    const e = editors.get(name) ?? { name, bytes: 0, count: 0 };
    e.bytes += f.size;
    e.count++;
    editors.set(name, e);
  }

  return {
    folder,
    files: inside,
    insights: insights.map((i) => {
      const rows = i.rows.filter((r) => ids.has(r.file.id));
      return { ...i, rows, savings: rows.reduce((s, r) => s + r.bytes, 0) };
    }),
    versionBytes,
    stale,
    ages,
    editors: [...editors.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 8),
    subfolders: countBelow(folder),
  };
}

function countBelow(folder: FolderNode): number {
  let n = 0;
  for (const child of folder.children) n += 1 + countBelow(child);
  return n;
}
