import { describe, expect, it, vi } from "vitest";
import { fileItem, memoryStorage, rootItem } from "../../tests/graph-fakes";
import { newDrive, toOp } from "./delta";
import { clearCheckpoint, hasCheckpoint, openCheckpoint } from "./scan-checkpoint";

const library = { id: "d1", name: "Dokumente", webUrl: "" };

async function saveOnePage(storage: ReturnType<typeof memoryStorage>, now = Date.now()) {
  const checkpoint = await openCheckpoint("site-1", [library], storage, { now, flushOps: 1 });
  const state = newDrive(library);
  state.link = "next-1";
  await checkpoint.save(state, [toOp(rootItem(), library)!, toOp(fileItem("a", "a.pdf"), library)!]);
}

describe("scan checkpoints", () => {
  it("restores saved progress", async () => {
    const storage = memoryStorage();
    await saveOnePage(storage);
    const checkpoint = await openCheckpoint("site-1", [library], storage);
    expect(checkpoint.resumedItems).toBe(2);
    expect(checkpoint.drive(library)).toMatchObject({ link: "next-1", complete: false });
    expect([...checkpoint.drive(library)!.files.keys()]).toEqual(["a"]);
  });

  it("discards progress older than two weeks", async () => {
    const storage = memoryStorage();
    await saveOnePage(storage, Date.now() - 15 * 864e5);
    const checkpoint = await openCheckpoint("site-1", [library], storage);
    expect(checkpoint.resumedItems).toBe(0);
    expect(checkpoint.drive(library)).toBeUndefined();
    expect(storage.data.size).toBe(0);
  });

  it("drops progress of libraries that no longer exist", async () => {
    const storage = memoryStorage();
    await saveOnePage(storage);
    const checkpoint = await openCheckpoint("site-1", [{ id: "d9", name: "Andere", webUrl: "" }], storage);
    expect(checkpoint.resumedItems).toBe(0);
    expect([...storage.data.keys()].some((k) => k.includes(":d1:"))).toBe(false);
  });

  it("keeps scanning when progress cannot be saved (storage full)", async () => {
    const storage = memoryStorage();
    storage.setMany = vi.fn().mockRejectedValue(new DOMException("voll", "QuotaExceededError"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const checkpoint = await openCheckpoint("site-1", [library], storage, { flushOps: 1 });
    const state = newDrive(library);
    await expect(checkpoint.save(state, [toOp(rootItem(), library)!])).resolves.toBeUndefined();
    await checkpoint.save(state, [toOp(fileItem("a", "a.pdf"), library)!]);
    expect(storage.setMany).toHaveBeenCalledTimes(1);
  });

  it("removes everything of a site, including leftover chunks", async () => {
    const storage = memoryStorage();
    await saveOnePage(storage);
    storage.data.set("scan-resume:site-1:d1:7", []);
    storage.data.set("scan-resume:site-2", { other: true });
    expect(await hasCheckpoint("site-1", storage)).toBe(true);
    await clearCheckpoint("site-1", storage);
    expect([...storage.data.keys()]).toEqual(["scan-resume:site-2"]);
    expect(await hasCheckpoint("site-1", storage)).toBe(false);
  });
});
