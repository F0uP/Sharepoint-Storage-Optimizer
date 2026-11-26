import { describe, expect, it } from "vitest";
import { incompleteLibraries } from "./completeness";
import type { DriveSummary } from "./types";

const drive = (id: string, fileCount: number, folderCount?: number): DriveSummary => ({
  id,
  name: `Bibliothek ${id}`,
  webUrl: "",
  fileCount,
  folderCount,
  totalBytes: 0,
});

describe("incompleteLibraries", () => {
  it("reports libraries SharePoint counts clearly more items for, largest gap first", () => {
    const drives = [drive("a", 200_000, 20_000), drive("b", 900, 100), drive("c", 10_000, 500)];
    const counts = new Map([
      ["a", 1_100_000],
      ["b", 1_000],
      ["c", 50_000],
    ]);
    expect(incompleteLibraries(drives, counts)).toEqual([
      { name: "Bibliothek a", expected: 1_100_000, read: 220_000 },
      { name: "Bibliothek c", expected: 50_000, read: 10_500 },
    ]);
  });

  it("tolerates files added since the scan", () => {
    expect(incompleteLibraries([drive("a", 9_950, 0)], new Map([["a", 10_000]]))).toEqual([]);
    expect(incompleteLibraries([drive("a", 100_000, 0)], new Map([["a", 100_900]]))).toEqual([]);
  });

  it("skips libraries without a count or from scans that do not know their folders", () => {
    expect(incompleteLibraries([drive("a", 10, undefined), drive("b", 10, 0)], new Map([["a", 5_000]]))).toEqual([]);
  });
});
