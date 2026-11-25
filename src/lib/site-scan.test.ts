import { describe, expect, it, vi } from "vitest";
import { makeFile, makeScan } from "../../tests/factories";
import { deletedItem, deltaServer, fileItem, folderItem, graphError, memoryStorage, rootItem } from "../../tests/graph-fakes";
import { initialLink, type LibraryRef } from "./delta";
import { hasCheckpoint, openCheckpoint } from "./scan-checkpoint";
import { mergeScan, scanSiteWith, type ScanDeps } from "./site-scan";
import type { ScanProgress, ScanResult } from "./types";

const site = { id: "site-1", name: "Marketing", webUrl: "https://contoso.sharepoint.com/sites/marketing" };
const docs: LibraryRef = { id: "d1", name: "Dokumente", webUrl: "https://contoso.sharepoint.com/sites/marketing/Dokumente" };
const media: LibraryRef = { id: "d2", name: "Medien", webUrl: "https://contoso.sharepoint.com/sites/marketing/Medien" };
const quota = { total: 1000, used: 500, remaining: 500, deleted: 0 };

function setup(libraries: LibraryRef[], storage = memoryStorage()) {
  const server = deltaServer();
  const progress: ScanProgress[] = [];
  const deps: ScanDeps = {
    libraries: async () => libraries,
    quota: async () => quota,
    fetchPage: (url) => server.fetchPage(url),
    openCheckpoint: (siteId, libs) => openCheckpoint(siteId, libs, storage, { flushOps: 1 }),
  };
  const scan = (options: Parameters<typeof scanSiteWith>[3] = {}) => scanSiteWith(deps, site, (p) => progress.push(p), options);
  return { server, progress, deps, scan, storage };
}

const sorted = (scan: ScanResult) =>
  scan.files.map((f) => `${f.driveName}|${f.path}|${f.name}|${f.size}`).sort();

function chainInitial(server: ReturnType<typeof deltaServer>) {
  server.chain(
    initialLink("d1"),
    [
      [rootItem("r1"), folderItem("f1", "Projekte", "r1"), fileItem("a", "Plan.pdf", "f1")],
      [fileItem("b", "Budget.xlsx", "r1")],
    ],
    "d1-delta-1",
  );
  server.chain(initialLink("d2"), [[rootItem("r2"), fileItem("v", "Film.mp4", "r2", { size: 5000 })]], "d2-delta-1");
}

