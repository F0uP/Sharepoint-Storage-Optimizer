import { describe, expect, it } from "vitest";
import { makeFile, MB } from "../../tests/factories";
import { addEntry, createEntry, restorableFiles, totalFreed } from "./history";
import { addSnapshot, trendDelta } from "./trend";
import { folderTail, leafNameFilter, matchRecycleItems, type RecycleItem } from "./recycle-bin";

describe("history", () => {
  it("only offers undo for recycle-bin deletes within 93 days", () => {
    const files = [makeFile(), makeFile()];
    const at = new Date("2026-11-01T10:00:00Z");
    const recycled = createEntry("delete", files, 2 * MB, { permanent: false }, at);
    const permanent = createEntry("delete", files, 2 * MB, { permanent: true }, at);
    expect(restorableFiles(recycled, at.getTime())).toHaveLength(2);
    expect(restorableFiles(permanent, at.getTime())).toEqual([]);
    expect(restorableFiles(recycled, at.getTime() + 94 * 864e5)).toEqual([]);
    expect(restorableFiles({ ...recycled, restoredIds: [files[0].id] }, at.getTime())).toEqual([files[1]]);
  });

  it("counts only space that actually left the quota", () => {
    const entries = [
      createEntry("delete", [makeFile()], 10, { permanent: false }),
      createEntry("delete", [makeFile()], 20, { permanent: true }),
      createEntry("versions", [makeFile()], 30),
      createEntry("compress", [makeFile()], 40),
      createEntry("restore", [makeFile()], 50),
    ];
    expect(totalFreed(entries)).toBe(90);
  });

  it("keeps the newest entries first and caps the list", () => {
    let list = [createEntry("notify", [], 0)];
    const newest = createEntry("versions", [], 1);
    list = addEntry(list, newest);
    expect(list[0]).toBe(newest);
    for (let i = 0; i < 150; i++) list = addEntry(list, createEntry("notify", [], 0));
    expect(list).toHaveLength(100);
  });
});

describe("trend", () => {
  it("keeps one reading per day, sorted", () => {
    let list = addSnapshot([], { at: "2026-11-02T08:00:00Z", used: 5, total: 10, deleted: 0 });
    list = addSnapshot(list, { at: "2026-11-01T08:00:00Z", used: 4, total: 10, deleted: 0 });
    list = addSnapshot(list, { at: "2026-11-02T18:00:00Z", used: 6, total: 10, deleted: 0 });
    expect(list.map((s) => s.used)).toEqual([4, 6]);
    expect(trendDelta(list)).toBe(2);
  });
});

describe("recycle bin matching", () => {
  const deletedAt = "2026-11-01T10:00:00Z";
  const item = (overrides: Partial<RecycleItem>): RecycleItem => ({
    Id: "r1",
    LeafName: "Bericht.docx",
    DirName: "sites/test/Shared Documents/Projekte",
    Size: String(1 * MB),
    DeletedDate: "2026-11-01T10:00:05Z",
    ...overrides,
  });

  it("matches by name, folder below the library and deletion time", () => {
    const file = makeFile({ name: "Bericht.docx", path: "Dokumente/Projekte", size: 1 * MB });
    const items = [
      item({ Id: "older", DeletedDate: "2026-10-01T00:00:00Z" }),
      item({ Id: "other-folder", DirName: "sites/test/Shared Documents/Archiv" }),
      item({ Id: "match", Size: String(3 * MB) }),
    ];
    expect(matchRecycleItems([file], items, deletedAt).get(file.id)).toBe("match");
    expect(folderTail("Dokumente/Projekte/2024")).toBe("Projekte/2024");
  });

  it("prefers the exact size and never uses an item twice", () => {
    const a = makeFile({ name: "x.pdf", path: "Dokumente", size: 2 * MB });
    const b = makeFile({ name: "x.pdf", path: "Dokumente", size: 5 * MB });
    const items = [item({ Id: "big", LeafName: "x.pdf", Size: String(5 * MB) }), item({ Id: "small", LeafName: "x.pdf", Size: String(2 * MB) })];
    const map = matchRecycleItems([a, b], items, deletedAt);
    expect(map.get(a.id)).toBe("small");
    expect(map.get(b.id)).toBe("big");
  });

  it("escapes quotes in the OData filter", () => {
    expect(leafNameFilter(["O'Brien.docx", "a.pdf"])).toBe("LeafName eq 'O''Brien.docx' or LeafName eq 'a.pdf'");
  });
});
