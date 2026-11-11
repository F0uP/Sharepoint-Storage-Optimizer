import { describe, expect, it } from "vitest";
import { MB, makeFile } from "../../tests/factories";
import { toCsv } from "./csv";

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
});
