"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRightIcon, GlobeIcon, SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TenantView } from "./tenant-view";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Logo } from "./logo";
import { UserMenu } from "./user-menu";
import { ThemeToggle } from "./theme-toggle";
import { openSite, errorMessage } from "@/lib/actions";
import { formatBytes, formatNumber, formatPercent } from "@/lib/format";
import { quotaUsage, siteLimit } from "@/lib/quota";
import { getSource } from "@/lib/source";
import { useApp } from "@/lib/store";
import type { Quota, SiteRef } from "@/lib/types";

function siteInitials(name: string) {
  const words = name.split(/[\s&-]+/).filter(Boolean);
  // keep short acronyms like "IT" or "HR" instead of "II"
  if (/^[A-ZÄÖÜ]{2,3}$/.test(words[0] ?? "")) return words[0];
  return words
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

function usageColor(usage: number) {
  return usage > 0.9 ? "var(--destructive)" : usage > 0.75 ? "var(--warning)" : "var(--chart-1)";
}

type Sort = "usage" | "name";

export function SitePicker() {
  const mode = useApp((s) => s.mode)!;
  const [query, setQuery] = useState("");
  const [sites, setSites] = useState<SiteRef[] | null>(null);
  const [quotas, setQuotas] = useState<Map<string, Quota | undefined>>(new Map());
  // quotas already loaded – searching must not request them again (Graph throttling on large tenants)
  const loaded = useRef(new Map<string, Quota | undefined>());
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("usage");
  const [tab, setTab] = useState<"sites" | "tenant">("sites");

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      setSites(null);
      setError(null);
      try {
        const result = await getSource(mode).searchSites(query);
        if (cancelled) return;
        setSites(result);
        // quotas in chunks, so the list fills in progressively
        for (let i = 0; i < result.length && !cancelled; i += 40) {
          const chunk = result.slice(i, i + 40).filter((s) => !loaded.current.has(s.id));
          if (!chunk.length) continue;
          const map = await getSource(mode).siteQuotas(chunk).catch(() => new Map<string, Quota | undefined>());
          for (const [id, quota] of map) loaded.current.set(id, quota);
          if (!cancelled) setQuotas(new Map(loaded.current));
        }
      } catch (e) {
        if (!cancelled) {
          setError(errorMessage(e));
          setSites([]);
        }
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, mode]);

  const sorted = useMemo(() => {
    if (!sites) return null;
    return sites.toSorted((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name, "de")
        : (quotas.get(b.id)?.used ?? -1) - (quotas.get(a.id)?.used ?? -1) || a.name.localeCompare(b.name, "de"),
    );
  }, [sites, quotas, sort]);

  const known = (sites ?? []).map((s) => quotas.get(s.id)).filter((q): q is Quota => Boolean(q));
  const usedTotal = known.reduce((s, q) => s + q.used, 0);
  const maxUsed = Math.max(1, ...known.map((q) => q.used));

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex h-14 items-center justify-between border-b px-4 sm:px-6">
        <Logo />
        <div className="flex items-center gap-1">
          {mode === "demo" && <Badge variant="secondary">Demo</Badge>}
          <ThemeToggle />
          <UserMenu compact className="w-auto hover:bg-muted data-[state=open]:bg-muted" />
        </div>
      </header>

      <main className={`mx-auto w-full flex-1 px-4 py-12 sm:px-6 ${tab === "tenant" ? "max-w-5xl" : "max-w-3xl"}`}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{tab === "tenant" ? "Gesamtanalyse" : "Site auswählen"}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {tab === "tenant"
                ? "Alle Sites zusammen: Potenzial, Duplikate über Site-Grenzen und inaktive Sites."
                : sites?.length && known.length
                  ? `${formatNumber(sites.length)} Sites belegen zusammen ${formatBytes(usedTotal)} – die größten zuerst.`
                  : "Welche SharePoint-Site soll analysiert werden?"}
            </p>
          </div>
          <Tabs
            value={tab}
            onValueChange={(v) => {
              setTab(v as "sites" | "tenant");
              // the overall analysis always covers all sites
              if (v === "tenant") setQuery("");
            }}
          >
            <TabsList>
              <TabsTrigger value="sites">Sites</TabsTrigger>
              <TabsTrigger value="tenant">Gesamtanalyse</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {tab === "tenant" ? (
          <div className="mt-6">
            <TenantView sites={query ? null : sites} />
          </div>
        ) : (
        <>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Sites durchsuchen …"
              className="h-10 pl-9"
            />
          </div>
          <ToggleGroup type="single" variant="outline" value={sort} onValueChange={(v) => v && setSort(v as Sort)} aria-label="Sortierung">
            <ToggleGroupItem value="usage" className="h-10 px-3">
              Nach Speicher
            </ToggleGroupItem>
            <ToggleGroupItem value="name" className="h-10 px-3">
              A–Z
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border bg-card">
          {sorted === null &&
            Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 border-b p-4 last:border-0">
                <Skeleton className="size-9 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-48" />
                  <Skeleton className="h-3 w-72" />
                </div>
              </div>
            ))}

          {sorted?.length === 0 && (
            <Empty className="py-12">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <GlobeIcon />
                </EmptyMedia>
                <EmptyTitle>{error ? "Sites konnten nicht geladen werden" : "Keine Sites gefunden"}</EmptyTitle>
                <EmptyDescription>{error ?? "Versuche einen anderen Suchbegriff."}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}

          {sorted?.map((site) => {
            const quota = quotas.get(site.id);
            const loaded = quotas.has(site.id);
            const usage = quotaUsage(quota);
            return (
              <button
                key={site.id}
                onClick={() => openSite(site)}
                className="group flex w-full items-center gap-3 border-b p-4 text-left transition-colors last:border-0 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
              >
                <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-xs font-semibold text-muted-foreground">
                  {siteInitials(site.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{site.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{site.description || site.webUrl}</div>
                </div>
                <div className="hidden w-44 shrink-0 sm:block">
                  {!loaded ? (
                    <Skeleton className="h-1.5 w-full" />
                  ) : quota ? (
                    <>
                      <div className="flex items-baseline justify-between gap-2 text-xs tabular">
                        <span className="font-medium">{formatBytes(quota.used)}</span>
                        {usage !== undefined && <span className="text-muted-foreground">{formatPercent(usage)}</span>}
                      </div>
                      <div
                        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
                        title={
                          usage !== undefined
                            ? `${formatBytes(quota.used)} von ${formatBytes(quota.total)}`
                            : `${formatBytes(quota.used)} – kein eigenes Limit, gemeinsamer Speicher des Mandanten`
                        }
                      >
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${Math.max(2, (quota.used / maxUsed) * 100)}%`, background: usageColor(usage ?? 0) }}
                        />
                      </div>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">Kein Zugriff auf Kontingent</span>
                  )}
                </div>
                <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </button>
            );
          })}
        </div>
        {known.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            Balkenlänge = belegter Speicher im Vergleich der Sites, Farbe = Auslastung des Kontingents (orange ab 75 %, rot ab 90 %).
            {known.some((q) => siteLimit(q) === undefined) &&
              " Sites ohne Prozentangabe haben kein eigenes Limit und teilen sich den Speicher des Mandanten."}
          </p>
        )}
        </>
        )}
      </main>
    </div>
  );
}
