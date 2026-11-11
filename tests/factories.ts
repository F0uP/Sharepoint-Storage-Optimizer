import type { ScanResult, SpFile } from "@/lib/types";

let n = 0;

export const MB = 1024 ** 2;
export const GB = 1024 ** 3;

/** Builds a file with sensible defaults; override only what a test cares about. */
export function makeFile(overrides: Partial<SpFile> = {}): SpFile {
  n++;
  const name = overrides.name ?? `Datei ${n}.docx`;
  return {
    id: `f${n}`,
    driveId: "d1",
    driveName: "Dokumente",
    name,
    ext: name.includes(".") ? name.split(".").pop()!.toLowerCase() : "",
    path: "Dokumente/Projekte",
    size: 1 * MB,
    category: "document",
    created: "2024-01-01T00:00:00Z",
    modified: "2024-06-01T00:00:00Z",
    webUrl: `https://contoso.sharepoint.com/sites/test/${n}`,
    hash: `hash-${n}`,
    ...overrides,
  };
}

export function makeScan(files: SpFile[], overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    site: { id: "site-1", name: "Testsite", webUrl: "https://contoso.sharepoint.com/sites/test" },
    scannedAt: "2026-11-01T00:00:00Z",
    drives: [{ id: "d1", name: "Dokumente", webUrl: "", fileCount: files.length, totalBytes: files.reduce((s, f) => s + f.size, 0) }],
    files,
    quota: { total: 100 * GB, used: 50 * GB, remaining: 50 * GB, deleted: 2 * GB },
    ...overrides,
  };
}
