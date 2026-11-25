import type { ReactElement } from "react";
import { Font, Rect, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import { categoryStats } from "../analysis";
import { CATEGORY_META } from "../file-types";
import { formatBytes, formatDate, formatNumber, formatPercent } from "../format";
import type { SpFile } from "../types";

/** Building blocks shared by the site and the folder report. */

// German words must not be hyphenated in odd places
Font.registerHyphenationCallback((word) => [word]);

/** Same validated palette as the charts in the app (light theme). */
export const CHART_HEX: Record<string, string> = {
  "var(--chart-1)": "#2a78d6",
  "var(--chart-2)": "#eb6834",
  "var(--chart-3)": "#1baf7a",
  "var(--chart-4)": "#eda100",
  "var(--chart-5)": "#e87ba4",
  "var(--chart-6)": "#008300",
};

export const INK = "#171717";
export const MUTED = "#737373";
export const LINE = "#e5e5e5";
export const CONTENT_WIDTH = 515;

export const s = StyleSheet.create({
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

export function Table({ columns, rows }: { columns: { label: string; width: string; align?: "right" }[]; rows: string[][] }) {
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

export function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <View style={s.kpi}>
      <Text style={s.kpiLabel}>{label}</Text>
      <Text style={s.kpiValue}>{value}</Text>
      <Text style={s.kpiSub}>{sub}</Text>
    </View>
  );
}

/** Stacked bar plus table of the file types. */
export function CategorySection({ files }: { files: SpFile[] }) {
  const categories = categoryStats(files).filter((c) => c.count > 0);
  const total = categories.reduce((sum, c) => sum + c.bytes, 0) || 1;
  return (
    <View style={s.section}>
      <Text style={s.h2}>Speicher nach Dateityp</Text>
      <Svg width={CONTENT_WIDTH} height={10}>
        {
          categories.reduce<{ x: number; nodes: ReactElement[] }>(
            (acc, c) => {
              const w = (c.bytes / total) * CONTENT_WIDTH;
              acc.nodes.push(
                <Rect key={c.category} x={acc.x} y={0} width={Math.max(0, w - 1.5)} height={10} fill={CHART_HEX[CATEGORY_META[c.category].color]} />,
              );
              acc.x += w;
              return acc;
            },
            { x: 0, nodes: [] },
          ).nodes
        }
      </Svg>
      <View style={{ marginTop: 8 }}>
        <Table
          columns={[
            { label: "Typ", width: "40%" },
            { label: "Dateien", width: "20%", align: "right" },
            { label: "Größe", width: "20%", align: "right" },
            { label: "Anteil", width: "20%", align: "right" },
          ]}
          rows={categories.map((c) => [CATEGORY_META[c.category].plural, formatNumber(c.count), formatBytes(c.bytes), formatPercent(c.bytes / total)])}
        />
      </View>
    </View>
  );
}

export function LargestFilesSection({ files, count = 20, relativeTo }: { files: SpFile[]; count?: number; relativeTo?: string }) {
  const top = files.toSorted((a, b) => b.size - a.size).slice(0, count);
  // inside a folder report the folder itself is clear from the title
  const where = (path: string) => (relativeTo && path.startsWith(relativeTo) ? path.slice(relativeTo.length).replace(/^\//, "") || "–" : path);
  return (
    <View style={s.section}>
      <Text style={s.h2}>{top.length < count ? "Die größten Dateien" : `Die ${count} größten Dateien`}</Text>
      <Table
        columns={[
          { label: "Datei", width: "62%" },
          { label: "Geändert", width: "18%" },
          { label: "Größe", width: "20%", align: "right" },
        ]}
        rows={top.map((f) => [`${f.name}\n${where(f.path)}`, formatDate(f.modified), formatBytes(f.size)])}
      />
    </View>
  );
}

export function Footer({ label }: { label: string }) {
  return (
    <View style={s.footer} fixed>
      <Text>SharePoint Storage Optimizer · {label}</Text>
      <Text render={({ pageNumber, totalPages }) => `Seite ${pageNumber} von ${totalPages}`} />
    </View>
  );
}
