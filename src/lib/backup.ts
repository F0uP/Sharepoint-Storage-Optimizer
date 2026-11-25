import type { SpFile } from "./types";

/**
 * Where the local copies of "Sichern & löschen" land below the chosen folder. The desktop app turns each
 * segment into a valid file name (desktop/backup.mts) and never overwrites anything.
 */

export type BackupLayout = "site" | "library" | "flat";

export const BACKUP_LAYOUTS: { value: BackupLayout; label: string; hint: string }[] = [
  {
    value: "site",
    label: "Kompletter Pfad",
    hint: "Site › Bibliothek › Ordner – wie in SharePoint. So lassen sich auch mehrere Sites in denselben Zielordner sichern.",
  },
  { value: "library", label: "Ab Bibliothek", hint: "Bibliothek › Ordner – ohne eigenen Ordner für die Site." },
  {
    value: "flat",
    label: "Ohne Ordner",
    hint: "Alle Dateien direkt in den Zielordner. Gleichnamige erhalten „(2)“, „(3)“ … – woher sie stammen, steht im Inhaltsverzeichnis.",
  },
];

const LAYOUT_KEY = "spo:backup-layout";
const isLayout = (value: unknown): value is BackupLayout => BACKUP_LAYOUTS.some((l) => l.value === value);

/** The layout chosen last time (the complete SharePoint path by default). */
export function loadBackupLayout(): BackupLayout {
  try {
    const value = localStorage.getItem(LAYOUT_KEY);
    return isLayout(value) ? value : "site";
  } catch {
    return "site";
  }
}

export function saveBackupLayout(layout: BackupLayout) {
  try {
    localStorage.setItem(LAYOUT_KEY, layout);
  } catch {
    // private mode / storage blocked – the choice is simply not remembered
  }
}

/** A "/" in the display name of a site must not create extra folders. */
const siteFolder = (name: string) => name.replace(/[\\/]+/g, "-").trim() || "Site";

/** Folders and file name of the local copy, below the chosen folder. */
export function backupSegments(file: Pick<SpFile, "path" | "name">, layout: BackupLayout, siteName: string): string[] {
  if (layout === "flat") return [file.name];
  const folders = file.path.split("/").filter(Boolean);
  return layout === "site" ? [siteFolder(siteName), ...folders, file.name] : [...folders, file.name];
}

/** How many folders the backup creates, parents included. */
export function countFolders(paths: string[][]): number {
  const folders = new Set<string>();
  for (const segments of paths) for (let i = 1; i < segments.length; i++) folders.add(segments.slice(0, i).join("/").toLowerCase());
  return folders.size;
}

/** Explorer, Office and many backup tools fail on Windows paths of 260 characters or more. */
export const WINDOWS_MAX_PATH = 260;

/** Number of copies whose full local path would be too long for common Windows tools. */
export function countLongPaths(folder: string, paths: string[][]): number {
  const base = folder.replace(/[\\/]+$/, "").length + 1;
  return paths.filter((segments) => base + segments.join("\\").length >= WINDOWS_MAX_PATH).length;
}