describe("scanSiteWith – first scan", () => {
  it("reads every library completely and keeps the delta links", async () => {
    const { server, progress, scan } = setup([docs, media]);
    chainInitial(server);
    const result = await scan();

    expect(sorted(result)).toEqual(["Dokumente|Dokumente/Projekte|Plan.pdf|100", "Dokumente|Dokumente|Budget.xlsx|100", "Medien|Medien|Film.mp4|5000"]);
    expect(result.drives).toEqual([
      { ...docs, fileCount: 2, totalBytes: 200 },
      { ...media, fileCount: 1, totalBytes: 5000 },
    ]);
    expect(result.quota).toEqual(quota);
    expect(result.sync?.drives.map((d) => [d.id, d.deltaLink, d.folders.length])).toEqual([
      ["d1", "d1-delta-1", 2],
      ["d2", "d2-delta-1", 1],
    ]);
    expect(progress.at(-1)).toMatchObject({ kind: "full", driveIndex: 1, driveCount: 2, items: 6 });
  });

  it("copes with a library of 250,000 files (no call stack overflow, no raw objects kept)", async () => {
    const { server, scan } = setup([docs]);
    const pages = Array.from({ length: 250 }, (_, p) =>
      Array.from({ length: 1000 }, (_, i) => fileItem(`x${p}-${i}`, `Datei ${p}-${i}.pdf`, "r1")),
    );
    server.chain(initialLink("d1"), [[rootItem("r1")], ...pages], "d1-delta-1");
    const result = await scan();
    expect(result.files).toHaveLength(250_000);
    expect(result.drives[0].fileCount).toBe(250_000);
  });

  it("delivers interim results right after the first page, then at intervals", async () => {
    const { server, scan } = setup([docs, media]);
    chainInitial(server);
    const partials: ScanResult[] = [];
    const result = await scan({ onPartial: (p) => partials.push(p) });

    expect(partials).toHaveLength(1);
    expect(partials[0].partial).toBe(true);
    expect(partials[0].sync).toBeUndefined();
    expect(partials[0].files.map((f) => f.name)).toEqual(["Plan.pdf"]);
    expect(result.partial).toBeUndefined();
    // the file handed out in the interim result is the same object in the final one
    expect(result.files.find((f) => f.name === "Plan.pdf")).toBe(partials[0].files[0]);
  });

  it("does not deliver interim results when only changes are fetched", async () => {
    const first = setup([docs, media]);
    chainInitial(first.server);
    const base = await first.scan();
    const env = setup([docs, media]);
    env.server.chain("d1-delta-1", [[fileItem("c", "Neu.pdf", "f1")]], "d1-delta-2");
    env.server.chain("d2-delta-1", [[]], "d2-delta-2");
    const onPartial = vi.fn();
    await env.scan({ base, onPartial });
    expect(onPartial).not.toHaveBeenCalled();
  });

  it("still succeeds without the quota", async () => {
    const { server, deps } = setup([docs]);
    chainInitial(server);
    deps.quota = async () => {
      throw graphError(403);
    };
    const result = await scanSiteWith(deps, site, () => {});
    expect(result.quota).toBeUndefined();
  });
});

describe("scanSiteWith – later scans fetch only the changes", () => {
  async function firstScan() {
    const env = setup([docs, media]);
    chainInitial(env.server);
    return { ...env, base: await env.scan() };
  }

  it("asks Graph only for the changes and applies them", async () => {
    const { base } = await firstScan();
    const env = setup([docs, media]);
    env.server.chain("d1-delta-1", [[deletedItem("b"), fileItem("c", "Neu.pdf", "f1")]], "d1-delta-2");
    env.server.chain("d2-delta-1", [[]], "d2-delta-2");

    const result = await env.scan({ base });
    expect(env.server.requested).toEqual(["d1-delta-1", "d2-delta-1"]);
    expect(sorted(result)).toEqual(["Dokumente|Dokumente/Projekte|Neu.pdf|100", "Dokumente|Dokumente/Projekte|Plan.pdf|100", "Medien|Medien|Film.mp4|5000"]);
    expect(result.sync?.drives.map((d) => d.deltaLink)).toEqual(["d1-delta-2", "d2-delta-2"]);
    expect(env.progress.at(-1)?.kind).toBe("delta");
    expect(mergeScan(base, base, result).changes).toEqual({ added: 1, changed: 0, removed: 1 });
  });

  it("reads a new library completely and drops a removed one", async () => {
    const { base } = await firstScan();
    const archive: LibraryRef = { id: "d3", name: "Archiv", webUrl: "" };
    const env = setup([docs, archive]);
    env.server.chain("d1-delta-1", [[]], "d1-delta-2");
    env.server.chain(initialLink("d3"), [[rootItem("r3"), fileItem("z", "Alt.zip", "r3")]], "d3-delta-1");

    const result = await env.scan({ base });
    expect(env.server.requested).toEqual(["d1-delta-1", initialLink("d3")]);
    expect(result.drives.map((d) => d.name)).toEqual(["Dokumente", "Archiv"]);
    expect(result.files.map((f) => f.name).sort()).toEqual(["Alt.zip", "Budget.xlsx", "Plan.pdf"]);
  });

  it("reads only the library again whose delta link expired (410)", async () => {
    const { base } = await firstScan();
    const env = setup([docs, media]);
    env.server.on("d1-delta-1", () => {
      throw graphError(410, "resyncRequired");
    });
    env.server.chain(initialLink("d1"), [[rootItem("r1"), fileItem("a", "Plan.pdf", "r1")]], "d1-delta-9");
    env.server.chain("d2-delta-1", [[]], "d2-delta-2");

    const result = await env.scan({ base });
    expect(env.server.requested).toEqual(["d1-delta-1", initialLink("d1"), "d2-delta-1"]);
    expect(sorted(result)).toEqual(["Dokumente|Dokumente|Plan.pdf|100", "Medien|Medien|Film.mp4|5000"]);
  });

  it("does not hide other errors behind a complete re-read", async () => {
    const { base } = await firstScan();
    const env = setup([docs, media]);
    env.server.on("d1-delta-1", () => {
      throw graphError(401, "Unauthorized");
    });
    await expect(env.scan({ base })).rejects.toThrow("Unauthorized");
    expect(env.server.requested).toEqual(["d1-delta-1"]);
  });

  it("reads everything when the cached scan has no delta links (older versions, demo)", async () => {
    const env = setup([docs, media]);
    chainInitial(env.server);
    const old = makeScan([makeFile({ driveId: "d1" })]);
    const result = await env.scan({ base: old });
    expect(env.server.requested[0]).toBe(initialLink("d1"));
    expect(result.files).toHaveLength(3);
  });
});

