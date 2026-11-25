import { describe, expect, it } from "vitest";
import { GB, MB, makeFile } from "../../tests/factories";
import { ageStats, aiInsight, categoryStats, computeInsights, folderStats, largest, potential } from "./analysis";
import type { AiResult } from "./types";

const NOW = Date.parse("2026-11-01T00:00:00Z");
const byId = (insights: ReturnType<typeof computeInsights>, id: string) => insights.find((i) => i.id === id)!;

describe("computeInsights", () => {
  it("finds duplicates by hash + size and keeps the oldest copy", () => {
    const original = makeFile({ hash: "same", size: 5 * MB, created: "2020-01-01T00:00:00Z", path: "Dokumente/Original" });
    const copyA = makeFile({ hash: "same", size: 5 * MB, created: "2022-01-01T00:00:00Z" });
    const copyB = makeFile({ hash: "same", size: 5 * MB, created: "2023-01-01T00:00:00Z" });
    const sameHashOtherSize = makeFile({ hash: "same", size: 6 * MB });

    const dup = byId(computeInsights([copyB, original, copyA, sameHashOtherSize], NOW), "duplicates");

    expect(dup.rows.map((r) => r.file.id).sort()).toEqual([copyA.id, copyB.id].sort());
    expect(dup.savings).toBe(10 * MB);
    expect(dup.rows[0].note).toContain("Dokumente/Original");
  });

  it("ignores tiny files and files without hash for duplicates", () => {
    const tiny = [makeFile({ hash: "t", size: 100 }), makeFile({ hash: "t", size: 100 })];
    const noHash = [makeFile({ hash: undefined }), makeFile({ hash: undefined })];
    expect(byId(computeInsights([...tiny, ...noHash], NOW), "duplicates").rows).toHaveLength(0);
  });

  it("detects temp and system files", () => {
    const junk = ["~$Konzept.docx", "Thumbs.db", ".DS_Store", "export.tmp", "alt.bak"].map((name) => makeFile({ name }));
    const normal = makeFile({ name: "Konzept.docx" });
    const ids = byId(computeInsights([...junk, normal], NOW), "junk").rows.map((r) => r.file.id);
    expect(ids).toHaveLength(junk.length);
    expect(ids).not.toContain(normal.id);
  });

  it("flags large files untouched for 2+ years relative to the scan time", () => {
    const old = makeFile({ size: 20 * MB, modified: "2023-06-01T00:00:00Z" });
    const recent = makeFile({ size: 20 * MB, modified: "2025-06-01T00:00:00Z" });
    const oldButSmall = makeFile({ size: 2 * MB, modified: "2019-06-01T00:00:00Z" });
    const ids = byId(computeInsights([old, recent, oldButSmall], NOW), "stale").rows.map((r) => r.file.id);
    expect(ids).toEqual([old.id]);
  });

  it("collects big videos, archives/installers and version histories", () => {
    const video = makeFile({ name: "film.mp4", category: "video", size: 300 * MB });
    const smallVideo = makeFile({ name: "clip.mp4", category: "video", size: 20 * MB });
    const installer = makeFile({ name: "setup.msi", category: "other", ext: "msi", size: 50 * MB });
    const versioned = makeFile({ versionBytes: 2 * GB, versionCount: 40 });

    const insights = computeInsights([video, smallVideo, installer, versioned], NOW);
    expect(byId(insights, "videos").rows.map((r) => r.file.id)).toEqual([video.id]);
    expect(byId(insights, "archives").rows.map((r) => r.file.id)).toEqual([installer.id]);
    const versions = byId(insights, "versions");
    expect(versions.action).toBe("versions");
    expect(versions.savings).toBe(2 * GB);
  });

  it("sorts rows by reclaimable bytes", () => {
    const files = [10, 300, 120].map((s) => makeFile({ name: `v${s}.mp4`, category: "video", size: s * MB * 10 }));
    expect(byId(computeInsights(files, NOW), "videos").rows.map((r) => r.bytes)).toEqual([3000 * MB, 1200 * MB, 100 * MB]);
  });
});

describe("Teams recordings", () => {
  it("are recognised by name or Recordings folder and kept out of the generic video list", () => {
    const byName = makeFile({ name: "Jour fixe-20260301_100012-Besprechungsaufzeichnung.mp4", category: "video", size: 300 * MB });
    const byFolder = makeFile({ name: "Call.mp4", path: "Dokumente/Recordings", category: "video", size: 200 * MB });
    const film = makeFile({ name: "Imagefilm.mp4", category: "video", size: 300 * MB });
    const insights = computeInsights([byName, byFolder, film], NOW);
    expect(byId(insights, "recordings").rows.map((r) => r.file.id)).toEqual([byName.id, byFolder.id]);
    expect(byId(insights, "videos").rows.map((r) => r.file.id)).toEqual([film.id]);
  });
});

