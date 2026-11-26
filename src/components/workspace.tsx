"use client";

import { useState } from "react";
import { DatabaseZapIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AppSidebar } from "./app-sidebar";
import { useCommandMenu } from "./command-menu";
import { ThemeToggle } from "./theme-toggle";
import { OverviewView } from "./views/overview-view";
import { FilesView } from "./views/files-view";
import { OptimizeView } from "./views/optimize-view";
import { AiView } from "./views/ai-view";
import { RulesView } from "./views/rules-view";
import { HistoryView } from "./views/history-view";
import { ReviewsView } from "./views/reviews-view";
import { ReportButton } from "./report-button";
import { WorkspaceTour } from "./onboarding/workspace-tour";
import { Spinner } from "@/components/ui/spinner";
import { WaitingNotice } from "./scan-screen";
import { openSite, refreshSite } from "@/lib/actions";
import { formatDate, formatNumber, formatRelative } from "@/lib/format";
import { useApp, type SyncStatus, type View } from "@/lib/store";

const TITLES: Record<View, string> = {
  overview: "Übersicht",
  files: "Dateien",
  optimize: "Optimierungen",
  ai: "KI-Analyse",
  rules: "Regeln",
  reviews: "Freigaben",
  history: "Verlauf",
};

function SyncIndicator({ syncing }: { syncing: SyncStatus }) {
  return (
    <span className="mr-1 flex items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground" role="status">
      <Spinner className="size-3" />
      {syncing.waiting ? (
        <WaitingNotice key={syncing.waiting.until} waiting={syncing.waiting} />
      ) : syncing.full ? (
        `Liest Site ein … ${formatNumber(syncing.items)} Elemente`
      ) : (
        `Gleicht Änderungen ab …${syncing.items ? ` ${formatNumber(syncing.items)}` : ""}`
      )}
    </span>
  );
}

/** Reads the whole site again from scratch – cache and saved progress are dropped. */
function RescanButton({ disabled }: { disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const site = useApp((s) => s.site);
  const files = useApp((s) => s.scan?.files.length ?? 0);
  if (!site) return null;
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={disabled} aria-label="Site komplett neu einlesen">
            <DatabaseZapIcon /> <span className="hidden xl:inline">Neu einlesen</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Liest die ganze Site neu ein – ohne Zwischenspeicher</TooltipContent>
      </Tooltip>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader className="flex flex-row items-start gap-4 text-left">
            <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
              <DatabaseZapIcon className="size-5" />
            </div>
            <div className="space-y-1.5">
              <AlertDialogTitle>Site komplett neu einlesen?</AlertDialogTitle>
              <AlertDialogDescription>
                Der Zwischenspeicher von „{site.name}“ wird verworfen und die Site mit allen Bibliotheken und Unterwebsites neu
                abgerufen{files ? ` (bisher ${formatNumber(files)} Dateien)` : ""}. Bei großen Sites dauert das eine Weile – die Übersicht
                ist währenddessen schon nutzbar und wächst mit. Verlauf und Speichertrend bleiben erhalten.
              </AlertDialogDescription>
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setOpen(false);
                void openSite(site, true);
              }}
            >
              Komplett neu einlesen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function Workspace() {
  const view = useApp((s) => s.view);
  const scan = useApp((s) => s.scan)!;
  const mode = useApp((s) => s.mode);
  const preset = useApp((s) => s.preset);
  const syncing = useApp((s) => s.syncing);

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur-md">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4" />
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <a
              href={scan.site.webUrl}
              target="_blank"
              rel="noreferrer"
              className="hidden truncate text-muted-foreground hover:text-foreground sm:block"
            >
              {scan.site.name}
            </a>
            <span className="hidden text-muted-foreground/50 sm:block">/</span>
            <span className="shrink-0 font-medium">{TITLES[view]}</span>
            {mode === "demo" && <Badge variant="secondary">Demo</Badge>}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="mr-1 hidden w-52 justify-start font-normal text-muted-foreground lg:inline-flex"
              onClick={() => useCommandMenu.getState().setOpen(true)}
              data-tour="search"
            >
              <SearchIcon /> Suchen …
              <Kbd className="ml-auto">Strg K</Kbd>
            </Button>
            {syncing ? (
              <SyncIndicator syncing={syncing} />
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="mr-1 hidden text-xs whitespace-nowrap text-muted-foreground xl:block">Stand {formatRelative(scan.scannedAt)}</span>
                </TooltipTrigger>
                <TooltipContent>{formatDate(scan.scannedAt)}</TooltipContent>
              </Tooltip>
            )}
            <ReportButton />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" onClick={() => void refreshSite()} disabled={Boolean(syncing)} aria-label="Site aktualisieren">
                  <RefreshCwIcon /> <span className="hidden xl:inline">Aktualisieren</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {mode === "live" ? "Holt nur die Änderungen seit dem letzten Scan" : "Erzeugt die Demo-Daten neu"}
              </TooltipContent>
            </Tooltip>
            {/* a running background update is simply replaced – only a running complete read blocks it */}
            {mode === "live" && <RescanButton disabled={Boolean(syncing?.full)} />}
            <ThemeToggle />
          </div>
        </header>

        {scan.partial && (
          <div className="border-b bg-muted/40 px-4 py-2 text-xs text-pretty text-muted-foreground sm:px-6" role="status">
            {syncing
              ? "Die Site wird noch im Hintergrund eingelesen – die Zahlen sind vorläufig und wachsen mit. Du kannst schon loslegen."
              : "Das Einlesen wurde unterbrochen – die Zahlen sind unvollständig. „Aktualisieren“ setzt es fort."}
          </div>
        )}
        <div className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:py-8">
          {view === "overview" && <OverviewView />}
          {view === "files" && <FilesView key={JSON.stringify(preset)} />}
          {view === "optimize" && <OptimizeView key={JSON.stringify(preset)} />}
          {view === "ai" && <AiView />}
          {view === "rules" && <RulesView />}
          {view === "reviews" && <ReviewsView />}
          {view === "history" && <HistoryView />}
        </div>
      </SidebarInset>
      <WorkspaceTour />
    </SidebarProvider>
  );
}
