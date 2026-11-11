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
  return `﻿${Papa.unparse(data, { delimiter: ";" })}`;
}

export function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
