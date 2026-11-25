"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { ArrowUpIcon, FileDownIcon, FolderIcon, FolderOpenIcon, LibraryIcon, ListIcon, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useFolderReport } from "./report-button";
import { ancestors, folderTree, searchFolders, type FolderNode, type FolderTree } from "@/lib/folders";
import { formatBytes, formatNumber, formatPercent, formatRelative } from "@/lib/format";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

const PAGE = 50;

interface Props {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** folder to open first (e.g. clicked in the overview); null = the libraries */
  start?: string | null;
}

/** All folders of the site, drill-down by size – with a report for each folder. */
export function FolderExplorer({ open, onOpenChange, start }: Props) {
  const files = useApp((s) => s.scan?.files);
  // built when the panel opens – not on every change of the overview
  const tree = useMemo(() => (open && files ? folderTree(files) : null), [open, files]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        {tree && <ExplorerBody tree={tree} start={start ?? null} onClose={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  );
}

function ExplorerBody({ tree, start, onClose }: { tree: FolderTree; start: string | null; onClose(): void }) {
  const siteName = useApp((s) => s.scan?.site.name ?? "Site");
  const setView = useApp((s) => s.setView);
  const [path, setPath] = useState<string | null>(start && tree.byPath.has(start) ? start : null);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const deferredQuery = useDeferredValue(query);
  const report = useFolderReport();

  // after a background update the folder may be gone – then the libraries are shown
  const current = path ? tree.byPath.get(path) : undefined;
  const siteBytes = useMemo(() => tree.roots.reduce((s, r) => s + r.bytes, 0), [tree]);
  const searching = deferredQuery.trim().length > 0;
  const items = useMemo(
    () => (searching ? searchFolders(tree, deferredQuery) : (current?.children ?? tree.roots)),
    [searching, tree, deferredQuery, current],
  );
  const base = searching ? siteBytes : (current?.bytes ?? siteBytes);
  const trail = current ? ancestors(tree, current.path) : [];

  function go(next: string | null) {
    setPath(next);
    setQuery("");
    setLimit(PAGE);
  }

  function showFiles(node: FolderNode) {
    setView("files", { folder: node.path });
    onClose();
  }

  return (
    <>
      <SheetHeader className="border-b p-4 pr-12">
        <SheetTitle>Ordner</SheetTitle>
        <SheetDescription>
          {formatNumber(tree.byPath.size)} Ordner in {siteName} – nach Größe, Unterordner eingerechnet.
        </SheetDescription>
        <div className="relative mt-3">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE);
            }}
            placeholder="Ordner in allen Ebenen suchen …"
            className="pl-8"
            aria-label="Ordner suchen"
          />
        </div>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto overscroll-contain">
        {searching ? (
          <p className="px-4 pt-4 text-xs text-muted-foreground" role="status">
            {items.length ? `${formatNumber(items.length)}${items.length >= 200 ? "+" : ""} Ordner gefunden` : "Kein Ordner gefunden"}
          </p>
        ) : (
          <nav aria-label="Ordnerpfad" className="flex items-start gap-2 px-4 pt-4">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => go(current?.parent ?? null)}
              disabled={!current}
              aria-label="Eine Ebene höher"
              className="shrink-0"
            >
              <ArrowUpIcon />
            </Button>
            <ol className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 pt-1 text-sm">
              <li>
                <button
                  onClick={() => go(null)}
                  className={cn("rounded px-1 hover:bg-muted", !current ? "font-medium" : "text-muted-foreground")}
                  aria-current={!current ? "page" : undefined}
                >
                  Alle Bibliotheken
                </button>
              </li>
              {trail.map((n, i) => (
                <li key={n.path} className="flex min-w-0 items-center gap-1">
                  <span aria-hidden className="text-muted-foreground/60">
                    /
                  </span>
                  <button
                    onClick={() => go(n.path)}
                    className={cn("max-w-48 truncate rounded px-1 hover:bg-muted", i === trail.length - 1 ? "font-medium" : "text-muted-foreground")}
                    aria-current={i === trail.length - 1 ? "page" : undefined}
                    title={n.name}
                  >
                    {n.name}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        )}

        {current && !searching && (
          <section className="mx-4 mt-3 rounded-xl border bg-card p-4" aria-label="Ausgewählter Ordner">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-2xl font-semibold tracking-tight tabular">{formatBytes(current.bytes)}</div>
                <div className="mt-0.5 text-xs text-muted-foreground tabular">
                  {formatPercent(current.bytes / Math.max(1, siteBytes))} der Site · {formatNumber(current.count)} Dateien
                  {current.newest && ` · zuletzt geändert ${formatRelative(current.newest)}`}
                </div>
                {current.ownCount > 0 && current.children.length > 0 && (
                  <div className="mt-0.5 text-xs text-muted-foreground tabular">
                    davon {formatBytes(current.ownBytes)} in {formatNumber(current.ownCount)} Dateien direkt in diesem Ordner
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void report.generate(current.path, tree)} disabled={report.busy !== null}>
                  {report.busy === current.path ? <Spinner /> : <FileDownIcon />} Ordnerbericht
                </Button>
                <Button size="sm" variant="outline" onClick={() => showFiles(current)}>
                  <ListIcon /> Dateien
                </Button>
              </div>
            </div>
          </section>
        )}

        {items.length > 0 ? (
          <ul className="px-2 py-2" aria-label={searching ? "Suchergebnisse" : current ? `Unterordner von ${current.name}` : "Bibliotheken"}>
            {items.slice(0, limit).map((node) => (
              <FolderRow
                key={node.path}
                node={node}
                base={base}
                library={!searching && !current}
                location={searching ? [siteName, ...node.path.split("/").slice(0, -1)].join(" / ") : undefined}
                busy={report.busy}
                onOpen={() => go(node.path)}
                onReport={() => void report.generate(node.path, tree)}
                onFiles={() => showFiles(node)}
              />
            ))}
          </ul>
        ) : (
          !searching &&
          current && (
            <div className="m-4 grid place-items-center rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              <FolderOpenIcon className="mb-2 size-5" />
              Keine Unterordner – alle {formatNumber(current.count)} Dateien liegen direkt in diesem Ordner.
            </div>
          )
        )}

        {items.length > limit && (
          <div className="px-4 pb-4">
            <Button variant="outline" className="w-full" onClick={() => setLimit((l) => l + PAGE)}>
              Weitere {formatNumber(Math.min(PAGE, items.length - limit))} anzeigen
              <span className="text-muted-foreground tabular">· {formatNumber(items.length - limit)} übrig</span>
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

function FolderRow({
  node,
  base,
  library,
  location,
  busy,
  onOpen,
  onReport,
  onFiles,
}: {
  node: FolderNode;
  base: number;
  library: boolean;
  location?: string;
  busy: string | null;
  onOpen(): void;
  onReport(): void;
  onFiles(): void;
}) {
  const share = node.bytes / Math.max(1, base);
  const Icon = library ? LibraryIcon : FolderIcon;
  return (
    <li className="flex items-center gap-1 rounded-lg pr-1 hover:bg-muted/50">
      <button
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-start gap-3 rounded-lg px-2 py-2.5 text-left focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        aria-label={`${node.name} öffnen, ${formatBytes(node.bytes)}`}
      >
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-sm font-medium" title={node.path}>
              {node.name}
            </span>
            <span className="shrink-0 text-sm font-medium tabular">{formatBytes(node.bytes)}</span>
          </div>
          {location && <div className="truncate text-xs text-muted-foreground">{location}</div>}
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-chart-1" style={{ width: `${Math.max(0.5, Math.min(100, share * 100))}%` }} />
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground tabular">
            <span>{formatPercent(share)}</span>
            <span>{formatNumber(node.count)} Dateien</span>
            {node.children.length > 0 && <span>{formatNumber(node.children.length)} Unterordner</span>}
            {node.newest && <span className="hidden sm:inline">geändert {formatRelative(node.newest)}</span>}
          </div>
        </div>
      </button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" onClick={onReport} disabled={busy !== null} aria-label={`Ordnerbericht für ${node.name}`}>
            {busy === node.path ? <Spinner /> : <FileDownIcon />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Ordnerbericht als PDF</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" onClick={onFiles} aria-label={`Dateien in ${node.name} anzeigen`}>
            <ListIcon />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Dateien anzeigen</TooltipContent>
      </Tooltip>
    </li>
  );
}
