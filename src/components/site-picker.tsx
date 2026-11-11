"use client";

import { useEffect, useState } from "react";
import { ChevronRightIcon, GlobeIcon, SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Logo } from "./logo";
import { UserMenu } from "./user-menu";
import { ThemeToggle } from "./theme-toggle";
import { openSite, errorMessage } from "@/lib/actions";
import { getSource } from "@/lib/source";
import { useApp } from "@/lib/store";
import type { SiteRef } from "@/lib/types";

function siteInitials(name: string) {
  return name
    .split(/[\s&-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function SitePicker() {
  const mode = useApp((s) => s.mode)!;
  const [query, setQuery] = useState("");
  const [sites, setSites] = useState<SiteRef[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      setSites(null);
      setError(null);
      try {
        const result = await getSource(mode).searchSites(query);
        if (!cancelled) setSites(result);
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

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-12 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Site auswählen</h1>
        <p className="mt-1 text-sm text-muted-foreground">Welche SharePoint-Site soll analysiert werden?</p>

        <div className="relative mt-6">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Sites durchsuchen …"
            className="h-10 pl-9"
          />
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border bg-card">
          {sites === null &&
            Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 border-b p-4 last:border-0">
                <Skeleton className="size-9 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-48" />
                  <Skeleton className="h-3 w-72" />
                </div>
              </div>
            ))}

          {sites?.length === 0 && (
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

          {sites?.map((site) => (
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
              <ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}
