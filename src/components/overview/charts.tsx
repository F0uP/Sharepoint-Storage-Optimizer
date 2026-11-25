"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AgeStat, CategoryStat, FolderStat } from "@/lib/analysis";
import { CATEGORY_META } from "@/lib/file-types";
import { formatBytes, formatDate, formatNumber, formatPercent } from "@/lib/format";
import { siteLimit } from "@/lib/quota";
import type { Snapshot } from "@/lib/trend";
import type { FileCategory } from "@/lib/types";

/* ---------------------------------------------------------- storage by type */

export function StorageSplit({ stats, onSelect }: { stats: CategoryStat[]; onSelect(category: FileCategory): void }) {
  const total = stats.reduce((s, c) => s + c.bytes, 0) || 1;
  const visible = stats.filter((s) => s.count > 0);

  return (
    <div>
      <div className="flex h-3 w-full gap-0.5" role="img" aria-label="Speicher nach Dateityp">
        {visible.map((s) => (
          <Tooltip key={s.category}>
            <TooltipTrigger asChild>
              <div
                className="h-full min-w-0.5 transition-opacity first:rounded-l-full last:rounded-r-full hover:opacity-80"
                style={{ width: `${(s.bytes / total) * 100}%`, background: CATEGORY_META[s.category].color }}
              />
            </TooltipTrigger>
            <TooltipContent>
              {CATEGORY_META[s.category].plural}: {formatBytes(s.bytes)} · {formatPercent(s.bytes / total)}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>

      <div className="mt-5 divide-y">
        {visible.map((s) => {
          const meta = CATEGORY_META[s.category];
          const Icon = meta.icon;
          return (
            <button
              key={s.category}
              onClick={() => onSelect(s.category)}
              className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-md px-2 py-2.5 text-left text-sm transition-colors hover:bg-muted/50"
            >
              <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: meta.color }} />
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 font-medium">{meta.plural}</span>
              <span className="hidden text-xs text-muted-foreground tabular sm:block">{formatNumber(s.count)} Dateien</span>
              <span className="w-20 text-right font-medium tabular">{formatBytes(s.bytes)}</span>
              <span className="w-12 text-right text-xs text-muted-foreground tabular">{formatPercent(s.bytes / total)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ largest folders */

export function FolderBars({ folders, onSelect }: { folders: FolderStat[]; onSelect?(path: string): void }) {
  const max = folders[0]?.bytes || 1;
  return (
    <ul className="-mx-2 space-y-1">
      {folders.map((f) => {
        const parts = f.path.split("/");
        const content = (
          <>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate" title={f.path}>
                <span className="text-muted-foreground">{parts.slice(0, -1).join(" / ")}</span>
                {parts.length > 1 && <span className="text-muted-foreground"> / </span>}
                <span className="font-medium">{parts.at(-1)}</span>
              </span>
              <span className="shrink-0 font-medium tabular">{formatBytes(f.bytes)}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-chart-1" style={{ width: `${(f.bytes / max) * 100}%` }} />
            </div>
          </>
        );
        return (
          <li key={f.path}>
            {onSelect ? (
              <button
                onClick={() => onSelect(f.path)}
                className="block w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                aria-label={`Ordner ${parts.at(-1)} öffnen, ${formatBytes(f.bytes)}`}
              >
                {content}
              </button>
            ) : (
              <div className="px-2 py-1.5">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ----------------------------------------------------------------- data age */

const ageConfig = {
  bytes: { label: "Volumen" },
} satisfies ChartConfig;

export function AgeChart({ data }: { data: AgeStat[] }) {
  // a whole calendar year counts as "older than 2 years" only if it ended more than 2 years ago
  const cutoff = new Date().getFullYear() - 3;
  return (
    <div>
      <ChartContainer config={ageConfig} className="aspect-auto h-60 w-full">
        <BarChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} barCategoryGap={4}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="year" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={60}
            tickFormatter={(v: number) => formatBytes(v, 0)}
            className="tabular"
          />
          <ChartTooltip
            cursor={{ fill: "var(--muted)", opacity: 0.6 }}
            content={({ active, payload }) => {
              const d = active ? (payload?.[0]?.payload as AgeStat | undefined) : undefined;
              if (!d) return null;
              return (
                <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
                  <div className="font-medium">Zuletzt geändert {d.year}</div>
                  <div className="mt-1 text-muted-foreground tabular">
                    {formatBytes(d.bytes)} · {formatNumber(d.count)} Dateien
                  </div>
                </div>
              );
            }}
          />
          <Bar dataKey="bytes" radius={[4, 4, 0, 0]} maxBarSize={44}>
            {data.map((d) => (
              <Cell
                key={d.year}
                fill={Number(d.year) <= cutoff ? "var(--chart-1)" : "var(--muted-foreground)"}
                fillOpacity={Number(d.year) <= cutoff ? 1 : 0.3}
              />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
      <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-chart-1" /> Älter als 2 Jahre
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-muted-foreground/30" /> Jünger
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ storage trend */

const trendConfig = {
  used: { label: "Belegt", color: "var(--chart-1)" },
} satisfies ChartConfig;

const monthFormat = new Intl.DateTimeFormat("de-DE", { month: "short", year: "2-digit" });

interface TrendRow {
  t: number;
  used: number;
  total: number;
  deleted: number;
}

export function TrendChart({ data }: { data: Snapshot[] }) {
  const rows: TrendRow[] = data.map((d) => ({ t: Date.parse(d.at), used: d.used, total: d.total, deleted: d.deleted }));
  // the 25 TB maximum of sites without a limit of their own would only flatten the curve
  const total = siteLimit(rows.at(-1)) ?? 0;
  return (
    <ChartContainer config={trendConfig} className="aspect-auto h-60 w-full">
      <AreaChart data={rows} margin={{ top: 12, right: 8, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={["dataMin", "dataMax"]}
          tickFormatter={(t: number) => monthFormat.format(t)}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={40}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={60}
          domain={[0, (max: number) => Math.max(max, total) * 1.05]}
          tickFormatter={(v: number) => formatBytes(v, 0)}
          className="tabular"
        />
        {total > 0 && (
          <ReferenceLine
            y={total}
            stroke="var(--muted-foreground)"
            strokeDasharray="4 4"
            strokeOpacity={0.6}
            label={{ value: "Kontingent", position: "insideTopRight", fill: "var(--muted-foreground)", fontSize: 11 }}
          />
        )}
        <ChartTooltip
          cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1, strokeOpacity: 0.5 }}
          content={({ active, payload }) => {
            const d = active ? (payload?.[0]?.payload as TrendRow | undefined) : undefined;
            if (!d) return null;
            const limit = siteLimit(d);
            return (
              <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
                <div className="font-medium">{formatDate(new Date(d.t).toISOString())}</div>
                <div className="mt-1 flex items-center gap-1.5 tabular">
                  <span className="size-2 rounded-[2px] bg-chart-1" />
                  {formatBytes(d.used)} belegt{limit ? ` · ${formatPercent(d.used / limit)}` : ""}
                </div>
                {d.deleted > 0 && <div className="mt-0.5 text-muted-foreground tabular">davon {formatBytes(d.deleted)} im Papierkorb</div>}
              </div>
            );
          }}
        />
        <Area
          type="monotone"
          dataKey="used"
          stroke="var(--chart-1)"
          strokeWidth={2}
          fill="url(#trend-fill)"
          activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--background)" }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}
