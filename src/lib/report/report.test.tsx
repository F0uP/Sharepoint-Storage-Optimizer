import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { makeFile, makeScan, MB } from "../../../tests/factories";
import { computeInsights, potential } from "../analysis";
import { folderTree, summarizeFolder } from "../folders";
import { createEntry } from "../history";
import { FolderReportDocument, type FolderReportData } from "./folder-report-document";
import { folderReportFileName, reportFileName } from "./generate";
import { ReportDocument, type ReportData } from "./report-document";

describe("PDF report", () => {
  const files = [
    makeFile({ name: "Imagefilm.mp4", category: "video", size: 800 * MB }),
    makeFile({ name: "Präsentation.pptx", size: 30 * MB }),
    makeFile({ name: "~$Präsentation.pptx", size: 1024 }),
  ];
  const scan = makeScan(files, { site: { id: "s", name: "Marketing & Kommunikation", webUrl: "https://contoso.sharepoint.com/sites/m" } });
  const insights = computeInsights(files, Date.parse(scan.scannedAt));
  const data: ReportData = {
    scan,
    insights,
    potential: potential(insights, scan.quota),
    history: [createEntry("delete", [files[0]], 800 * MB, { permanent: true })],
    trend: [
      { at: "2026-09-01T00:00:00Z", used: 40 * 1024 * MB, total: 100 * 1024 * MB, deleted: 0 },
      { at: "2026-11-01T00:00:00Z", used: 50 * 1024 * MB, total: 100 * 1024 * MB, deleted: 0 },
    ],
    ai: null,
    generatedAt: new Date("2026-11-12T09:00:00Z"),
    demo: false,
    price: 0.2,
  };

  it("renders a PDF with umlauts and all sections", async () => {
    const buffer = await renderToBuffer((<ReportDocument data={data} />) as unknown as ReactElement<DocumentProps>);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buffer.length).toBeGreaterThan(3000);
  }, 30_000);

  it("names the file after the site and date", () => {
    expect(reportFileName(data)).toBe("Speicherbericht-marketing-kommunikation-2026-11-12.pdf");
  });
});

describe("folder report", () => {
  const files = [
    makeFile({ name: "Imagefilm.mp4", category: "video", size: 800 * MB, path: "Dokumente/Marketing/Videos" }),
    makeFile({ name: "Präsentation.pptx", size: 30 * MB, path: "Dokumente/Marketing", modifiedBy: "Jörg Müller" }),
    makeFile({ name: "Budget.xlsx", size: 2 * MB, path: "Dokumente/Finanzen" }),
  ];
  const scan = makeScan(files, { site: { id: "s", name: "Marketing & Kommunikation", webUrl: "https://contoso.sharepoint.com/sites/m" } });
  const tree = folderTree(files);
  const summary = summarizeFolder(files, tree, "Dokumente/Marketing", computeInsights(files, Date.parse(scan.scannedAt)), Date.parse(scan.scannedAt))!;
  const data: FolderReportData = {
    site: scan.site,
    scannedAt: scan.scannedAt,
    summary,
    potential: potential(summary.insights),
    siteBytes: 832 * MB,
    generatedAt: new Date("2026-11-12T09:00:00Z"),
    demo: false,
    price: 0.2,
  };

  it("renders a PDF for one folder", async () => {
    const buffer = await renderToBuffer((<FolderReportDocument data={data} />) as unknown as ReactElement<DocumentProps>);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buffer.length).toBeGreaterThan(3000);
  }, 30_000);

  it("names the file after the site, the folder and the date", () => {
    expect(folderReportFileName(data)).toBe("Ordnerbericht-marketing-kommunikation-marketing-2026-11-12.pdf");
  });
});
