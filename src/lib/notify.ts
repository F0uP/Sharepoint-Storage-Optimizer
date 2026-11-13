import { formatBytes, formatDate } from "./format";
import type { OwnerMail, SpFile } from "./types";

export interface OwnerGroup {
  name: string;
  email: string;
  files: SpFile[];
  bytes: number;
}

/** Groups files by their last editor; files without a known e-mail address are returned separately. */
export function groupByOwner(files: SpFile[]): { groups: OwnerGroup[]; unknown: SpFile[] } {
  const map = new Map<string, OwnerGroup>();
  const unknown: SpFile[] = [];
  for (const f of files) {
    const email = f.modifiedByEmail?.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      unknown.push(f);
      continue;
    }
    const g = map.get(email) ?? { name: f.modifiedBy || email, email, files: [], bytes: 0 };
    g.files.push(f);
    g.bytes += f.size;
    map.set(email, g);
  }
  return { groups: [...map.values()].sort((a, b) => b.bytes - a.bytes), unknown };
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const MAX_LISTED = 50;

export function buildOwnerMail(
  group: OwnerGroup,
  { siteName, message, deadline }: { siteName: string; message: string; deadline: Date },
): OwnerMail {
  const firstName = group.name.split(/\s+/)[0] || group.name;
  const listed = group.files.toSorted((a, b) => b.size - a.size).slice(0, MAX_LISTED);
  const rows = listed
    .map(
      (f) =>
        `<tr><td style="padding:4px 12px 4px 0"><a href="${escapeHtml(f.webUrl)}">${escapeHtml(f.name)}</a><br><span style="color:#737373;font-size:12px">${escapeHtml(f.path)}</span></td>` +
        `<td style="padding:4px 0;text-align:right;white-space:nowrap">${escapeHtml(formatBytes(f.size))}</td></tr>`,
    )
    .join("");
  const more = group.files.length > listed.length ? `<p style="color:#737373">… und ${group.files.length - listed.length} weitere.</p>` : "";
  const intro = message
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");

  return {
    to: { name: group.name, email: group.email },
    subject: `Bitte prüfen: ${group.files.length} ${group.files.length === 1 ? "Datei" : "Dateien"} (${formatBytes(group.bytes)}) in „${siteName}“`,
    html:
      `<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;color:#171717">` +
      `<p>Hallo ${escapeHtml(firstName)},</p>${intro}` +
      `<p>Bitte gib bis <strong>${escapeHtml(formatDate(deadline.toISOString()))}</strong> Bescheid, welche Dateien noch gebraucht werden.</p>` +
      `<table style="border-collapse:collapse;font-size:13px">${rows}</table>${more}</div>`,
  };
}

export const DEFAULT_OWNER_MESSAGE =
  "unser SharePoint-Speicher wird knapp. Die folgenden großen Dateien wurden zuletzt von dir bearbeitet – werden sie noch gebraucht?\n\nAlles, was nicht mehr benötigt wird, löschen wir nach Ablauf der Frist.";
