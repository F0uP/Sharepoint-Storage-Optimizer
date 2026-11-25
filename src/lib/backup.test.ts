// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { backupSegments, countFolders, countLongPaths, loadBackupLayout, saveBackupLayout } from "./backup";

const file = { path: "Dokumente/Projekte/2021", name: "Plan.pdf" };

describe("backupSegments", () => {
  it("recreates the complete SharePoint path including the site", () => {
    expect(backupSegments(file, "site", "Vertrieb Nord")).toEqual(["Vertrieb Nord", "Dokumente", "Projekte", "2021", "Plan.pdf"]);
  });

  it("starts at the library or drops all folders", () => {
    expect(backupSegments(file, "library", "Vertrieb Nord")).toEqual(["Dokumente", "Projekte", "2021", "Plan.pdf"]);
    expect(backupSegments(file, "flat", "Vertrieb Nord")).toEqual(["Plan.pdf"]);
  });

  it("keeps a site name with slashes in one folder", () => {
    expect(backupSegments({ path: "Dokumente", name: "a.txt" }, "site", "Vertrieb / Nord")[0]).toBe("Vertrieb - Nord");
    expect(backupSegments({ path: "Dokumente", name: "a.txt" }, "site", " / ")[0]).toBe("-");
  });
});

describe("countFolders / countLongPaths", () => {
  it("counts every folder once, parents included", () => {
    const paths = [
      ["Site", "Dokumente", "A", "1.txt"],
      ["Site", "Dokumente", "A", "2.txt"],
      ["Site", "dokumente", "B", "3.txt"],
    ];
    // Site, Site/Dokumente, Site/Dokumente/A, Site/Dokumente/B – case does not matter on Windows and macOS
    expect(countFolders(paths)).toBe(4);
    expect(countFolders([["a.txt"], ["b.txt"]])).toBe(0);
  });

  it("finds paths too long for Windows tools", () => {
    const deep = ["Site", "x".repeat(120), "y".repeat(120), "z.txt"];
    expect(countLongPaths("D:\\Backup", [deep, ["kurz.txt"]])).toBe(1);
    expect(countLongPaths("D:\\Backup\\", [["kurz.txt"]])).toBe(0);
  });
});

describe("layout preference", () => {
  afterEach(() => localStorage.clear());

  it("remembers the last choice and defaults to the complete path", () => {
    expect(loadBackupLayout()).toBe("site");
    saveBackupLayout("flat");
    expect(loadBackupLayout()).toBe("flat");
    localStorage.setItem("spo:backup-layout", "kaputt");
    expect(loadBackupLayout()).toBe("site");
  });
});
