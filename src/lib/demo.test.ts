import { describe, expect, it } from "vitest";
import { DEMO_SITES, demoScanVersions, generateDemoScan } from "./demo";

describe("demo data", () => {
  it("is deterministic per site", () => {
    const a = generateDemoScan(DEMO_SITES[0]);
    const b = generateDemoScan(DEMO_SITES[0]);
    expect(a.files.length).toBe(b.files.length);
    expect(a.files.slice(0, 50).map((f) => [f.name, f.size])).toEqual(b.files.slice(0, 50).map((f) => [f.name, f.size]));
  });

  it("keeps quota, files and hidden version history consistent", async () => {
    const scan = generateDemoScan(DEMO_SITES[1]);
    const fileBytes = scan.files.reduce((s, f) => s + f.size, 0);
    const versions = await demoScanVersions(scan.files);
    const versionBytes = [...versions.values()].reduce((s, v) => s + v.bytes, 0);

    expect(scan.quota!.used).toBe(fileBytes + versionBytes + scan.quota!.deleted);
    expect(scan.quota!.used).toBeLessThan(scan.quota!.total);
    expect(scan.quota!.remaining).toBe(scan.quota!.total - scan.quota!.used);
  }, 20_000);

  it("contains the patterns the optimizer looks for", () => {
    const scan = generateDemoScan(DEMO_SITES[0]);
    const hashes = new Map<string, number>();
    for (const f of scan.files) hashes.set(`${f.hash}:${f.size}`, (hashes.get(`${f.hash}:${f.size}`) ?? 0) + 1);
    expect([...hashes.values()].some((c) => c > 1)).toBe(true);
    expect(scan.files.some((f) => f.name === "Thumbs.db" || f.name.startsWith("~$"))).toBe(true);
    expect(scan.files.some((f) => f.category === "video")).toBe(true);
    expect(scan.drives.reduce((s, d) => s + d.fileCount, 0)).toBe(scan.files.length);
  });
});