describe("scanSiteWith – interrupted scans continue", () => {
  const pages = [
    [rootItem("r1"), folderItem("f1", "Projekte", "r1")],
    [fileItem("a", "a.pdf", "f1")],
    [fileItem("b", "b.pdf", "f1")],
    [fileItem("c", "c.pdf", "r1"), deletedItem("a")],
  ];

  it("continues at the saved position and ends with the same result as an uninterrupted scan", async () => {
    const storage = memoryStorage();
    const failing = setup([docs], storage);
    failing.server.chain(initialLink("d1"), pages, "d1-delta-1");
    failing.server.on(`${initialLink("d1")}#page2`, () => {
      throw Object.assign(new Error("Failed to fetch"), { code: "TypeError" });
    });
    await expect(failing.scan({ resumable: true })).rejects.toThrow("Failed to fetch");
    expect(await hasCheckpoint(site.id, storage)).toBe(true);

    const resumed = setup([docs], storage);
    resumed.server.chain(initialLink("d1"), pages, "d1-delta-1");
    const result = await resumed.scan({ resumable: true });
    expect(resumed.server.requested).toEqual([`${initialLink("d1")}#page2`, `${initialLink("d1")}#page3`]);
    expect(resumed.progress[0]).toMatchObject({ resumed: 3 });

    const reference = setup([docs]);
    reference.server.chain(initialLink("d1"), pages, "d1-delta-1");
    expect(sorted(result)).toEqual(sorted(await reference.scan()));
    expect(sorted(result)).toEqual(["Dokumente|Dokumente/Projekte|b.pdf|100", "Dokumente|Dokumente|c.pdf|100"]);
  });

  it("starts the library again when the saved position is no longer accepted", async () => {
    const storage = memoryStorage();
    const failing = setup([docs], storage);
    failing.server.chain(initialLink("d1"), pages, "d1-delta-1");
    failing.server.on(`${initialLink("d1")}#page2`, () => {
      throw graphError(401);
    });
    await expect(failing.scan({ resumable: true })).rejects.toThrow();

    const resumed = setup([docs], storage);
    resumed.server.chain(initialLink("d1"), pages, "d1-delta-1");
    resumed.server.on(`${initialLink("d1")}#page2`, () => {
      throw graphError(410);
    });
    resumed.server.chain(initialLink("d1"), [[rootItem("r1"), fileItem("n", "neu.pdf", "r1")]], "d1-delta-7");
    const result = await resumed.scan({ resumable: true });
    expect(result.files.map((f) => f.name)).toEqual(["neu.pdf"]);
    expect(result.sync?.drives[0].deltaLink).toBe("d1-delta-7");
  });

  it("starts from scratch when saved progress is damaged", async () => {
    const storage = memoryStorage();
    const failing = setup([docs], storage);
    failing.server.chain(initialLink("d1"), pages, "d1-delta-1");
    failing.server.on(`${initialLink("d1")}#page2`, () => {
      throw graphError(401);
    });
    await expect(failing.scan({ resumable: true })).rejects.toThrow();
    storage.data.delete([...storage.data.keys()].find((k) => k.endsWith(":d1:0"))!);

    const fresh = setup([docs], storage);
    fresh.server.chain(initialLink("d1"), pages, "d1-delta-1");
    const result = await fresh.scan({ resumable: true });
    expect(fresh.server.requested[0]).toBe(initialLink("d1"));
    expect(fresh.progress[0].resumed).toBeUndefined();
    expect(result.files).toHaveLength(2);
  });

  it("does not save progress for background scans", async () => {
    const storage = memoryStorage();
    const env = setup([docs], storage);
    chainInitial(env.server);
    await env.scan();
    expect(storage.data.size).toBe(0);
  });

  it("lets only one scan per site save progress", async () => {
    const storage = memoryStorage();
    const first = setup([docs], storage);
    const second = setup([docs], storage);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    first.server.chain(initialLink("d1"), pages, "d1-delta-1");
    const slow = { ...first.deps, fetchPage: async (url: string) => (await gate, first.server.fetchPage(url)) };
    const opened = vi.fn(first.deps.openCheckpoint!);
    const running = scanSiteWith({ ...slow, openCheckpoint: opened }, site, () => {}, { resumable: true });

    second.server.chain(initialLink("d1"), pages, "d1-delta-1");
    const secondOpened = vi.fn(second.deps.openCheckpoint!);
    await scanSiteWith({ ...second.deps, openCheckpoint: secondOpened }, site, () => {}, { resumable: true });
    release();
    await running;
    expect(opened).toHaveBeenCalledTimes(1);
    expect(secondOpened).not.toHaveBeenCalled();
  });
});

