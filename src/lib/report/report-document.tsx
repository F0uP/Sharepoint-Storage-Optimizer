import { Document, Page, Polyline, Rect, Svg, Text, View } from "@react-pdf/renderer";
import { folderStats, type Insight, type PotentialSummary } from "../analysis";
import { describeForecast, forecast, yearlyCost } from "../costs";
import { formatBytes, formatCurrency, formatDate, formatNumber, formatPercent } from "../format";
import { totalFreed, type HistoryEntry, type HistoryKind } from "../history";
import { quotaUsage, siteLimit } from "../quota";
import type { Snapshot } from "../trend";
import type { AiResult, ScanResult } from "../types";
import { CategorySection, CHART_HEX, Footer, Kpi, LargestFilesSection, MUTED, s, Table } from "./parts";

export interface ReportData {
  scan: ScanResult;
  insights: Insight[];
  potential: PotentialSummary;
  history: HistoryEntry[];
  trend: Snapshot[];
  ai: AiResult | null;
  generatedAt: Date;
  demo: boolean;
  /** € per GB and month for the cost estimate */
  price: number;
}

const KIND_LABEL: Record<HistoryKind, string> = {
  delete: "Gelöscht",
  backup: "Gesichert & gelöscht",
  versions: "Alte Versionen gelöscht",
  "recycle-bin": "Papierkorb geleert",
  compress: "Komprimiert",
  "version-limit": "Versionslimit gesetzt",
  restore: "Wiederhergestellt",
  notify: "Besitzer benachrichtigt",
};

function TrendChart({ trend }: { trend: Snapshot[] }) {
  const width = 515;
  const height = 90;
  const limit = siteLimit(trend[trend.length - 1]);
  const max = Math.max(1, limit ?? 0, ...trend.map((t) => t.used));
  const t0 = Date.parse(trend[0].at);
  const span = Math.max(1, Date.parse(trend[trend.length - 1].at) - t0);
  const x = (at: string) => ((Date.parse(at) - t0) / span) * width;
  const y = (v: number) => height - (v / max) * (height - 6);
  const points = trend.map((t) => `${x(t.at).toFixed(1)},${y(t.used).toFixed(1)}`).join(" ");
  return (
    <View>
      <Svg width={width} height={height}>
        {limit && <Rect x={0} y={y(limit)} width={width} height={0.8} fill={MUTED} />}
        <Polyline points={points} stroke={CHART_HEX["var(--chart-1)"]} strokeWidth={2} fill="none" />
      </Svg>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
        <Text style={s.muted}>
          {formatDate(trend[0].at)} · {formatBytes(trend[0].used)}
        </Text>
        <Text style={s.muted}>{limit ? `Linie oben: Kontingent ${formatBytes(limit)}` : "Kein eigenes Site-Limit"}</Text>
        <Text style={s.muted}>
          {formatDate(trend[trend.length - 1].at)} · {formatBytes(trend[trend.length - 1].used)}
        </Text>
      </View>
    </View>
  );
}

export function ReportDocument({ data }: { data: ReportData }) {
  const { scan, insights, potential, history, trend, ai, generatedAt, price } = data;
  const prediction = forecast(trend, generatedAt.getTime());
  const quota = scan.quota;
  const usage = quotaUsage(quota);
  const folders = folderStats(scan.files, 3, 10);
  const freed = totalFreed(history);
  const optimizations = insights.filter((i) => i.savings > 0).toSorted((a, b) => b.savings - a.savings);
  const actions = history.filter((h) => h.kind !== "restore").slice(0, 15);

  return (
    <Document title={`Speicherbericht – ${scan.site.name}`} author="SharePoint Storage Optimizer" language="de">
      <Page size="A4" style={s.page}>
        <Text style={s.eyebrow}>Speicherbericht{data.demo ? " · Demo-Daten" : ""}</Text>
        <Text style={s.title}>{scan.site.name}</Text>
        <Text style={s.subtitle}>
          {scan.site.webUrl} · Stand {formatDate(generatedAt.toISOString())} · Scan vom {formatDate(scan.scannedAt)}
        </Text>

        <View style={s.kpis}>
          <Kpi
            label="Belegter Speicher"
            value={formatBytes(quota?.used ?? 0)}
            sub={
              !quota
                ? "Kontingent unbekannt"
                : usage !== undefined
                  ? `${formatPercent(usage)} von ${formatBytes(quota.total)}`
                  : "kein eigenes Limit – gemeinsamer Speicher des Mandanten"
            }
          />
          <Kpi
            label="Einsparpotenzial"
            value={formatBytes(potential.bytes)}
            sub={`ca. ${formatCurrency(yearlyCost(potential.bytes, price))}/Jahr · ${formatBytes(potential.safeBytes)} risikoarm`}
          />
          <Kpi
            label="Bereits freigegeben"
            value={formatBytes(freed)}
            sub={`ca. ${formatCurrency(yearlyCost(freed, price))}/Jahr · ${formatNumber(history.length)} Maßnahmen`}
          />
          <Kpi label="Dateien" value={formatNumber(scan.files.length)} sub={`in ${formatNumber(scan.drives.length)} Bibliotheken`} />
        </View>

        <CategorySection files={scan.files} />

        {trend.length > 1 && (
          <View style={s.section} wrap={false}>
            <Text style={s.h2}>Speicherverlauf</Text>
            <TrendChart trend={trend} />
            <Text style={{ marginTop: 6 }}>
              {"growthPerMonth" in prediction
                ? `Wachstum ${prediction.growthPerMonth >= 0 ? "+" : "-"}${formatBytes(Math.abs(prediction.growthPerMonth))} pro Monat. `
                : ""}
              {describeForecast(prediction)}
            </Text>
          </View>
        )}

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
          {potential.recycleBin > 0 && (
            <Text style={[s.muted, { marginTop: 4 }]}>Zusätzlich im Papierkorb: {formatBytes(potential.recycleBin)}</Text>
          )}
        </View>

        {ai && (
          <View style={s.section} wrap={false}>
            <Text style={s.h2}>Einschätzung der KI ({ai.provider})</Text>
            <Text>{ai.summary}</Text>
          </View>
        )}

        <View style={s.section}>
          <Text style={s.h2}>Größte Ordner</Text>
          <Table
            columns={[
              { label: "Ordner", width: "60%" },
              { label: "Dateien", width: "20%", align: "right" },
              { label: "Größe", width: "20%", align: "right" },
            ]}
            rows={folders.map((f) => [f.path, formatNumber(f.count), formatBytes(f.bytes)])}
          />
        </View>

        {actions.length > 0 && (
          <View style={s.section}>
            <Text style={s.h2}>Durchgeführte Maßnahmen</Text>
            <Table
              columns={[
                { label: "Datum", width: "18%" },
                { label: "Maßnahme", width: "30%" },
                { label: "Details", width: "34%" },
                { label: "Speicher", width: "18%", align: "right" },
              ]}
              rows={actions.map((h) => [
                formatDate(h.at),
                KIND_LABEL[h.kind],
                h.note ?? (h.fileCount ? `${formatNumber(h.fileCount)} Dateien${h.permanent ? ", endgültig" : ""}` : ""),
                h.bytes ? formatBytes(h.bytes) : "–",
              ])}
            />
          </View>
        )}

        <LargestFilesSection files={scan.files} />

        <Text style={[s.muted, { marginTop: 18, fontSize: 7.5 }]}>
          Kosten geschätzt mit {formatCurrency(price)} pro GB und Monat.
        </Text>

        <Footer label={scan.site.name} />
      </Page>
    </Document>
  );
}
