import { describe, expect, it } from "vitest";
import { makeFile, MB } from "../../tests/factories";
import { BUILTIN_RULES, describeRule, duplicateCopyIds, matchRule, parsePatterns, type CleanupRule } from "./rules";

const NOW = Date.parse("2026-11-01T00:00:00Z");
const rule = (overrides: Partial<CleanupRule>): CleanupRule => ({ id: "r", name: "Test", categories: [], extensions: [], ...overrides });

describe("parsePatterns", () => {
  it("turns semicolon-separated globs into case-insensitive patterns", () => {
    const [tmp, lock] = parsePatterns("*.tmp; ~$*");
    expect(tmp.test("Kopie.TMP")).toBe(true);
    expect(tmp.test("tmp.docx")).toBe(false);
    expect(lock.test("~$Konzept.docx")).toBe(true);
  });

  it("escapes regex characters in names", () => {
    const [p] = parsePatterns("Bericht (final).docx");
    expect(p.test("Bericht (final).docx")).toBe(true);
    expect(p.test("Bericht final.docx")).toBe(false);
  });
});

describe("matchRule", () => {
  const old = makeFile({ name: "export.zip", size: 900 * MB, category: "archive", modified: "2025-01-01T00:00:00Z" });
  const fresh = makeFile({ name: "neu.zip", size: 900 * MB, category: "archive", modified: "2026-10-20T00:00:00Z" });
  const small = makeFile({ name: "klein.zip", size: 1 * MB, category: "archive", modified: "2020-01-01T00:00:00Z" });
  const doc = makeFile({ name: "Bericht.docx", path: "Dokumente/Archiv/2019" });
  const files = [old, fresh, small, doc];

  it("combines all conditions", () => {
    const r = rule({ extensions: ["zip"], olderThanMonths: 3, minSizeMB: 100 });
    expect(matchRule(r, files, NOW).map((f) => f.id)).toEqual([old.id]);
  });

  it("matches path fragments and categories", () => {
    expect(matchRule(rule({ pathContains: "archiv/2019" }), files, NOW)).toEqual([doc]);
    expect(matchRule(rule({ categories: ["archive"] }), files, NOW)).toHaveLength(3);
  });

  it("keeps the oldest copy when only duplicates are requested", () => {
    const original = makeFile({ hash: "same", size: 5 * MB, created: "2023-01-01T00:00:00Z" });
    const copy = makeFile({ hash: "same", size: 5 * MB, created: "2024-01-01T00:00:00Z" });
    expect([...duplicateCopyIds([copy, original])]).toEqual([copy.id]);
    expect(matchRule(rule({ duplicatesOnly: true }), [original, copy], NOW)).toEqual([copy]);
  });

  it("recognises Teams recordings", () => {
    const recording = makeFile({ name: "Weekly-20260101_090000-Meeting Recording.mp4", category: "video", modified: "2026-01-02T00:00:00Z" });
    const video = makeFile({ name: "Imagefilm.mp4", category: "video", modified: "2026-01-02T00:00:00Z" });
    const r = BUILTIN_RULES.find((b) => b.id === "builtin-recordings")!;
    expect(matchRule(r, [recording, video], NOW)).toEqual([recording]);
  });

  it("describes its conditions", () => {
    expect(describeRule(rule({ extensions: ["zip"], olderThanMonths: 3, minSizeMB: 100 }))).toEqual([
      "Endung: .zip",
      "ab 100 MB",
      "älter als 3 Monate",
    ]);
  });
});
