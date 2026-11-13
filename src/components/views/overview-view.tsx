"use client";

import { useMemo, type ReactNode } from "react";
import {
  ArrowRightIcon,
  CircleCheckIcon,
  DatabaseIcon,
  ExternalLinkIcon,
  FilesIcon,
  HistoryIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  Trash2Icon,
  ZapIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "../page-header";
import { RecycleBinButton } from "../recycle-bin-button";
import { INSIGHT_ICONS } from "../insight-icons";
import { AgeChart, FolderBars, StorageSplit, TrendChart } from "../overview/charts";
import { useInsights } from "@/hooks/use-insights";
import { ageStats, categoryStats, folderStats } from "@/lib/analysis";
import { CATEGORY_META } from "@/lib/file-types";
import { describeForecast, forecast, pricePerGb, yearlyCost } from "@/lib/costs";
import { formatBytes, formatCurrency, formatDate, formatNumber, formatPercent } from "@/lib/format";
import { useSettings } from "@/lib/settings";
import { restorableFiles, totalFreed } from "@/lib/history";
import { trendDelta } from "@/lib/trend";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

function Stat({
  label,
  icon: Icon,
  value,
  sub,
  children,
  className,
  tour,
}: {
  tour?: string;
  label: string;
  icon: typeof DatabaseIcon;
  value: string;
  sub?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col rounded-xl border bg-card p-5", className)} data-tour={tour}>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="size-4" />
        {label}
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
      {children && <div className="mt-auto pt-4">{children}</div>}
    </div>
  );
}

export function OverviewView() {
  const scan = useApp((s) => s.scan)!;
  const setView = useApp((s) => s.setView);
  const { insights, potential } = useInsights();
  const trend = useApp((s) => s.trend);
  const history = useApp((s) => s.history);
  const freedTotal = totalFreed(history);
  const restorable = history.reduce((s, e) => s + restorableFiles(e).reduce((b, f) => b + f.size, 0), 0);
  const delta = trendDelta(trend);
  const price = pricePerGb(useSettings((s) => s.settings));
  const prediction = useMemo(() => forecast(trend), [trend]);
  const quota = scan.quota;

  const categories = useMemo(() => categoryStats(scan.files), [scan.files]);
  const folders = useMemo(() => folderStats(scan.files, 3, 7), [scan.files]);
  const ages = useMemo(() => ageStats(scan.files), [scan.files]);
  const topFiles = useMemo(() => scan.files.toSorted((a, b) => b.size - a.size).slice(0, 7), [scan.files]);
  const scannedBytes = useMemo(() => scan.files.reduce((s, f) => s + f.size, 0), [scan.files]);

  const versionInsight = insights.find((i) => i.id === "versions");
  const usage = quota && quota.total > 0 ? quota.used / quota.total : 0;
  const usageColor = usage > 0.9 ? "var(--destructive)" : usage > 0.75 ? "var(--warning)" : "var(--foreground)";
  const quickWins = insights
    .filter((i) => i.savings > 0)
    .toSorted((a, b) => b.savings - a.savings)
    .slice(0, quota?.deleted ? 3 : 4);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Übersicht"
        description={`${formatNumber(scan.files.length)} Dateien in ${scan.drives.length} ${scan.drives.length === 1 ? "Bibliothek" : "Bibliotheken"} analysiert.`}
        actions={
          <Button onClick={() => setView("optimize")}>
            <ZapIcon /> Speicher freigeben
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Belegter Speicher"
          icon={DatabaseIcon}
          value={quota ? formatBytes(quota.used) : formatBytes(scannedBytes)}
          sub={quota ? `von ${formatBytes(quota.total)} · ${formatBytes(quota.remaining)} frei` : "Kontingent nicht verfügbar"}
        >
          {quota && (
            <div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, usage * 100)}%`, background: usageColor }} />
              </div>
              <div className="mt-2 text-xs text-muted-foreground tabular">
                {formatPercent(usage)} belegt{usage > 0.9 ? " · kritisch" : usage > 0.75 ? " · wird knapp" : ""}
              </div>
            </div>
          )}
        </Stat>

        <Stat
          label="Einsparpotenzial"
          tour="potential"
          icon={ZapIcon}
          value={formatBytes(potential.bytes)}
          sub={
            <>
              ≈ <span className="font-medium text-foreground">{formatCurrency(yearlyCost(potential.bytes, price))}</span> pro Jahr ·{" "}
              {formatNumber(potential.files)} Dateien{potential.recycleBin ? " + Papierkorb" : ""} · davon{" "}
              <span className="font-medium text-foreground">{formatBytes(potential.safeBytes)}</span> risikoarm (Duplikate,
              Temp-Dateien, Versionen, Papierkorb)
            </>
          }
        >
          <Button variant="outline" size="sm" onClick={() => setView("optimize")}>
            Optimierungen ansehen <ArrowRightIcon />
          </Button>
        </Stat>

        <Stat
          label="Dateien"
          icon={FilesIcon}
          value={formatNumber(scan.files.length)}
          sub={`${formatBytes(scannedBytes)} aktuelle Versionen`}
        >
          <Button variant="outline" size="sm" onClick={() => setView("files")}>
            Alle Dateien <ArrowRightIcon />
          </Button>
        </Stat>

        <Stat
          label="Alte Versionen"
          icon={HistoryIcon}
          value={versionInsight && scan.versionsScannedAt ? formatBytes(versionInsight.savings) : "–"}
          sub={
            scan.versionsScannedAt
              ? `in ${formatNumber(versionInsight?.rows.length ?? 0)} Dateien`
              : "Versionsverlauf noch nicht analysiert"
          }
        >
          <Button variant="outline" size="sm" onClick={() => setView("optimize", { insight: "versions" })}>
            {scan.versionsScannedAt ? "Bereinigen" : "Analysieren"} <ArrowRightIcon />
          </Button>
        </Stat>
      </div>

      {quickWins.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium">Größtes Potenzial</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {quickWins.map((i) => {
              const Icon = INSIGHT_ICONS[i.id];
              return (
                <button
                  key={i.id}
                  onClick={() => setView("optimize", { insight: i.id })}
                  className="group flex flex-col rounded-xl border bg-card p-5 text-left transition-colors hover:border-foreground/20 hover:bg-muted/30"
                >
                  <div className="flex items-center justify-between">
                    <Icon className="size-4 text-muted-foreground" />
                    <ArrowRightIcon className="size-4 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
                  </div>
                  <div className="mt-4 text-2xl font-semibold tracking-tight">{formatBytes(i.savings)}</div>
                  <div className="mt-1 text-sm font-medium">{i.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatNumber(i.rows.length)} {i.rows.length === 1 ? "Datei" : "Dateien"}
                  </div>
                </button>
              );
            })}
            {!!quota?.deleted && (
              <div className="flex flex-col rounded-xl border bg-card p-5">
                <Trash2Icon className="size-4 text-muted-foreground" />
                <div className="mt-4 text-2xl font-semibold tracking-tight">{formatBytes(quota.deleted)}</div>
                <div className="mt-1 text-sm font-medium">Papierkorb</div>
                <div className="text-xs text-muted-foreground">Sofort wirksam</div>
                <div className="mt-3">
                  <RecycleBinButton />
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Speicher nach Dateityp</CardTitle>
            <CardDescription>Klicke auf einen Typ, um die Dateien zu sehen.</CardDescription>
          </CardHeader>
          <CardContent>
            <StorageSplit stats={categories} onSelect={(category) => setView("files", { category })} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Größte Ordner</CardTitle>
            <CardDescription>Nach belegtem Speicher</CardDescription>
          </CardHeader>
          <CardContent>
            <FolderBars folders={folders} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Speicherverlauf</CardTitle>
            <CardDescription>
              {trend.length > 1 ? (
                <span className="inline-flex items-center gap-1.5">
                  {delta > 0 ? <TrendingUpIcon className="size-3.5" /> : <TrendingDownIcon className="size-3.5" />}
                  {delta > 0 ? "+" : "−"}
                  {formatBytes(Math.abs(delta))} seit {formatDate(trend[0].at)}
                </span>
              ) : (
                "Belegter Speicher über die Zeit"
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {trend.length > 1 ? (
              <>
                <TrendChart data={trend} />
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 text-xs text-muted-foreground" data-testid="forecast">
                  {"growthPerMonth" in prediction && (
                    <span className="tabular">
                      Wachstum {prediction.growthPerMonth >= 0 ? "+" : "−"}
                      {formatBytes(Math.abs(prediction.growthPerMonth))}/Monat
                    </span>
                  )}
                  <span className={prediction.status === "growing" && prediction.monthsLeft < 6 ? "font-medium text-warning" : undefined}>
                    {describeForecast(prediction)}
                  </span>
                </div>
              </>
            ) : (
              <div className="grid h-60 place-items-center rounded-lg border border-dashed text-center text-sm text-muted-foreground">
                <p className="max-w-xs text-pretty">Der Verlauf entsteht mit jedem Scan – in der Desktop-App auch automatisch im Hintergrund.</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Aufgeräumt</CardTitle>
            <CardDescription>Alle Maßnahmen in dieser Site</CardDescription>
            <CardAction>
              <Button variant="ghost" size="sm" onClick={() => setView("history")}>
                Verlauf <ArrowRightIcon />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div>
              <div className="flex items-center gap-2 text-3xl font-semibold tracking-tight">
                {formatBytes(freedTotal)}
                {freedTotal > 0 && <CircleCheckIcon className="size-5 text-success" />}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                freigegeben durch {formatNumber(history.length)} {history.length === 1 ? "Maßnahme" : "Maßnahmen"}
                {freedTotal > 0 && <> · ≈ {formatCurrency(yearlyCost(freedTotal, price))} pro Jahr gespart</>}
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-4 border-t pt-4 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Wiederherstellbar</dt>
                <dd className="mt-1 font-medium tabular">{formatBytes(restorable)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Noch möglich</dt>
                <dd className="mt-1 font-medium tabular">
                  {formatBytes(potential.bytes)}{" "}
                  <span className="font-normal text-muted-foreground">≈ {formatCurrency(yearlyCost(potential.bytes, price))}/Jahr</span>
                </dd>
              </div>
            </dl>
            <Button variant="outline" size="sm" className="self-start" onClick={() => setView("rules")}>
              Regeln anwenden <ArrowRightIcon />
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Alter der Daten</CardTitle>
            <CardDescription>Volumen nach Jahr der letzten Änderung</CardDescription>
          </CardHeader>
          <CardContent>
            <AgeChart data={ages} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Größte Dateien</CardTitle>
            <CardDescription>Die Top {topFiles.length}</CardDescription>
            <CardAction>
              <Button variant="ghost" size="sm" onClick={() => setView("files")}>
                Alle <ArrowRightIcon />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <ul className="-my-1 divide-y">
              {topFiles.map((f) => {
                const meta = CATEGORY_META[f.category];
                const Icon = meta.icon;
                return (
                  <li key={f.id} className="group flex items-center gap-3 py-2">
                    <Icon className="size-4 shrink-0" style={{ color: meta.color }} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium" title={f.name}>
                        {f.name}
                      </div>
                      <div className="truncate text-xs text-muted-foreground" title={f.path}>
                        {f.path}
                      </div>
                    </div>
                    <span className="text-sm font-medium tabular">{formatBytes(f.size)}</span>
                    <a
                      href={f.webUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="In SharePoint öffnen"
                      className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
                    >
                      <ExternalLinkIcon className="size-4" />
                    </a>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
