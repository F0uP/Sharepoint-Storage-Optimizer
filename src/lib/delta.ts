import type { DriveItem } from "@microsoft/microsoft-graph-types";
import { categorize, getExtension } from "./file-types";
import { throwIfAborted } from "./retry";
import type { FolderEntry, SpFile } from "./types";

/**
 * Inventory of a document library via the Graph delta query. The first round lists every item; its final
 * deltaLink later returns only what changed since – new, changed, moved, renamed and deleted items.
 * Delta responses carry no paths, so the folder tree is kept and paths are rebuilt from it.
 */

export const DELTA_SELECT = [
  "id", "name", "size", "file", "folder", "package", "root", "deleted", "image", "video", "audio", "photo",
  "parentReference", "createdDateTime", "lastModifiedDateTime", "lastModifiedBy", "webUrl",
].join(",");

export const initialLink = (driveId: string) => `/drives/${driveId}/root/delta?$select=${DELTA_SELECT}`;

export interface DeltaPage {
  value?: DriveItem[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
}

/** One change as applied (and stored in scan checkpoints): folder upsert, file upsert or removal. */
export type DeltaOp = { folder: FolderEntry } | { file: SpFile } | { removed: string };

export interface LibraryRef {
  id: string;
  name: string;
  webUrl: string;
}

export interface DriveState extends LibraryRef {
  /** nextLink while a round is running, deltaLink once it is complete */
  link: string;
  complete: boolean;
  folders: Map<string, FolderEntry>;
  files: Map<string, SpFile>;
  /** folders removed in this round – their content is dropped when the round is finished */
  removedFolders: Set<string>;
}

export function newDrive(library: LibraryRef): DriveState {
  return {
    ...library,
    link: initialLink(library.id),
    complete: false,
    folders: new Map(),
    files: new Map(),
    removedFolders: new Set(),
  };
}

/** State of a library from a cached scan – the next round fetches only the changes. */
export function cachedDrive(library: LibraryRef, deltaLink: string, folders: FolderEntry[], files: SpFile[]): DriveState {
  return {
    ...library,
    link: deltaLink,
    complete: true,
    folders: new Map(folders.map((f) => [f.id, f])),
    files: new Map(files.map((f) => [f.id, f])),
    removedFolders: new Set(),
  };
}

/** files created by this module and not handed out yet – finishDrive may complete them in place */
const unfinished = new WeakSet<SpFile>();

function toSpFile(item: DriveItem, drive: LibraryRef): SpFile {
  const name = item.name ?? "";
  const hashes = item.file?.hashes;
  const file: SpFile = {
    id: item.id!,
    driveId: drive.id,
    driveName: drive.name,
    name,
    ext: getExtension(name),
    // filled in when the round is finished and all folders are known
    path: "",
    parentId: item.parentReference?.id ?? undefined,
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
  };
  unfinished.add(file);
  return file;
}

/** Compact form of a delta item – the raw Graph objects are not kept (hundreds of thousands per library). */
export function toOp(item: DriveItem, drive: LibraryRef): DeltaOp | null {
  if (!item.id) return null;
  if (item.deleted) return { removed: item.id };
  if (item.root) return { folder: { id: item.id, name: item.name ?? "", root: true } };
  // OneNote notebooks (packages) are folders: their sections are listed as files
  if (item.folder || item.package) {
    return { folder: { id: item.id, name: item.name ?? "", parentId: item.parentReference?.id ?? undefined } };
  }
  if (item.file) return { file: toSpFile(item, drive) };
  return null;
}

export function applyOp(state: DriveState, op: DeltaOp) {
  if ("removed" in op) {
    state.files.delete(op.removed);
    if (state.folders.delete(op.removed)) state.removedFolders.add(op.removed);
    return;
  }
  if ("folder" in op) {
    state.folders.set(op.folder.id, op.folder);
    // restored in the same round (same id) – its content stays
    state.removedFolders.delete(op.folder.id);
    return;
  }
  const previous = state.files.get(op.file.id);
  // the version figures stay valid only while the file itself is unchanged
  const unchanged = previous?.versionCount !== undefined && previous.size === op.file.size && previous.modified === op.file.modified;
  if (!unchanged) return void state.files.set(op.file.id, op.file);
  const file = { ...op.file, versionCount: previous.versionCount, versionBytes: previous.versionBytes };
  unfinished.add(file);
  state.files.set(file.id, file);
}

/**
 * Files of a library with their current paths. Paths are rebuilt from the folder tree, so renamed or moved
 * folders and libraries show up everywhere. A file object, once handed out, is never changed again: a file
 * whose path changed gets a new object, unchanged files keep theirs.
 * `finish` ends the round: the content of removed folders (Graph does not always list it separately) is dropped.
 */
function collectFiles(state: DriveState, finish: boolean): SpFile[] {
  // null = inside a removed folder
  const paths = new Map<string, string | null>();
  const pathOf = (id: string | undefined, depth = 0): string | null => {
    if (!id || depth > 256) return state.name;
    if (state.removedFolders.has(id)) return null;
    const known = paths.get(id);
    if (known !== undefined) return known;
    const folder = state.folders.get(id);
    let path: string | null;
    if (!folder || folder.root) path = state.name;
    else {
      const parent = pathOf(folder.parentId, depth + 1);
      path = parent === null ? null : `${parent}/${folder.name}`;
    }
    paths.set(id, path);
    return path;
  };

  if (finish) for (const id of state.folders.keys()) if (pathOf(id) === null) state.folders.delete(id);

  const files: SpFile[] = [];
  for (const [id, file] of state.files) {
    // files cached before folder tracking existed keep their stored path
    const path = file.parentId === undefined ? file.path : pathOf(file.parentId);
    if (path === null) {
      if (finish) state.files.delete(id);
      continue;
    }
    if (unfinished.delete(file)) {
      // created in this round, not handed out yet – completed in place
      file.path = path;
      file.driveName = state.name;
      files.push(file);
    } else if (file.path === path && file.driveName === state.name) {
      files.push(file);
    } else {
      const moved = { ...file, path, driveName: state.name };
      // later calls hand out this object again
      state.files.set(id, moved);
      files.push(moved);
    }
  }
  if (finish) state.removedFolders.clear();
  return files;
}

/** Ends a round and returns the files of the library. */
export const finishDrive = (state: DriveState) => collectFiles(state, true);

/** Interim file list while a round is still running (shown while a large site is read). */
export const snapshotDrive = (state: DriveState) => collectFiles(state, false);

export interface RoundOptions {
  signal?: AbortSignal;
  /** after each page with the changes it brought – for progress and checkpoints */
  onPage?: (ops: DeltaOp[], state: DriveState) => void | Promise<void>;
}

/** Follows the delta pages from `state.link` until the deltaLink; the state is updated page by page. */
export async function runRound(state: DriveState, fetchPage: (url: string) => Promise<DeltaPage>, { signal, onPage }: RoundOptions = {}) {
  state.complete = false;
  for (;;) {
    throwIfAborted(signal);
    const page = await fetchPage(state.link);
    throwIfAborted(signal);
    const ops: DeltaOp[] = [];
    for (const item of page.value ?? []) {
      const op = toOp(item, state);
      if (!op) continue;
      applyOp(state, op);
      ops.push(op);
    }
    const next = page["@odata.nextLink"];
    const delta = page["@odata.deltaLink"];
    if (!next && !delta) throw new Error("Microsoft Graph hat die Dateiliste ohne Fortsetzung beendet – bitte erneut versuchen.");
    state.link = next ?? delta!;
    state.complete = !next;
    await onPage?.(ops, state);
    if (state.complete) return;
  }
}
