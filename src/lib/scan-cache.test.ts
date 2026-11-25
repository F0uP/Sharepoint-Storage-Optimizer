import { describe, expect, it, vi } from "vitest";
import { makeFile, makeScan } from "../../tests/factories";
import { memoryStorage } from "../../tests/graph-fakes";
import { CACHE_CHUNK, deleteScan, loadScan, saveScan } from "./scan-cache";

const files = (n: number) => Array.from({ length: n }, (_, i) => makeFile({ name: `f${i}.pdf` }));

describe("scan cache", () => {
  it("stores a large scan in chunks and reads it back completely", async () => {
    const storage = memoryStorage();
    const scan = makeScan(files(CACHE_CHUNK * 2 + 5), { sync: { v: 1, drives: [{ id: "d1", deltaLink: "delta-1", folders: [] }] } });
    await expect(saveScan(scan, storage)).resolves.toBe(true);
    // index + 3 chunks
    expect(storage.data.size).toBe(4);
    const loaded = await loadScan(scan.site.id, storage);
    expect(loaded).toEqual(scan);
  });

  it("replaces the previous generation and removes its chunks", async () => {
    const storage = memoryStorage();
    const scan = makeScan(files(10));
    await saveScan(scan, storage);
    const smaller = { ...scan, files: scan.files.slice(0, 3) };
    await saveScan(smaller, storage);
    expect((await loadScan(scan.site.id, storage))?.files).toHaveLength(3);
    expect(storage.data.size).toBe(2);
  });

  it("lets a newer save overtake an older one – the older one resolves with the newer result", async () => {
    const storage = memoryStorage();
    const scan = makeScan(files(CACHE_CHUNK * 3));
    const older = saveScan(scan, storage);
    const newer = saveScan({ ...scan, files: scan.files.slice(1) }, storage);
    await expect(older).resolves.toBe(true);
    await expect(newer).resolves.toBe(true);
    expect((await loadScan(scan.site.id, storage))?.files).toHaveLength(CACHE_CHUNK * 3 - 1);
    // nothing of the overtaken save is left behind
    expect(storage.data.size).toBe(4);
  });

  it("keeps the old cache when writing fails half-way", async () => {
    const storage = memoryStorage();
    const scan = makeScan(files(CACHE_CHUNK + 1));
    await saveScan(scan, storage);
    const realSet = storage.setMany;
    let writes = 0;
    storage.setMany = vi.fn(async (entries) => {
      if (++writes === 2) throw new DOMException("voll", "QuotaExceededError");
      return realSet(entries);
    });
    await expect(saveScan({ ...scan, files: scan.files.slice(5) }, storage)).rejects.toThrow("voll");
    expect((await loadScan(scan.site.id, storage))?.files).toHaveLength(CACHE_CHUNK + 1);
  });

  it("treats an incomplete cache as none", async () => {
    const storage = memoryStorage();
    const scan = makeScan(files(CACHE_CHUNK + 1));
    await saveScan(scan, storage);
    storage.data.delete([...storage.data.keys()].find((k) => k.endsWith(":1"))!);
    expect(await loadScan(scan.site.id, storage)).toBeUndefined();
  });

  it("still reads caches of older versions (one entry) and deletes everything of a site", async () => {
    const storage = memoryStorage();
    const scan = makeScan(files(3));
    await storage.setMany([[`scan:${scan.site.id}`, scan]]);
    expect(await loadScan(scan.site.id, storage)).toEqual(scan);
    await saveScan(scan, storage);
    await deleteScan(scan.site.id, storage);
    expect(storage.data.size).toBe(0);
  });
});
