import type { DriveSummary } from "./types";

export interface LibraryGap {
  name: string;
  /** items (files and folders) SharePoint counts */
  expected: number;
  /** items the scan read */
  read: number;
}

/**
 * Libraries for which SharePoint counts clearly more items than the scan read – largest gap first. Small
 * differences are normal (files added since the scan) and not reported.
 */
export function incompleteLibraries(drives: DriveSummary[], counts: Map<string, number>): LibraryGap[] {
  const gaps: LibraryGap[] = [];
  for (const d of drives) {
    const expected = counts.get(d.id);
    // scans of older versions do not know their folders – nothing to compare
    if (expected === undefined || d.folderCount === undefined) continue;
    const read = d.fileCount + d.folderCount;
    if (expected - read > Math.max(50, expected * 0.01)) gaps.push({ name: d.name, expected, read });
  }
  return gaps.sort((a, b) => b.expected - b.read - (a.expected - a.read));
}
