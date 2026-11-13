import { createElement, type ReactElement } from "react";
import { pdf, type DocumentProps } from "@react-pdf/renderer";
import { ReportDocument, type ReportData } from "./report-document";

function slug(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function reportFileName(data: ReportData) {
  return `Speicherbericht-${slug(data.scan.site.name) || "site"}-${data.generatedAt.toISOString().slice(0, 10)}.pdf`;
}

/** Renders the report and hands it to the browser (desktop app: save dialog). Loaded on demand. */
export async function downloadReport(data: ReportData) {
  // ReportDocument renders a <Document> – react-pdf only types the root element
  const element = createElement(ReportDocument, { data }) as unknown as ReactElement<DocumentProps>;
  const blob = await pdf(element).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = reportFileName(data);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
