import { describe, expect, it } from "vitest";
import { makeFile, MB } from "../../tests/factories";
import { computeInsights } from "./analysis";
import { ancestors, folderTree, isInFolder, searchFolders, summarizeFolder } from "./folders";

const NOW = Date.parse("2026-11-01T00:00:00Z");
const files = [
  makeFile({ name: "Plan.pdf", path: "Dokumente/Projekte/2021", size: 40 * MB, modified: "2021-01-10T00:00:00Z", modifiedBy: "Anna" }),
  makeFile({ name: "Plan Kopie.pdf", path: "Dokumente/Projekte/2021/Alt", size: 40 * MB, modified: "2026-10-01T00:00:00Z", hash: "same", modifiedBy: "Ben" }),
  makeFile({ name: "Original.pdf", path: "Dokumente/Archiv", size: 40 * MB, created: "2020-01-01T00:00:00Z", hash: "same", modifiedBy: "Anna" }),
  makeFile({ name: "Notiz.docx", path: "Dokumente/Projekte", size: 2 * MB, modified: "2026-09-01T00:00:00Z" }),
  makeFile({ name: "Logo.png", path: "Marketing", size: 5 * MB }),
];

describe("folderTree", () => {
  const tree = folderTree(files);

  it("adds up every folder including its subfolders", () => {
    expect(tree.roots.map((r) => [r.name, r.bytes / MB, r.count])).toEqual([
      ["Dokumente", 122, 4],
      ["Marketing", 5, 1],
    ]);
    const projekte = tree.byPath.get("Dokumente/Projekte")!;
    expect(projekte).toMatchObject({ bytes: 82 * MB, count: 3, ownBytes: 2 * MB, ownCount: 1, depth: 2, newest: "2026-10-01T00:00:00Z" });
    // largest first
    expect(tree.byPath.get("Dokumente")!.children.map((c) => c.name)).toEqual(["Projekte", "Archiv"]);
    // folders that only contain folders exist as well
    expect(tree.byPath.get("Dokumente/Projekte/2021")!.children.map((c) => c.path)).toEqual(["Dokumente/Projekte/2021/Alt"]);
  });

  it("finds folders at any depth and the way to them", () => {
    expect(searchFolders(tree, "alt").map((n) => n.path)).toEqual(["Dokumente/Projekte/2021/Alt"]);
    expect(searchFolders(tree, "  ")).toEqual([]);
    expect(ancestors(tree, "Dokumente/Projekte/2021").map((n) => n.name)).toEqual(["Dokumente", "Projekte", "2021"]);
  });

  it("matches whole folder names only", () => {
    expect(isInFolder({ path: "Dokumente/Projekte/2021" }, "Dokumente/Projekte")).toBe(true);
    expect(isInFolder({ path: "Dokumente/Projekte" }, "Dokumente/Projekte")).toBe(true);
    expect(isInFolder({ path: "Dokumente/Projekte-Alt" }, "Dokumente/Projekte")).toBe(false);
  });
});

describe("summarizeFolder", () => {
  const tree = folderTree(files);
  const insights = computeInsights(files, NOW);

  it("limits the site's findings to the folder", () => {
    const summary = summarizeFolder(files, tree, "Dokumente/Projekte", insights, NOW)!;
    expect(summary.files.map((f) => f.name).sort()).toEqual(["Notiz.docx", "Plan Kopie.pdf", "Plan.pdf"]);
    // the copy lies in the folder, its original elsewhere – it still counts here
    expect(summary.insights.find((i) => i.id === "duplicates")!.savings).toBe(40 * MB);
    expect(summary.stale).toEqual({ bytes: 40 * MB, count: 1 });
    // two changed this year, the plan from 2021 is older than five years
    expect(summary.ages.map((a) => a.count)).toEqual([2, 0, 0, 1]);
    expect(summary.editors[0]).toMatchObject({ name: "Anna", bytes: 40 * MB });
    expect(summary.editors.at(-1)).toMatchObject({ name: "Unbekannt", count: 1 });
    expect(summary.subfolders).toBe(2);
  });

  it("returns nothing for a folder that no longer exists", () => {
    expect(summarizeFolder(files, tree, "Weg", insights, NOW)).toBeNull();
  });
});
