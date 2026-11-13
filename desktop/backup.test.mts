import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { downloadAll, downloadTo, isAllowedSource, resolveInside, safeSegment } from "./backup.mjs";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "spo-backup-test-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const dataUrl = (text: string) => `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`;

describe("safeSegment / resolveInside", () => {
  it("makes SharePoint names valid file names", () => {
    expect(safeSegment('Angebot: "Final"?.docx')).toBe("Angebot_ _Final__.docx");
    expect(safeSegment("CON")).toBe("_CON");
    expect(safeSegment("Ordner. ")).toBe("Ordner");
    expect(safeSegment("..")).toBe("_");
  });

  it("never resolves outside the chosen folder", () => {
    expect(resolveInside(dir, "Dokumente/Projekte/a.txt")).toBe(path.join(dir, "Dokumente", "Projekte", "a.txt"));
    // ".." becomes "_" instead of climbing up
    expect(resolveInside(dir, "../../etc/passwd")).toBe(path.join(dir, "_", "_", "etc", "passwd"));
    expect(() => resolveInside(dir, "")).toThrow();
  });
});

describe("isAllowedSource", () => {
  it("only allows SharePoint download URLs and data URLs", () => {
    expect(isAllowedSource("https://contoso.sharepoint.com/sites/x/_layouts/15/download.aspx?UniqueId=1")).toBe(true);
    expect(isAllowedSource("data:text/plain,hi")).toBe(true);
    expect(isAllowedSource("http://contoso.sharepoint.com/x")).toBe(false);
    expect(isAllowedSource("https://evil.example.com/x")).toBe(false);
    expect(isAllowedSource("file:///etc/passwd")).toBe(false);
  });
});

describe("downloadTo / downloadAll", () => {
  it("writes the file, keeps the folder structure and never overwrites", async () => {
    const target = path.join(dir, "Lib", "a.txt");
    await downloadTo(dataUrl("eins"), target);
    const second = await downloadTo(dataUrl("zwei"), target);
    expect(second.path).toBe(path.join(dir, "Lib", "a (2).txt"));
    expect(await readFile(target, "utf8")).toBe("eins");
    expect(await readFile(second.path, "utf8")).toBe("zwei");
  });

  it("rejects incomplete downloads and leaves no partial file", async () => {
    const target = path.join(dir, "b.txt");
    await expect(downloadTo(dataUrl("kurz"), target, 999)).rejects.toThrow(/Unvollständig/);
    expect(await readdir(dir)).toEqual([]);
  });

  it("reports success and failure per job", async () => {
    await writeFile(path.join(dir, "marker"), "");
    const progress: number[] = [];
    const result = await downloadAll(
      dir,
      [
        { id: "1", url: dataUrl("ok"), relativePath: "Dokumente/ok.txt", size: 2 },
        { id: "2", url: "https://evil.example.com/x", relativePath: "Dokumente/x.txt" },
      ],
      (done) => progress.push(done),
    );
    expect(result.succeeded).toEqual(["1"]);
    expect(result.failed).toEqual([{ id: "2", error: "Download-Quelle nicht erlaubt" }]);
    expect(progress.at(-1)).toBe(2);
    expect(await readFile(path.join(dir, "Dokumente", "ok.txt"), "utf8")).toBe("ok");
  });
});
