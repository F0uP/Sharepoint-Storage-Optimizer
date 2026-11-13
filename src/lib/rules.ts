import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { isTeamsRecording } from "./analysis";
import { INSTALLER_EXT, RAW_IMAGE_EXT } from "./file-types";
import type { FileCategory, SpFile } from "./types";

/**
 * Cleanup profiles ("Aufräum-Profile"): saved filters that are applied with one click.
 * All conditions must match; empty conditions are ignored.
 */
export interface CleanupRule {
  id: string;
  name: string;
  builtin?: boolean;
  categories: FileCategory[];
  /** lower-case extensions without dot */
  extensions: string[];
  /** semicolon-separated file name patterns with * and ?, e.g. "~$*;*.tmp" */
  namePattern?: string;
  /** case-insensitive substring of folder path or name */
  pathContains?: string;
  minSizeMB?: number;
  /** last modified at least this many months ago */
  olderThanMonths?: number;
  /** only copies of files that exist elsewhere (the oldest copy is kept) */
  duplicatesOnly?: boolean;
  teamsRecordingsOnly?: boolean;
}

const MB = 1024 ** 2;

export const BUILTIN_RULES: CleanupRule[] = [
  {
    id: "builtin-temp",
    name: "Temp- und Systemdateien",
    builtin: true,
    categories: [],
    extensions: [],
    namePattern: "~$*;*.tmp;*.bak;*.old;*.crdownload;*.part;thumbs.db;.ds_store;desktop.ini",
  },
  { id: "builtin-duplicates", name: "Doppelte Dateien", builtin: true, categories: [], extensions: [], duplicatesOnly: true },
  {
    id: "builtin-exports",
    name: "ZIP-Exporte älter als 3 Monate",
    builtin: true,
    categories: [],
    extensions: ["zip", "rar", "7z", "tar", "gz"],
    olderThanMonths: 3,
  },
  { id: "builtin-installers", name: "Installationsdateien", builtin: true, categories: [], extensions: [...INSTALLER_EXT] },
  {
    id: "builtin-recordings",
    name: "Teams-Aufnahmen älter als 2 Monate",
    builtin: true,
    categories: [],
    extensions: [],
    teamsRecordingsOnly: true,
    olderThanMonths: 2,
  },
  {
    id: "builtin-old-videos",
    name: "Videos ab 500 MB, älter als 3 Jahre",
    builtin: true,
    categories: ["video"],
    extensions: [],
    minSizeMB: 500,
    olderThanMonths: 36,
  },
  {
    id: "builtin-raw",
    name: "RAW- und Arbeitsdateien älter als 2 Jahre",
    builtin: true,
    categories: [],
    extensions: [...RAW_IMAGE_EXT],
    olderThanMonths: 24,
  },
];

function globToRegExp(glob: string): RegExp {
  const source = glob
    .trim()
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${source}$`, "i");
}

export function parsePatterns(pattern?: string): RegExp[] {
  return (pattern ?? "")
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .map(globToRegExp);
}

/** Ids of all copies except the oldest per content hash (same logic as the duplicate insight). */
export function duplicateCopyIds(files: SpFile[]): Set<string> {
  const groups = new Map<string, SpFile[]>();
  for (const f of files) {
    if (!f.hash || f.size < 1024) continue;
    const k = `${f.hash}:${f.size}`;
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  const ids = new Set<string>();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    for (const copy of g.toSorted((a, b) => Date.parse(a.created) - Date.parse(b.created)).slice(1)) ids.add(copy.id);
  }
  return ids;
}

export function matchRule(rule: CleanupRule, files: SpFile[], now = Date.now(), duplicates?: Set<string>): SpFile[] {
  const patterns = parsePatterns(rule.namePattern);
  const contains = rule.pathContains?.trim().toLowerCase();
  const exts = new Set(rule.extensions.map((e) => e.replace(/^\./, "").toLowerCase()));
  const cats = new Set(rule.categories);
  const cutoff = rule.olderThanMonths ? now - rule.olderThanMonths * 30.44 * 864e5 : undefined;
  const minBytes = rule.minSizeMB ? rule.minSizeMB * MB : 0;
  const dups = rule.duplicatesOnly ? (duplicates ?? duplicateCopyIds(files)) : undefined;

  return files.filter(
    (f) =>
      (!cats.size || cats.has(f.category)) &&
      (!exts.size || exts.has(f.ext)) &&
      (!patterns.length || patterns.some((p) => p.test(f.name))) &&
      (!contains || `${f.path}/${f.name}`.toLowerCase().includes(contains)) &&
      f.size >= minBytes &&
      (cutoff === undefined || Date.parse(f.modified) <= cutoff) &&
      (!dups || dups.has(f.id)) &&
      (!rule.teamsRecordingsOnly || isTeamsRecording(f)),
  );
}

/** Human-readable summary of a rule's conditions. */
export function describeRule(rule: CleanupRule): string[] {
  const parts: string[] = [];
  if (rule.categories.length) parts.push(`Typ: ${rule.categories.length} ausgewählt`);
  if (rule.extensions.length) parts.push(`Endung: ${rule.extensions.slice(0, 5).map((e) => `.${e}`).join(", ")}${rule.extensions.length > 5 ? " …" : ""}`);
  if (rule.namePattern) parts.push(`Name: ${rule.namePattern.split(";").slice(0, 3).join(", ")}${rule.namePattern.split(";").length > 3 ? " …" : ""}`);
  if (rule.pathContains) parts.push(`Pfad enthält „${rule.pathContains}“`);
  if (rule.minSizeMB) parts.push(`ab ${rule.minSizeMB} MB`);
  if (rule.olderThanMonths) parts.push(`älter als ${rule.olderThanMonths} ${rule.olderThanMonths === 1 ? "Monat" : "Monate"}`);
  if (rule.duplicatesOnly) parts.push("nur Kopien (Original bleibt)");
  if (rule.teamsRecordingsOnly) parts.push("nur Teams-Aufnahmen");
  return parts;
}

interface RulesState {
  custom: CleanupRule[];
  save(rule: CleanupRule): void;
  remove(id: string): void;
}

export const useRules = create<RulesState>()(
  persist(
    (set) => ({
      custom: [],
      save: (rule) =>
        set((s) => ({
          custom: s.custom.some((r) => r.id === rule.id) ? s.custom.map((r) => (r.id === rule.id ? rule : r)) : [...s.custom, rule],
        })),
      remove: (id) => set((s) => ({ custom: s.custom.filter((r) => r.id !== id) })),
    }),
    { name: "spo:rules", storage: createJSONStorage(() => localStorage), partialize: (s) => ({ custom: s.custom }) },
  ),
);

export function newRuleId() {
  return `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