describe("mergeScan", () => {
  const a = makeFile({ name: "a" });
  const b = makeFile({ name: "b" });
  const c = makeFile({ name: "c" });
  const base = makeScan([a, b, c]);

  it("takes the result as is when nothing happened meanwhile", () => {
    const result = makeScan([a, { ...b, size: 5 }, makeFile({ name: "d" })], { scannedAt: "2026-11-25T00:00:00Z" });
    const { scan, changes } = mergeScan(base, base, result);
    expect(scan.files).toBe(result.files);
    expect(changes).toEqual({ added: 1, changed: 1, removed: 1 });
    expect(scan.scannedAt).toBe("2026-11-25T00:00:00Z");
  });

  it("lets local changes made during the update win", () => {
    const restored = makeFile({ name: "restored" });
    const compressed = { ...b, size: 1 };
    // meanwhile: a deleted, b compressed, a restored file added
    const current = { ...base, files: [compressed, c, restored] };
    // the update still saw a (fetched before the delete) and the old b
    const result = makeScan([{ ...a, size: 7 }, { ...b, size: 9 }, c]);
    const { scan } = mergeScan(base, current, result);
    expect(scan.files.map((f) => f.name)).toEqual(["b", "c", "restored"]);
    expect(scan.files[0]).toBe(compressed);
    expect(scan.drives[0]).toMatchObject({ fileCount: 3, totalBytes: compressed.size + c.size + restored.size });
  });

  it("keeps the version scan date of the shown scan", () => {
    const current = { ...base, files: [...base.files], versionsScannedAt: "2026-11-20T00:00:00Z" };
    expect(mergeScan(base, current, makeScan([a])).scan.versionsScannedAt).toBe("2026-11-20T00:00:00Z");
  });
});
