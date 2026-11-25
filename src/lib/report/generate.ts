import { createElement, type ReactElement } from "react";
import { pdf, type DocumentProps } from "@react-pdf/renderer";
import { FolderReportDocument, type FolderReportData } from "./folder-report-document";
import { ReportDocument, type ReportData } from "./report-document";

function slug(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function reportFileName(data: ReportData) {
  return `Speicherbericht-${slug(data.scan.site.name) || "site"}-${data.generatedAt.toISOString().slice(0, 10)}.pdf`;
}

export function folderReportFileName(data: FolderReportData) {
  const site = slug(data.site.name) || "site";
  const folder = slug(data.summary.folder.name).slice(0, 60) || "ordner";
  return `Ordnerbericht-${site}-${folder}-${data.generatedAt.toISOString().slice(0, 10)}.pdf`;
}

/** Renders a document and hands it to the browser (desktop app: save dialog). Loaded on demand. */
async function download(element: ReactElement, fileName: string) {
  // the documents render a <Document> – react-pdf only types the root element
  const blob = await pdf(element as unknown as ReactElement<DocumentProps>).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadReport(data: ReportData) {
  return download(createElement(ReportDocument, { data }), reportFileName(data));
}

export function downloadFolderReport(data: FolderReportData) {
  return download(createElement(FolderReportDocument, { data }), folderReportFileName(data));
}
