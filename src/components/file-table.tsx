"use client";

import { lazy, Suspense, useMemo, useState, type ReactNode } from "react";
import type * as React from "react";
import {
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  sortFn_text,
  tableFeatures,
  useTable,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
} from "@tanstack/react-table";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  ChevronsUpDownIcon,
  DownloadIcon,
  EllipsisIcon,
  EyeOffIcon,
  ExternalLinkIcon,
  FolderDownIcon,
  HistoryIcon,
  MailIcon,
  Minimize2Icon,
  SearchXIcon,
  SparklesIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BulkActionDialog } from "./bulk-action-dialog";
import { desktopBridge } from "@/lib/desktop";
import { downloadCsv, toCsv } from "@/lib/csv";
import { CATEGORY_META, isCompressible } from "@/lib/file-types";
import { formatBytes, formatDate, formatNumber, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AiAction, SpFile } from "@/lib/types";

export const AI_ACTION_LABEL: Record<AiAction, string> = {
  delete: "Löschen",
  archive: "Archivieren",
  compress: "Komprimieren",
  review: "Prüfen",
  clean_versions: "Versionen bereinigen",
};

// loaded when opened – keeps the table (used in every view) light
const BackupDialog = lazy(() => import("./dialogs/backup-dialog").then((m) => ({ default: m.BackupDialog })));
const CompressDialog = lazy(() => import("./dialogs/compress-dialog").then((m) => ({ default: m.CompressDialog })));
const NotifyOwnersDialog = lazy(() => import("./dialogs/notify-owners-dialog").then((m) => ({ default: m.NotifyOwnersDialog })));

export interface FileRow {
  id: string;
  file: SpFile;
  /** bytes freed by the action – file size or size of old versions */
  bytes: number;
  note?: string;
  /** optional extra cell (e.g. AI recommendation) */
  tag?: ReactNode;
  /** sort key for the extra column */
  rank?: number;
  /** AI recommendation for this file, shown as a marker next to the name */
  ai?: { action: AiAction; reason: string };
}

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { text: sortFn_text },
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
  rowSelectionFeature,
});

const helper = createColumnHelper<typeof features, FileRow>();

type SelectableRow = {
  getIsSelected(): boolean;
  getToggleSelectedHandler(): (event: unknown) => void;
};

/**
 * Table v9 reads `event.target.checked` (native inputs) to decide the new value – also for Shift ranges.
 * Radix checkboxes and row clicks have no `checked`, so the intended value is passed explicitly.
 */
function toggleRow(row: SelectableRow, e: React.MouseEvent) {
  row.getToggleSelectedHandler()({ shiftKey: e.shiftKey, target: { checked: !row.getIsSelected() } });
}

type SortableColumn = {
  getIsSorted(): false | "asc" | "desc";
  getToggleSortingHandler(): ((event: unknown) => void) | undefined;
};

function SortHeader({ column, label, align = "start" }: { column: SortableColumn; label: string; align?: "start" | "end" }) {
  const sorted = column.getIsSorted();
  const Icon = sorted === "asc" ? ArrowUpIcon : sorted === "desc" ? ArrowDownIcon : ChevronsUpDownIcon;
  return (
    <button
      type="button"
      onClick={column.getToggleSortingHandler()}
      className={cn(
        "-mx-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
        sorted && "text-foreground",
        align === "end" && "flex-row-reverse",
      )}
    >
      {label}
      <Icon className={cn("size-3.5", !sorted && "opacity-40")} />
    </button>
  );
}

function NameCell({ row }: { row: FileRow }) {
  const meta = CATEGORY_META[row.file.category];
  const Icon = meta.icon;
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="grid size-8 shrink-0 place-items-center rounded-md bg-muted/70" title={meta.label}>
        <Icon className="size-4" style={{ color: meta.color }} />
      </div>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium" title={row.file.name}>
            {row.file.name}
          </span>
          {row.ai && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                  <SparklesIcon className="size-3" />
                  {AI_ACTION_LABEL[row.ai.action]}
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">KI: {row.ai.reason}</TooltipContent>
            </Tooltip>
          )}
        </div>
        <div className="truncate text-xs text-muted-foreground" title={`${row.file.path}/${row.file.name}`}>
          {row.file.path}
          {row.note && <span className="text-foreground/70"> · {row.note}</span>}
        </div>
      </div>
    </div>
  );
}

