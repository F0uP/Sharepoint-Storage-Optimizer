import { describe, expect, it } from "vitest";
import { MB, makeFile } from "../../tests/factories";
import { backupIndexCsv, toCsv } from "./csv";

describe("toCsv", () => {
  it("writes an Excel-friendly, semicolon separated file with BOM", () => {
    const csv = toCsv([{ file: makeFile({ name: "Budget; final.xlsx", size: 3 * MB }), bytes: 3 * MB, note: "Duplikat" }]);
    const [header, row] = csv.slice(1).split("\r\n");

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(header).toBe("Name;Pfad;Typ;Größe (Bytes);Größe;Geändert am;Geändert von;Hinweis;Link");
    expect(row).toContain('"Budget; final.xlsx"');
    expect(row).toContain(";3 MB;");
    expect(row).toContain(";Duplikat;");
  });

  it("does not let file names become Excel formulas", () => {
    const csv = toCsv([{ file: makeFile({ name: "=HYPERLINK(1).xlsx" }), bytes: 1 }]);
    expect(csv).toContain("'=HYPERLINK(1).xlsx");
  });
});

describe("backupIndexCsv", () => {
  it("records where each copy came from", () => {
    const file = makeFile({ name: "Plan.pdf", path: "Dokumente/Projekte", size: 3 * MB, webUrl: "https://contoso.sharepoint.com/x" });
    const csv = backupIndexCsv([{ file, local: "Vertrieb\\Dokumente\\Projekte\\Plan (2).pdf", site: "Vertrieb" }]);
    const [header, row, end] = csv.slice(1).split("\r\n");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(header).toBe("Lokale Datei;Site;SharePoint-Pfad;Größe (Bytes);Größe;Geändert am;Geändert von;SharePoint-Link");
    expect(row).toMatch(/^Vertrieb\\Dokumente\\Projekte\\Plan \(2\)\.pdf;Vertrieb;Dokumente\/Projekte\/Plan\.pdf;3145728;3 MB;/);
    expect(row).toContain("https://contoso.sharepoint.com/x");
    expect(end).toBe("");
  });
});
