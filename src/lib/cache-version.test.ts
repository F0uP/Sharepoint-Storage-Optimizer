import { describe, expect, it } from "vitest";
import { memoryStorage } from "../../tests/graph-fakes";
import { clearScanCaches, dropOutdatedCaches } from "./cache-version";

function storageWithCaches() {
  const storage = memoryStorage();
  storage.data.set("scan:s1", { v: 2 });
  storage.data.set("scan:s1:gen:0", []);
  storage.data.set("scan-resume:s1", { v: 1 });
  storage.data.set("ai:s1", { summary: "…" });
  storage.data.set("tenant:v1", {});
  // records, not caches
  storage.data.set("history:s1", []);
  storage.data.set("trend:s1", []);
  return storage;
}

describe("dropOutdatedCaches", () => {
  it("drops cached scans after an update and keeps history and trend", async () => {
    const storage = storageWithCaches();
    expect(await dropOutdatedCaches("1.2.0", storage)).toBe(true);
    expect([...storage.data.keys()].sort()).toEqual(["cache-version", "history:s1", "trend:s1"]);
    expect(storage.data.get("cache-version")).toBe("1.2.0");
  });

  it("keeps the caches while the version stays the same", async () => {
    const storage = storageWithCaches();
    storage.data.set("cache-version", "1.2.0");
    expect(await dropOutdatedCaches("1.2.0", storage)).toBe(false);
    expect(storage.data.has("scan:s1")).toBe(true);
  });

  it("does nothing without a known version and never blocks the start", async () => {
    const storage = storageWithCaches();
    expect(await dropOutdatedCaches(undefined, storage)).toBe(false);
    expect(storage.data.has("scan:s1")).toBe(true);
    const broken = { ...storage, getMany: () => Promise.reject(new Error("IndexedDB gesperrt")) };
    expect(await dropOutdatedCaches("1.3.0", broken)).toBe(false);
  });

  it("clears every cached scan on request", async () => {
    const storage = storageWithCaches();
    expect(await clearScanCaches(storage)).toBe(5);
    expect(storage.data.has("history:s1")).toBe(true);
  });
});