interface FileTableProps {
  rows: FileRow[];
  action: "delete" | "versions";
  sizeLabel?: string;
  tagHeader?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  defaultPageSize?: number;
  /** one-click selections shown in the toolbar, e.g. "high priority" */
  quickSelect?: { label: string; ids: string[] }[];
  /** adds an "ignore" action to the selection bar */
  onDismiss?: (ids: string[]) => void;
  /** file name (without extension) for the CSV export */
  exportName?: string;
}

const PAGE_SIZES = [25, 50, 100, 200];

export function FileTable({
  rows,
  action,
  sizeLabel = "Größe",
  tagHeader,
  emptyTitle = "Keine Dateien",
  emptyDescription = "Für diese Auswahl gibt es keine Treffer.",
  defaultPageSize = 50,
  quickSelect,
  onDismiss,
  exportName = "dateien",
}: FileTableProps) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "bytes", desc: true }]);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: defaultPageSize });
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [extraDialog, setExtraDialog] = useState<"notify" | "backup" | "compress" | null>(null);
  const isDesktop = Boolean(desktopBridge());

  const columns = useMemo(() => {
    const select = helper.display({
      id: "select",
      header: ({ table }) => (
        <Checkbox
          aria-label="Alle auf dieser Seite auswählen"
          checked={table.getIsAllPageRowsSelected() ? true : table.getIsSomePageRowsSelected() ? "indeterminate" : false}
          onCheckedChange={(v) => table.toggleAllPageRowsSelected(v === true)}
        />
      ),
      cell: ({ row }) => (
        <Checkbox aria-label="Zeile auswählen" checked={row.getIsSelected()} onClick={(e) => toggleRow(row, e)} />
      ),
    });
    const name = helper.accessor((r) => r.file.name, {
      id: "name",
      sortFn: "text",
      header: ({ column }) => <SortHeader column={column} label="Name" />,
      cell: ({ row }) => <NameCell row={row.original} />,
    });
    const tag = helper.accessor((r) => r.rank ?? 0, {
      id: "tag",
      sortDescFirst: true,
      header: ({ column }) => <SortHeader column={column} label={tagHeader ?? ""} />,
      cell: ({ row }) => row.original.tag,
    });
    const bytes = helper.accessor("bytes", {
      sortDescFirst: true,
      header: ({ column }) => <SortHeader column={column} label={sizeLabel} align="end" />,
      cell: ({ getValue }) => <span className="font-medium tabular">{formatBytes(getValue())}</span>,
    });
    const modified = helper.accessor((r) => Date.parse(r.file.modified), {
      id: "modified",
      header: ({ column }) => <SortHeader column={column} label="Geändert" />,
      cell: ({ row }) => (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-muted-foreground tabular">{formatDate(row.original.file.modified)}</span>
          </TooltipTrigger>
          <TooltipContent>
            {formatRelative(row.original.file.modified)}
            {row.original.file.modifiedBy ? ` · ${row.original.file.modifiedBy}` : ""}
          </TooltipContent>
        </Tooltip>
      ),
    });
    const open = helper.display({
      id: "open",
      cell: ({ row }) => (
        <Button variant="ghost" size="icon-sm" asChild className="text-muted-foreground">
          <a
            href={row.original.file.webUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="In SharePoint öffnen"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLinkIcon />
          </a>
        </Button>
      ),
    });
    return tagHeader
      ? helper.columns([select, name, tag, bytes, modified, open])
      : helper.columns([select, name, bytes, modified, open]);
  }, [sizeLabel, tagHeader]);

  const table = useTable({
    features,
    columns,
    data: rows,
    state: { sorting, pagination, rowSelection },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    onRowSelectionChange: setRowSelection,
    getRowId: (r) => r.id,
    enableSortingRemoval: false,
  });

  const selected = useMemo(() => rows.filter((r) => rowSelection[r.id]), [rows, rowSelection]);
  const selectedBytes = selected.reduce((s, r) => s + r.bytes, 0);
  const totalBytes = useMemo(() => rows.reduce((s, r) => s + r.bytes, 0), [rows]);
  const pageRows = table.getRowModel().rows;
  const pageCount = Math.max(1, table.getPageCount());
  const allSelected = rows.length > 0 && selected.length === rows.length;
  const showSelectAllHint = table.getIsAllPageRowsSelected() && rows.length > pageRows.length && !allSelected;

  const selectAll = () => setRowSelection(Object.fromEntries(rows.map((r) => [r.id, true] as const)));
  const clearSelection = () => setRowSelection({});
  const exportCsv = () =>
    downloadCsv(`${exportName}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(selected.length ? selected : rows));

  const widths: Record<string, string> = {
    select: "w-10",
    tag: "w-56",
    bytes: "w-28 text-right",
    modified: "w-28",
    open: "w-12",
  };

  return (
    <div className="flex flex-col">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="text-muted-foreground">
          <span className="font-medium text-foreground tabular">{formatNumber(rows.length)}</span>{" "}
          {rows.length === 1 ? "Datei" : "Dateien"} ·{" "}
          <span className="font-medium text-foreground tabular">{formatBytes(totalBytes)}</span>
        </div>
        {rows.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {quickSelect
              ?.filter((q) => q.ids.length > 0)
              .map((q) => (
                <Button
                  key={q.label}
                  variant="outline"
                  size="sm"
                  onClick={() => setRowSelection(Object.fromEntries(q.ids.map((id) => [id, true] as const)))}
                >
                  {q.label}
                  <span className="text-muted-foreground tabular">{formatNumber(q.ids.length)}</span>
                </Button>
              ))}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={exportCsv}>
                  <DownloadIcon /> CSV
                </Button>
              </TooltipTrigger>
              <TooltipContent>{selected.length ? "Auswahl exportieren" : "Liste exportieren"}</TooltipContent>
            </Tooltip>
            <Button variant="ghost" size="sm" onClick={allSelected ? clearSelection : selectAll}>
              {allSelected ? "Auswahl aufheben" : `Alle ${formatNumber(rows.length)} auswählen`}
            </Button>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        {(showSelectAllHint || (allSelected && rows.length > pageRows.length)) && (
          <div className="flex flex-wrap items-center justify-center gap-x-2 border-b bg-muted/40 px-4 py-2 text-center text-xs">
            {showSelectAllHint ? (
              <>
                Alle {formatNumber(pageRows.length)} Dateien dieser Seite sind ausgewählt.
                <button className="font-medium underline-offset-4 hover:underline" onClick={selectAll}>
                  Alle {formatNumber(rows.length)} Dateien auswählen ({formatBytes(totalBytes)})
                </button>
              </>
            ) : (
              <>
                Alle {formatNumber(rows.length)} Dateien sind ausgewählt.
                <button className="font-medium underline-offset-4 hover:underline" onClick={clearSelection}>
                  Auswahl aufheben
                </button>
              </>
            )}
          </div>
        )}

        <Table className="min-w-[720px] table-fixed">
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id} className="hover:bg-transparent">
                {group.headers.map((header) => (
                  <TableHead key={header.id} className={cn("h-10 px-3 first:pl-4", widths[header.column.id])}>
                    {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {pageRows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() ? "selected" : undefined}
                className="cursor-pointer"
                onMouseDown={(e) => e.shiftKey && e.preventDefault()}
                onClick={(e) => toggleRow(row, e)}
              >
                {row.getAllCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className={cn("px-3 py-2.5 first:pl-4", widths[cell.column.id])}
                    onClick={cell.column.id === "select" ? (e) => e.stopPropagation() : undefined}
                  >
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {rows.length === 0 && (
          <Empty className="py-14">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchXIcon />
              </EmptyMedia>
              <EmptyTitle>{emptyTitle}</EmptyTitle>
              <EmptyDescription>{emptyDescription}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}

        {rows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2.5 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              Zeilen pro Seite
              <Select value={String(pagination.pageSize)} onValueChange={(v) => table.setPageSize(Number(v))}>
                <SelectTrigger size="sm" className="w-[72px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZES.map((s) => (
                    <SelectItem key={s} value={String(s)}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3">
              <span className="tabular">
                Seite {formatNumber(pagination.pageIndex + 1)} von {formatNumber(pageCount)}
              </span>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon-sm" aria-label="Erste Seite" onClick={() => table.firstPage()} disabled={!table.getCanPreviousPage()}>
                  <ChevronsLeftIcon />
                </Button>
                <Button variant="outline" size="icon-sm" aria-label="Vorherige Seite" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
                  <ChevronLeftIcon />
                </Button>
                <Button variant="outline" size="icon-sm" aria-label="Nächste Seite" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
                  <ChevronRightIcon />
                </Button>
                <Button variant="outline" size="icon-sm" aria-label="Letzte Seite" onClick={() => table.lastPage()} disabled={!table.getCanNextPage()}>
                  <ChevronsRightIcon />
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {selected.length > 0 && (
        <div className="pointer-events-none sticky bottom-5 z-30 mt-4 flex justify-center">
          <div className="pointer-events-auto flex animate-in items-center gap-1 rounded-xl border bg-popover py-1.5 pr-1.5 pl-4 text-sm shadow-lg duration-200 fade-in slide-in-from-bottom-3">
            <span className="mr-2 whitespace-nowrap">
              <span className="font-medium tabular">{formatNumber(selected.length)}</span> ausgewählt ·{" "}
              <span className="font-medium tabular">{formatBytes(selectedBytes)}</span>
            </span>
            <Button variant="ghost" size="sm" onClick={clearSelection}>
              <XIcon /> Aufheben
            </Button>
            {onDismiss && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onDismiss(selected.map((r) => r.id));
                  clearSelection();
                }}
              >
                <EyeOffIcon /> Ignorieren
              </Button>
            )}
            {action === "delete" && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm">
                    <EllipsisIcon /> Weitere
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="top" className="w-64">
                  <DropdownMenuItem onSelect={() => setExtraDialog("notify")}>
                    <MailIcon /> Besitzer benachrichtigen
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                    {isDesktop ? "Desktop-App" : "Nur in der Desktop-App"}
                  </DropdownMenuLabel>
                  <DropdownMenuItem disabled={!isDesktop} onSelect={() => setExtraDialog("backup")}>
                    <FolderDownIcon /> Lokal sichern & löschen
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!isDesktop || !selected.some((r) => isCompressible(r.file))}
                    onSelect={() => setExtraDialog("compress")}
                  >
                    <Minimize2Icon /> Komprimieren
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button size="sm" className="bg-destructive text-white hover:bg-destructive/90" onClick={() => setDialogOpen(true)}>
              {action === "delete" ? <Trash2Icon /> : <HistoryIcon />}
              {action === "delete" ? "Löschen" : "Versionen löschen"}
            </Button>
          </div>
        </div>
      )}

      <Suspense fallback={null}>
      {extraDialog === "notify" && (
        <NotifyOwnersDialog open onOpenChange={(o) => !o && setExtraDialog(null)} files={selected.map((r) => r.file)} />
      )}
      {extraDialog === "backup" && (
        <BackupDialog
          open
          onOpenChange={(o) => !o && setExtraDialog(null)}
          files={selected.map((r) => r.file)}
          onDone={(succeeded) =>
            setRowSelection((old) => {
              const next = { ...old };
              for (const id of succeeded) delete next[id];
              return next;
            })
          }
        />
      )}
      {extraDialog === "compress" && (
        <CompressDialog
          open
          onOpenChange={(o) => !o && setExtraDialog(null)}
          files={selected.map((r) => r.file)}
          onDone={clearSelection}
        />
      )}
      </Suspense>

      <BulkActionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        rows={selected}
        action={action}
        onDone={(succeeded) =>
          setRowSelection((old) => {
            const next = { ...old };
            for (const id of succeeded) delete next[id];
            return next;
          })
        }
      />
    </div>
  );
}
