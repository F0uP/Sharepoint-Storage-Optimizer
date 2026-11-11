import { describe, expect, it, vi } from "vitest";
import { MB, makeFile, makeScan } from "../../tests/factories";
import { mapRecommendations, runAiAnalysis, selectCandidates } from "./ai";

describe("mapRecommendations", () => {
  const files = [makeFile(), makeFile(), makeFile()];

  it("maps indices to file ids", () => {
    const result = mapRecommendations([{ i: 2, action: "delete", priority: "high", reason: "r" }], files);
    expect(result).toEqual([{ fileId: files[2].id, action: "delete", priority: "high", reason: "r" }]);
  });

  it("drops hallucinated, fractional and repeated indices", () => {
    const result = mapRecommendations(
      [
        { i: 0, action: "delete", priority: "high", reason: "a" },
        { i: 0, action: "archive", priority: "low", reason: "dupe" },
        { i: 7, action: "delete", priority: "high", reason: "out of range" },
        { i: -1, action: "delete", priority: "high", reason: "negative" },
        { i: 1.5, action: "delete", priority: "high", reason: "fraction" },
      ],
      files,
    );
    expect(result.map((r) => r.reason)).toEqual(["a"]);
  });
});

describe("selectCandidates", () => {
  it("caps the list and always includes duplicates", () => {
    const big = Array.from({ length: 1200 }, (_, i) => makeFile({ size: (2000 - i) * MB, hash: `u${i}` }));
    const original = makeFile({ size: 2 * MB, hash: "dup", created: "2020-01-01T00:00:00Z" });
    const copy = makeFile({ size: 2 * MB, hash: "dup", created: "2023-01-01T00:00:00Z" });

    const { files, duplicates } = selectCandidates(makeScan([...big, original, copy]));

    expect(files.length).toBeLessThanOrEqual(700);
    expect(files.map((f) => f.id)).toContain(copy.id);
    expect(duplicates.has(copy.id)).toBe(true);
    expect(new Set(files.map((f) => f.id)).size).toBe(files.length);
  });
});

describe("runAiAnalysis", () => {
  it("sends compact metadata and maps the answer back to files", async () => {
    const scan = makeScan([makeFile({ size: 9 * MB, name: "a.zip" }), makeFile({ size: 1 * MB, name: "b.docx" })]);
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        label: "Google Gemini",
        model: "gemini-test",
        summary: "ok",
        tips: [{ title: "t", detail: "d" }],
        recommendations: [
          { i: 0, action: "delete", priority: "high", reason: "Export" },
          { i: 99, action: "delete", priority: "high", reason: "erfunden" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await runAiAnalysis(scan, "gemini");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.provider).toBe("gemini");
    expect(body.files[0]).toMatchObject({ i: 0, p: "Dokumente/Projekte/a.zip", s: 9 * MB });
    expect(body.files[0]).not.toHaveProperty("webUrl");
    expect(result.provider).toBe("Google Gemini");
    expect(result.recommendations).toEqual([{ fileId: scan.files[0].id, action: "delete", priority: "high", reason: "Export" }]);
  });

  it("surfaces the server error message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Kein Key" }, { status: 503 })));
    await expect(runAiAnalysis(makeScan([makeFile()]))).rejects.toThrow("Kein Key");
  });
});
