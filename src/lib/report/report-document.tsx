import { Document, Font, Page, Polyline, Rect, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import { categoryStats, folderStats, type Insight, type PotentialSummary } from "../analysis";
import { describeForecast, forecast, yearlyCost } from "../costs";
import { CATEGORY_META } from "../file-types";
import { formatBytes, formatCurrency, formatDate, formatNumber, formatPercent } from "../format";
import { totalFreed, type HistoryEntry, type HistoryKind } from "../history";
import type { Snapshot } from "../trend";
import type { AiResult, ScanResult } from "../types";

// German words must not be hyphenated in odd places
Font.registerHyphenationCallback((word) => [word]);

/** Same validated palette as the charts in the app (light theme). */
const CHART_HEX: Record<string, string> = {
  "var(--chart-1)": "#2a78d6",
  "var(--chart-2)": "#eb6834",
  "var(--chart-3)": "#1baf7a",
  "var(--chart-4)": "#eda100",
  "var(--chart-5)": "#e87ba4",
  "var(--chart-6)": "#008300",
};

const INK = "#171717";
const MUTED = "#737373";
const LINE = "#e5e5e5";

const s = StyleSheet.create({
  page: { padding: 40, paddingBottom: 56, fontFamily: "Helvetica", fontSize: 9, color: INK, lineHeight: 1.35 },
  eyebrow: { fontSize: 8, color: MUTED, textTransform: "uppercase", letterSpacing: 0.8 },
  title: { fontSize: 20, fontFamily: "Helvetica-Bold", marginTop: 4 },
  subtitle: { color: MUTED, marginTop: 2 },
  kpis: { flexDirection: "row", gap: 8, marginTop: 20 },
  kpi: { flex: 1, borderWidth: 1, borderColor: LINE, borderRadius: 6, padding: 10 },
  kpiLabel: { fontSize: 8, color: MUTED },
  kpiValue: { fontSize: 15, fontFamily: "Helvetica-Bold", marginTop: 4 },
  kpiSub: { fontSize: 7.5, color: MUTED, marginTop: 2 },
  section: { marginTop: 22 },
  h2: { fontSize: 11, fontFamily: "Helvetica-Bold", marginBottom: 8 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 4 },
  head: { flexDirection: "row", paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: INK },
  th: { fontSize: 7.5, color: MUTED, fontFamily: "Helvetica-Bold" },
  num: { textAlign: "right" },
  muted: { color: MUTED },
  footer: { position: "absolute", left: 40, right: 40, bottom: 24, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: MUTED },
});

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

function Table({ columns, rows }: { columns: { label: string; width: string; align?: "right" }[]; rows: string[][] }) {
  return (
    <View>
      <View style={s.head}>
        {columns.map((c) => (
          <Text key={c.label} style={[s.th, { width: c.width }, c.align === "right" ? s.num : {}]}>
            {c.label}
          </Text>
        ))}
      </View>
      {rows.map((r, i) => (
        <View key={i} style={s.row} wrap={false}>
          {r.map((cell, j) => (
            <Text key={j} style={[{ width: columns[j].width }, columns[j].align === "right" ? s.num : {}]}>
              {cell}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function TrendChart({ trend }: { trend: Snapshot[] }) {
  const width = 515;
  const height = 90;
  const max = Math.max(...trend.map((t) => Math.max(t.used, t.total)));
  const t0 = Date.parse(trend[0].at);
  const span = Math.max(1, Date.parse(trend[trend.length - 1].at) - t0);
  const x = (at: string) => ((Date.parse(at) - t0) / span) * width;
  const y = (v: number) => height - (v / max) * (height - 6);
  const points = trend.map((t) => `${x(t.at).toFixed(1)},${y(t.used).toFixed(1)}`).join(" ");
  const quotaY = y(trend[trend.length - 1].total);
  return (
    <View>
      <Svg width={width} height={height}>
        <Rect x={0} y={quotaY} width={width} height={0.8} fill={MUTED} />
        <Polyline points={points} stroke={CHART_HEX["var(--chart-1)"]} strokeWidth={2} fill="none" />
      </Svg>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
        <Text style={s.muted}>
          {formatDate(trend[0].at)} · {formatBytes(trend[0].used)}
        </Text>
        <Text style={s.muted}>Linie oben: Kontingent {formatBytes(trend[trend.length - 1].total)}</Text>
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
  const categories = categoryStats(scan.files).filter((c) => c.count > 0);
  const categoryTotal = categories.reduce((sum, c) => sum + c.bytes, 0) || 1;
  const folders = folderStats(scan.files, 3, 10);
  const top = scan.files.toSorted((a, b) => b.size - a.size).slice(0, 20);
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
          <View style={s.kpi}>
            <Text style={s.kpiLabel}>Belegter Speicher</Text>
            <Text style={s.kpiValue}>{formatBytes(quota?.used ?? 0)}</Text>
            <Text style={s.kpiSub}>
              {quota ? `${formatPercent(quota.used / Math.max(1, quota.total))} von ${formatBytes(quota.total)}` : "Kontingent unbekannt"}
            </Text>
          </View>
          <View style={s.kpi}>
            <Text style={s.kpiLabel}>Einsparpotenzial</Text>
            <Text style={s.kpiValue}>{formatBytes(potential.bytes)}</Text>
            <Text style={s.kpiSub}>
              ca. {formatCurrency(yearlyCost(potential.bytes, price))}/Jahr · {formatBytes(potential.safeBytes)} risikoarm
            </Text>
          </View>
          <View style={s.kpi}>
            <Text style={s.kpiLabel}>Bereits freigegeben</Text>
            <Text style={s.kpiValue}>{formatBytes(freed)}</Text>
            <Text style={s.kpiSub}>
              ca. {formatCurrency(yearlyCost(freed, price))}/Jahr · {formatNumber(history.length)} Maßnahmen
            </Text>
          </View>
          <View style={s.kpi}>
            <Text style={s.kpiLabel}>Dateien</Text>
            <Text style={s.kpiValue}>{formatNumber(scan.files.length)}</Text>
            <Text style={s.kpiSub}>in {formatNumber(scan.drives.length)} Bibliotheken</Text>
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.h2}>Speicher nach Dateityp</Text>
          <Svg width={515} height={10}>
            {categories.reduce<{ x: number; nodes: React.ReactElement[] }>(
              (acc, c) => {
                const w = (c.bytes / categoryTotal) * 515;
                acc.nodes.push(<Rect key={c.category} x={acc.x} y={0} width={Math.max(0, w - 1.5)} height={10} fill={CHART_HEX[CATEGORY_META[c.category].color]} />);
                acc.x += w;
                return acc;
              },
              { x: 0, nodes: [] },
            ).nodes}
          </Svg>
          <View style={{ marginTop: 8 }}>
            <Table
              columns={[
                { label: "Typ", width: "40%" },
                { label: "Dateien", width: "20%", align: "right" },
                { label: "Größe", width: "20%", align: "right" },
                { label: "Anteil", width: "20%", align: "right" },
              ]}
              rows={categories.map((c) => [
                CATEGORY_META[c.category].plural,
                formatNumber(c.count),
                formatBytes(c.bytes),
                formatPercent(c.bytes / categoryTotal),
              ])}
            />
          </View>
        </View>

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

        <View style={s.section}>
          <Text style={s.h2}>Die 20 größten Dateien</Text>
          <Table
            columns={[
              { label: "Datei", width: "62%" },
              { label: "Geändert", width: "18%" },
              { label: "Größe", width: "20%", align: "right" },
            ]}
            rows={top.map((f) => [`${f.name}\n${f.path}`, formatDate(f.modified), formatBytes(f.size)])}
          />
        </View>

        <Text style={[s.muted, { marginTop: 18, fontSize: 7.5 }]}>
          Kosten geschätzt mit {formatCurrency(price)} pro GB und Monat.
        </Text>

        <View style={s.footer} fixed>
          <Text>SharePoint Storage Optimizer · {scan.site.name}</Text>
          <Text render={({ pageNumber, totalPages }) => `Seite ${pageNumber} von ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
