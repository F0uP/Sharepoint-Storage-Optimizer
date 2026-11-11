"use client";

import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AgeStat, CategoryStat, FolderStat } from "@/lib/analysis";
import { CATEGORY_META } from "@/lib/file-types";
import { formatBytes, formatNumber, formatPercent } from "@/lib/format";
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

export function FolderBars({ folders }: { folders: FolderStat[] }) {
  const max = folders[0]?.bytes || 1;
  return (
    <ul className="space-y-3.5">
      {folders.map((f) => {
        const parts = f.path.split("/");
        return (
          <li key={f.path}>
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
