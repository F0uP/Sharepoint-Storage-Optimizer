import Papa from "papaparse";
import { CATEGORY_META } from "./file-types";
import { formatBytes, formatDate } from "./format";
import type { SpFile } from "./types";

export interface CsvRow {
  file: SpFile;
  bytes: number;
  note?: string;
}

/** Excel-friendly CSV (UTF-8 BOM, semicolon) for reviewing a selection with colleagues. */
export function toCsv(rows: CsvRow[]): string {
  const data = rows.map(({ file, bytes, note }) => ({
    Name: file.name,
    Pfad: file.path,
    Typ: CATEGORY_META[file.category].label,
    "Größe (Bytes)": bytes,
    Größe: formatBytes(bytes),
    "Geändert am": formatDate(file.modified),
    "Geändert von": file.modifiedBy ?? "",
    Hinweis: note ?? "",
    Link: file.webUrl,
  }));
  return `﻿${Papa.unparse(data, { delimiter: ";", escapeFormulae: true })}`;
}

/** A file saved by "Sichern & löschen" and where its copy is (relative to the backup folder). */
export interface BackupCopy {
  file: SpFile;
  local: string;
  site: string;
}

/**
 * Table of contents of a backup: which local file came from where. Written next to the copies, so the origin
 * stays known after the originals are gone – especially for backups without folders.
 */
export function backupIndexCsv(copies: BackupCopy[]): string {
  const data = copies.map(({ file, local, site }) => ({
    "Lokale Datei": local,
    Site: site,
    "SharePoint-Pfad": `${file.path}/${file.name}`,
    "Größe (Bytes)": file.size,
    Größe: formatBytes(file.size),
    "Geändert am": formatDate(file.modified),
    "Geändert von": file.modifiedBy ?? "",
    "SharePoint-Link": file.webUrl,
  }));
  // file names come from SharePoint – "=…" must not become a formula in Excel
  return `﻿${Papa.unparse(data, { delimiter: ";", escapeFormulae: true, newline: "\r\n" })}\r\n`;
}

export function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
