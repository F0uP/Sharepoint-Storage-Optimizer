import { beforeEach, describe, expect, it } from "vitest";
import { GB, MB, makeFile, makeScan } from "../../tests/factories";
import { useApp } from "./store";
import type { AiResult } from "./types";

const fileA = makeFile({ size: 100 * MB, versionBytes: 20 * MB });
const fileB = makeFile({ size: 50 * MB, versionBytes: 30 * MB, versionCount: 4 });

const ai: AiResult = {
  createdAt: "",
  provider: "OpenAI",
  model: "m",
  analyzedFiles: 2,
  summary: "",
  tips: [],
  recommendations: [
    { fileId: fileA.id, action: "delete", priority: "high", reason: "a" },
    { fileId: fileB.id, action: "archive", priority: "low", reason: "b" },
  ],
};

beforeEach(() => {
  useApp.getState().reset();
  // demo mode: no IndexedDB persistence in tests
  useApp.setState({ mode: "demo" });
  useApp.getState().setScan(makeScan([fileA, fileB]), ai);
});

const state = () => useApp.getState();

describe("removeFiles", () => {
  it("frees quota immediately when deleting permanently", () => {
    state().removeFiles([fileA.id], true);
    expect(state().scan!.files.map((f) => f.id)).toEqual([fileB.id]);
    expect(state().scan!.quota!.used).toBe(50 * GB - 120 * MB);
    expect(state().cleanup).toEqual({ freedBytes: 120 * MB, recycledBytes: 0, files: 1 });
  });

  it("moves bytes to the recycle bin otherwise", () => {
    state().removeFiles([fileA.id], false);
    expect(state().scan!.quota!.used).toBe(50 * GB);
    expect(state().scan!.quota!.deleted).toBe(2 * GB + 120 * MB);
    expect(state().cleanup.recycledBytes).toBe(120 * MB);
  });

  it("drops AI recommendations of deleted files and updates library totals", () => {
    state().removeFiles([fileA.id], true);
    expect(state().ai!.recommendations.map((r) => r.fileId)).toEqual([fileB.id]);
    expect(state().scan!.drives[0]).toMatchObject({ fileCount: 1, totalBytes: 50 * MB });
  });
});

describe("versions and recycle bin", () => {
  it("clears version history and frees its bytes", () => {
    state().clearVersions([fileB.id]);
    const b = state().scan!.files.find((f) => f.id === fileB.id)!;
    expect(b).toMatchObject({ versionBytes: 0, versionCount: 1 });
    expect(state().scan!.quota!.used).toBe(50 * GB - 30 * MB);
    expect(state().cleanup.freedBytes).toBe(30 * MB);
  });

  it("accounts for an emptied recycle bin only when stage 2 was purged too", () => {
    state().recycleBinEmptied(false);
    expect(state().scan!.quota!.deleted).toBe(2 * GB);
    state().recycleBinEmptied(true);
    expect(state().scan!.quota!.deleted).toBe(0);
    expect(state().scan!.quota!.used).toBe(48 * GB);
  });
});

describe("AI recommendations", () => {
  it("can dismiss recommendations", () => {
    state().dismissAi([fileB.id]);
    expect(state().ai!.recommendations.map((r) => r.fileId)).toEqual([fileA.id]);
  });

  it("resets everything per site", () => {
    state().selectSite({ id: "other", name: "Andere", webUrl: "https://x.sharepoint.com/sites/o" });
    expect(state()).toMatchObject({ scan: null, ai: null, view: "overview" });
  });
});