describe("potential", () => {
  it("counts a file that appears in several insights only once and adds the recycle bin", () => {
    const oldVideo = makeFile({ name: "old.mp4", category: "video", size: 500 * MB, modified: "2018-01-01T00:00:00Z" });
    const insights = computeInsights([oldVideo], NOW);
    expect(byId(insights, "videos").rows).toHaveLength(1);
    expect(byId(insights, "stale").rows).toHaveLength(1);

    const result = potential(insights, { total: 0, used: 0, remaining: 0, deleted: 1 * GB });
    expect(result.files).toBe(1);
    expect(result.bytes).toBe(500 * MB + 1 * GB);
  });

  it("separates the low-risk share (duplicates, junk, versions, recycle bin)", () => {
    const recent = "2026-09-01T00:00:00Z";
    const a = makeFile({ hash: "x", size: 10 * MB, created: "2020-01-01T00:00:00Z", modified: recent });
    const b = makeFile({ hash: "x", size: 10 * MB, created: "2021-01-01T00:00:00Z", modified: recent });
    const video = makeFile({ name: "big.mp4", category: "video", size: 1 * GB, modified: "2026-10-01T00:00:00Z" });
    const result = potential(computeInsights([a, b, video], NOW), { total: 0, used: 0, remaining: 0, deleted: 3 * MB });
    expect(result.safeBytes).toBe(10 * MB + 3 * MB);
    expect(result.bytes).toBe(10 * MB + 1 * GB + 3 * MB);
  });
});

describe("aiInsight", () => {
  it("contains only delete recommendations for files that still exist", () => {
    const keep = makeFile({ size: 3 * MB });
    const archive = makeFile();
    const ai: AiResult = {
      createdAt: "",
      provider: "OpenAI",
      model: "m",
      analyzedFiles: 3,
      summary: "",
      tips: [],
      recommendations: [
        { fileId: keep.id, action: "delete", priority: "high", reason: "Kopie" },
        { fileId: archive.id, action: "archive", priority: "low", reason: "alt" },
        { fileId: "gone", action: "delete", priority: "high", reason: "weg" },
      ],
    };
    const insight = aiInsight([keep, archive], ai);
    expect(insight.rows.map((r) => r.file.id)).toEqual([keep.id]);
    expect(insight.rows[0].note).toBe("Kopie");
    expect(aiInsight([keep], null).rows).toHaveLength(0);
  });
});

describe("statistics", () => {
  it("aggregates per category in a fixed order", () => {
    const stats = categoryStats([makeFile({ category: "video", size: 5 }), makeFile({ category: "video", size: 7 })]);
    expect(stats[0]).toEqual({ category: "video", count: 2, bytes: 12 });
    expect(stats.map((s) => s.category)).toEqual(["video", "image", "document", "archive", "audio", "other"]);
  });

  it("fills missing years so the time axis is continuous", () => {
    const stats = ageStats([makeFile({ modified: "2019-05-01T12:00:00Z" }), makeFile({ modified: "2022-05-01T12:00:00Z" })]);
    expect(stats.map((s) => s.year)).toEqual(["2019", "2020", "2021", "2022"]);
    expect(stats[1].bytes).toBe(0);
  });

  it("aggregates folders at the requested depth", () => {
    const files = [
      makeFile({ path: "Lib/A/x", size: 1 }),
      makeFile({ path: "Lib/A/y", size: 2 }),
      makeFile({ path: "Lib/B", size: 10 }),
    ];
    expect(folderStats(files, 2)).toEqual([
      { path: "Lib/B", bytes: 10, count: 1 },
      { path: "Lib/A", bytes: 3, count: 2 },
    ]);
  });
});

describe("largest", () => {
  it("returns the n largest items like a full sort would – equal sizes keep their order", () => {
    const items = Array.from({ length: 2000 }, (_, i) => ({ id: i, size: (i * 7919) % 101 }));
    const expected = items.toSorted((a, b) => b.size - a.size).slice(0, 50);
    expect(largest(items, 50, (x) => x.size)).toEqual(expected);
    expect(largest(items, 5, (x) => x.size, (x) => x.id % 2 === 0)).toEqual(
      items.filter((x) => x.id % 2 === 0).toSorted((a, b) => b.size - a.size).slice(0, 5),
    );
    expect(largest(items.slice(0, 3), 10, (x) => x.size)).toHaveLength(3);
    expect(largest(items, 0, (x) => x.size)).toEqual([]);
  });
});

describe("computeInsights with the same hash", () => {
  it("treats files with the same hash but a different size as different files", () => {
    const a = makeFile({ hash: "x", size: 5 * MB, created: "2020-01-01T00:00:00Z" });
    const b = makeFile({ hash: "x", size: 5 * MB, created: "2021-01-01T00:00:00Z" });
    const c = makeFile({ hash: "x", size: 6 * MB });
    const duplicates = computeInsights([b, c, a]).find((i) => i.id === "duplicates")!;
    expect(duplicates.rows.map((r) => r.file.id)).toEqual([b.id]);
  });
});
