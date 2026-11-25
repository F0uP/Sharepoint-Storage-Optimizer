import { Document, Page, Text, View } from "@react-pdf/renderer";
import type { PotentialSummary } from "../analysis";
import { yearlyCost } from "../costs";
import type { FolderSummary } from "../folders";
import { formatBytes, formatCurrency, formatDate, formatNumber, formatPercent } from "../format";
import type { SiteRef } from "../types";
import { CategorySection, Footer, Kpi, LargestFilesSection, s, Table } from "./parts";

export interface FolderReportData {
  site: SiteRef;
  scannedAt: string;
  summary: FolderSummary;
  potential: PotentialSummary;
  /** volume of all files of the site – for the folder's share */
  siteBytes: number;
  generatedAt: Date;
  demo: boolean;
  /** € per GB and month for the cost estimate */
  price: number;
}

const share = (part: number, whole: number) => (whole > 0 ? formatPercent(part / whole) : "–");

/** Report on one folder (subfolders included) – for the people responsible for it. */
export function FolderReportDocument({ data }: { data: FolderReportData }) {
  const { site, summary, potential, siteBytes, generatedAt, price } = data;
  const { folder, files, insights, versionBytes, stale, ages, editors, subfolders } = summary;
  const optimizations = insights.filter((i) => i.savings > 0).toSorted((a, b) => b.savings - a.savings);
  const children = folder.children.slice(0, 15);

  return (
    <Document title={`Ordnerbericht – ${folder.name}`} author="SharePoint Storage Optimizer" language="de">
      <Page size="A4" style={s.page}>
        <Text style={s.eyebrow}>Ordnerbericht{data.demo ? " · Demo-Daten" : ""}</Text>
        <Text style={s.title}>{folder.name}</Text>
        <Text style={s.subtitle}>{[site.name, ...folder.path.split("/")].join(" › ")}</Text>
        <Text style={s.subtitle}>
          Stand {formatDate(generatedAt.toISOString())} · Scan vom {formatDate(data.scannedAt)}
          {folder.newest ? ` · zuletzt geändert ${formatDate(folder.newest)}` : ""}
        </Text>

        <View style={s.kpis}>
          <Kpi
            label="Belegter Speicher"
            value={formatBytes(folder.bytes)}
            sub={`${share(folder.bytes, siteBytes)} der Site${versionBytes ? ` · + ${formatBytes(versionBytes)} alte Versionen` : ""}`}
          />
          <Kpi
            label="Einsparpotenzial"
            value={formatBytes(potential.bytes)}
            sub={`ca. ${formatCurrency(yearlyCost(potential.bytes, price))}/Jahr · ${formatBytes(potential.safeBytes)} risikoarm`}
          />
          <Kpi
            label="Dateien"
            value={formatNumber(folder.count)}
            sub={subfolders ? `in ${formatNumber(subfolders)} Unterordnern` : "keine Unterordner"}
          />
          <Kpi
            label="Seit 2 Jahren unverändert"
            value={formatBytes(stale.bytes)}
            sub={`${share(stale.bytes, folder.bytes)} · ${formatNumber(stale.count)} Dateien`}
          />
        </View>

        <CategorySection files={files} />

        <View style={s.section} wrap={false}>
          <Text style={s.h2}>Alter der Daten</Text>
          <Table
            columns={[
              { label: "Letzte Änderung", width: "40%" },
              { label: "Dateien", width: "20%", align: "right" },
              { label: "Größe", width: "20%", align: "right" },
              { label: "Anteil", width: "20%", align: "right" },
            ]}
            rows={ages.map((a) => [a.label, formatNumber(a.count), formatBytes(a.bytes), share(a.bytes, folder.bytes)])}
          />
        </View>

        {optimizations.length > 0 && (
          <View style={s.section}>
            <Text style={s.h2}>Einsparmöglichkeiten</Text>
            <Table
              columns={[
                { label: "Kategorie", width: "55%" },
                { label: "Dateien", width: "20%", align: "right" },
                { label: "Einsparung", width: "25%", align: "right" },
              ]}
              rows={optimizations.map((i) => [i.title, formatNumber(i.rows.length), formatBytes(i.savings)])}
            />
          </View>
        )}

        {children.length > 0 && (
          <View style={s.section}>
            <Text style={s.h2}>{folder.children.length > children.length ? `Die ${children.length} größten Unterordner` : "Unterordner"}</Text>
            <Table
              columns={[
                { label: "Ordner", width: "44%" },
                { label: "Dateien", width: "14%", align: "right" },
                { label: "Geändert", width: "16%", align: "right" },
                { label: "Größe", width: "14%", align: "right" },
                { label: "Anteil", width: "12%", align: "right" },
              ]}
              rows={children.map((c) => [
                c.name,
                formatNumber(c.count),
                c.newest ? formatDate(c.newest) : "–",
                formatBytes(c.bytes),
                share(c.bytes, folder.bytes),
              ])}
            />
            {folder.ownCount > 0 && (
              <Text style={[s.muted, { marginTop: 4 }]}>
                Direkt im Ordner: {formatNumber(folder.ownCount)} Dateien, {formatBytes(folder.ownBytes)}
              </Text>
            )}
          </View>
        )}

        {editors.length > 0 && (
          <View style={s.section} wrap={false}>
            <Text style={s.h2}>Zuletzt bearbeitet von</Text>
            <Table
              columns={[
                { label: "Person", width: "50%" },
                { label: "Dateien", width: "16%", align: "right" },
                { label: "Größe", width: "18%", align: "right" },
                { label: "Anteil", width: "16%", align: "right" },
              ]}
              rows={editors.map((e) => [e.name, formatNumber(e.count), formatBytes(e.bytes), share(e.bytes, folder.bytes)])}
            />
          </View>
        )}

        <LargestFilesSection files={files} relativeTo={folder.path} />

        <Text style={[s.muted, { marginTop: 18, fontSize: 7.5 }]}>
          Größen ohne Papierkorb; Unterordner sind enthalten. Kosten geschätzt mit {formatCurrency(price)} pro GB und Monat.
        </Text>

        <Footer label={`${site.name} · ${folder.name}`} />
      </Page>
    </Document>
  );
}
