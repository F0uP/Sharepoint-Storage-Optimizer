"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArchiveIcon, ArrowRightIcon, CopyIcon, ExternalLinkIcon, LayersIcon, RefreshCwIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage, openSite } from "@/lib/actions";
import { pricePerGb, yearlyCost } from "@/lib/costs";
import { formatBytes, formatCurrency, formatDate, formatNumber, formatRelative } from "@/lib/format";
import { useSettings } from "@/lib/settings";
import { getSource } from "@/lib/source";
import { useApp } from "@/lib/store";
import {
  analyzeTenant,
  cancelTenantAnalysis,
  crossSiteDuplicates,
  inactiveSites,
  loadTenant,
  markArchived,
  useTenant,
  type SiteSummary,
} from "@/lib/tenant";
import type { SiteRef } from "@/lib/types";

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight tabular">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function ArchiveDialog({ summary, onClose }: { summary: SiteSummary; onClose(): void }) {
  const mode = useApp((s) => s.mode)!;
  const [busy, setBusy] = useState(false);
  const command = `Set-SPOSiteArchiveState -Identity "${summary.site.webUrl}" -ArchiveState Archived`;

  async function archive() {
    setBusy(true);
    try {
      await getSource(mode).archiveSite(summary.site);
      markArchived(summary.site.id, mode);
      toast.success(`„${summary.site.name}“ wird archiviert`, {
        description: "Die Site ist ab jetzt nur noch für Admins sichtbar und lässt sich im SharePoint Admin Center reaktivieren.",
      });
      onClose();
    } catch (e) {
      toast.error("Archivieren nicht möglich", { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(command).catch(() => {});
    toast.success("PowerShell-Befehl kopiert");
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="text-left">
          <DialogTitle>„{summary.site.name}“ archivieren?</DialogTitle>
          <DialogDescription>
            Die Site wandert in Microsoft 365 Archive: Inhalte bleiben erhalten – auch für Aufbewahrung und eDiscovery –, sind für
            Nutzer aber nicht mehr erreichbar und belegen kein aktives Kontingent mehr. Reaktivieren geht im SharePoint Admin Center.
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Belegt</dt>
            <dd className="font-medium tabular">{formatBytes(summary.quota?.used ?? summary.bytes)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Zuletzt geändert</dt>
            <dd className="font-medium">{summary.lastActivity ? formatDate(summary.lastActivity) : "unbekannt"}</dd>
          </div>
        </dl>
        <p className="text-xs text-pretty text-muted-foreground">
          Voraussetzungen: Rolle SharePoint-Administrator, aktiviertes Microsoft 365 Archive (nutzungsbasiert abgerechnet) und die
          Berechtigung Sites.Archive.All. Microsoft bietet die Schnittstelle derzeit als Beta an – alternativ per PowerShell:
        </p>
        <button
          type="button"
          onClick={copy}
          className="group flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-left font-mono text-xs"
        >
          <span className="min-w-0 flex-1 truncate">{command}</span>
          <CopyIcon className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
        </button>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button onClick={archive} disabled={busy}>
            {busy ? <Spinner /> : <ArchiveIcon />} Archivieren
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TenantView({ sites }: { sites: SiteRef[] | null }) {
  const mode = useApp((s) => s.mode)!;
  const tenant = useTenant();
  const settings = useSettings((s) => s.settings);
  const price = pricePerGb(settings);
  const [archiving, setArchiving] = useState<SiteSummary | null>(null);

  useEffect(() => {
    if (mode === "live" && useTenant.getState().mode !== "live") void loadTenant();
  }, [mode]);

  const summaries = useMemo(() => (tenant.mode === mode ? tenant.summaries : []), [tenant.mode, tenant.summaries, mode]);
  const duplicates = useMemo(() => crossSiteDuplicates(tenant.mode === mode ? tenant.index : [], summaries), [tenant.index, tenant.mode, mode, summaries]);
  const inactive = useMemo(() => inactiveSites(summaries, Number(settings.inactiveMonths)), [summaries, settings.inactiveMonths]);
  const ranked = useMemo(() => summaries.filter((s) => !s.error).toSorted((a, b) => b.potential - a.potential), [summaries]);
  const failed = summaries.filter((s) => s.error);

  const used = summaries.reduce((s, x) => s + (x.quota?.used ?? x.bytes), 0);
  const pot = summaries.reduce((s, x) => s + x.potential, 0);
  const safe = summaries.reduce((s, x) => s + x.safe, 0);
  const dupSavings = duplicates.reduce((s, d) => s + d.savings, 0);
  const inactiveBytes = inactive.reduce((s, x) => s + (x.quota?.used ?? x.bytes), 0);
  const maxPot = Math.max(1, ranked[0]?.potential ?? 1);
  const progress = tenant.progress;
  const start = () => sites && void analyzeTenant(sites, mode);

  if (progress) {
    return (
      <div className="rounded-xl border bg-card p-6">
        <div className="flex items-center gap-3 text-sm">
          <Spinner className="size-4" />
          <span className="min-w-0 flex-1 truncate">
            Site {formatNumber(progress.done + 1)} von {formatNumber(progress.total)}: {progress.current}
          </span>
          <Button variant="outline" size="sm" onClick={cancelTenantAnalysis}>
            Abbrechen
          </Button>
        </div>
        <Progress className="mt-4" value={(progress.done / Math.max(1, progress.total)) * 100} />
      </div>
    );
  }

  if (!summaries.length) {
    return (
      <div className="rounded-xl border border-dashed px-6 py-14 text-center">
        <div className="mx-auto grid size-10 place-items-center rounded-lg bg-muted">
          <LayersIcon className="size-5" />
        </div>
        <h3 className="mt-4 font-medium">Alle Sites auf einmal analysieren</h3>
        <p className="mx-auto mt-1 max-w-md text-sm text-pretty text-muted-foreground">
          Einsparpotenzial des ganzen Tenants, Duplikate über Site-Grenzen hinweg und inaktive Sites zum Archivieren. Bei vielen
          Sites dauert das einige Minuten – die Desktop-App arbeitet auch im Hintergrund weiter.
        </p>
        <Button className="mt-6" onClick={start} disabled={!sites?.length}>
          {sites ? `Alle ${formatNumber(sites.length)} Sites analysieren` : "Sites werden geladen …"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>
          {formatNumber(summaries.length)} Sites analysiert{tenant.finishedAt ? ` · ${formatRelative(tenant.finishedAt)}` : ""}
          {failed.length ? ` · ${formatNumber(failed.length)} ohne Zugriff` : ""}
        </span>
        <Button variant="outline" size="sm" onClick={start} disabled={!sites?.length}>
          <RefreshCwIcon /> Erneut analysieren
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Belegt gesamt" value={formatBytes(used)} sub={`≈ ${formatCurrency(yearlyCost(used, price))} pro Jahr`} />
        <Kpi label="Einsparpotenzial" value={formatBytes(pot)} sub={`≈ ${formatCurrency(yearlyCost(pot, price))} pro Jahr`} />
        <Kpi label="Davon risikoarm" value={formatBytes(safe)} sub="Duplikate, Temp-Dateien, Versionen, Papierkorb" />
        <Kpi
          label="Duplikate über Sites"
          value={formatBytes(dupSavings)}
          sub={`${formatNumber(duplicates.length)} Dateien liegen mehrfach`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sites nach Einsparpotenzial</CardTitle>
          <CardDescription>Wo sich das Aufräumen am meisten lohnt</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {ranked.slice(0, 15).map((s) => (
              <li key={s.site.id} className="flex items-center gap-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate font-medium">{s.site.name}</span>
                    <span className="shrink-0 font-medium tabular">{formatBytes(s.potential)}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-chart-1" style={{ width: `${(s.potential / maxPot) * 100}%` }} />
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground tabular">
                    {formatBytes(s.quota?.used ?? s.bytes)} belegt · {formatBytes(s.safe)} risikoarm · ≈{" "}
                    {formatCurrency(yearlyCost(s.potential, price))}/Jahr
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => openSite(s.site)} aria-label={`${s.site.name} öffnen`}>
                  Öffnen <ArrowRightIcon />
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Duplikate über Sites hinweg</CardTitle>
            <CardDescription>Gleicher Inhalt in mehreren Sites – meist reicht eine Ablage mit Link</CardDescription>
          </CardHeader>
          <CardContent>
            {duplicates.length ? (
              <ul className="divide-y">
                {duplicates.slice(0, 12).map((d) => (
                  <li key={d.key} className="py-2.5">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="truncate font-medium" title={d.name}>
                        {d.name}
                      </span>
                      <span className="shrink-0 font-medium tabular">{formatBytes(d.savings)}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {d.copies.map((c) => (
                        <a key={`${c.siteId}-${c.path}`} href={c.webUrl} target="_blank" rel="noreferrer">
                          <Badge variant="outline" className="font-normal hover:bg-muted">
                            {c.siteName} <ExternalLinkIcon className="size-3" />
                          </Badge>
                        </a>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Keine Datei liegt in mehreren Sites.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Inaktive Sites</CardTitle>
            <CardDescription>
              Seit über {settings.inactiveMonths} Monaten unverändert – Kandidaten für Microsoft 365 Archive
            </CardDescription>
            {inactive.length > 0 && (
              <CardAction>
                <Badge variant="secondary">{formatBytes(inactiveBytes)}</Badge>
              </CardAction>
            )}
          </CardHeader>
          <CardContent>
            {inactive.length ? (
              <ul className="divide-y">
                {inactive.map((s) => (
                  <li key={s.site.id} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{s.site.name}</div>
                      <div className="text-xs text-muted-foreground tabular">
                        zuletzt geändert {s.lastActivity ? formatDate(s.lastActivity) : "–"} · {formatBytes(s.quota?.used ?? s.bytes)} · ≈{" "}
                        {formatCurrency(yearlyCost(s.quota?.used ?? s.bytes, price))}/Jahr
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setArchiving(s)}>
                      <ArchiveIcon /> Archivieren
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Alle Sites wurden in letzter Zeit genutzt.</p>
            )}
            {summaries.some((s) => s.archived) && (
              <p className="mt-3 text-xs text-muted-foreground">
                Archiviert: {summaries.filter((s) => s.archived).map((s) => s.site.name).join(", ")}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {archiving && <ArchiveDialog summary={archiving} onClose={() => setArchiving(null)} />}
    </div>
  );
}
