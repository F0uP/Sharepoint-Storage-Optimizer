"use client";

import { RefreshCwIcon, SearchIcon } from "lucide-react";
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
import { ReportButton } from "./report-button";
import { WorkspaceTour } from "./onboarding/workspace-tour";
import { openSite } from "@/lib/actions";
import { formatDate, formatRelative } from "@/lib/format";
import { useApp, type View } from "@/lib/store";

const TITLES: Record<View, string> = {
  overview: "Übersicht",
  files: "Dateien",
  optimize: "Optimierungen",
  ai: "KI-Analyse",
  rules: "Regeln",
  history: "Verlauf",
};

export function Workspace() {
  const view = useApp((s) => s.view);
  const scan = useApp((s) => s.scan)!;
  const mode = useApp((s) => s.mode);
  const preset = useApp((s) => s.preset);

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
            <span className="truncate font-medium">{TITLES[view]}</span>
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
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="mr-1 hidden text-xs text-muted-foreground md:block">Gescannt {formatRelative(scan.scannedAt)}</span>
              </TooltipTrigger>
              <TooltipContent>{formatDate(scan.scannedAt)}</TooltipContent>
            </Tooltip>
            <ReportButton />
            <Button variant="outline" size="sm" onClick={() => openSite(scan.site, true)}>
              <RefreshCwIcon /> Neu scannen
            </Button>
            <ThemeToggle />
          </div>
        </header>

        <div className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:py-8">
          {view === "overview" && <OverviewView />}
          {view === "files" && <FilesView key={JSON.stringify(preset)} />}
          {view === "optimize" && <OptimizeView key={JSON.stringify(preset)} />}
          {view === "ai" && <AiView />}
          {view === "rules" && <RulesView />}
          {view === "history" && <HistoryView />}
        </div>
      </SidebarInset>
      <WorkspaceTour />
    </SidebarProvider>
  );
}
