"use client";

import { useState } from "react";
import {
  ArchiveRestoreIcon,
  CircleCheckIcon,
  FolderDownIcon,
  HistoryIcon,
  ListRestartIcon,
  MailIcon,
  Minimize2Icon,
  RecycleIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { PageHeader } from "../page-header";
import { restoreEntryAction } from "@/lib/actions";
import { formatBytes, formatDate, formatNumber, formatRelative } from "@/lib/format";
import { restorableFiles, totalFreed, type HistoryEntry, type HistoryKind } from "@/lib/history";
import { useApp } from "@/lib/store";

const KIND: Record<HistoryKind, { label: string; icon: LucideIcon }> = {
  delete: { label: "Gelöscht", icon: Trash2Icon },
  backup: { label: "Lokal gesichert und gelöscht", icon: FolderDownIcon },
  versions: { label: "Alte Versionen gelöscht", icon: HistoryIcon },
  "recycle-bin": { label: "Papierkorb geleert", icon: RecycleIcon },
  compress: { label: "Komprimiert", icon: Minimize2Icon },
  "version-limit": { label: "Versionslimit gesetzt", icon: SlidersHorizontalIcon },
  restore: { label: "Wiederhergestellt", icon: ArchiveRestoreIcon },
  notify: { label: "Besitzer benachrichtigt", icon: MailIcon },
};

function bytesLabel(e: HistoryEntry) {
  if (!e.bytes) return null;
  if (e.kind === "restore") return `${formatBytes(e.bytes)} zurück`;
  if ((e.kind === "delete" || e.kind === "backup") && !e.permanent) return `${formatBytes(e.bytes)} in den Papierkorb`;
  return `${formatBytes(e.bytes)} freigegeben`;
}

function EntryRow({ entry }: { entry: HistoryEntry }) {
  const { label, icon: Icon } = KIND[entry.kind];
  const restorable = restorableFiles(entry);
  const restoredCount = entry.restoredIds?.length ?? 0;
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  async function restore() {
    setProgress({ done: 0, total: restorable.length });
    try {
      await restoreEntryAction(entry.id, (done, total) => setProgress({ done, total }));
    } finally {
      setProgress(null);
    }
  }

  return (
    <li className="flex gap-4 px-4 py-4">
      <div className="grid size-9 shrink-0 place-items-center rounded-lg border bg-background">
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium">{label}</span>
          {entry.fileCount > 0 && (
            <span className="text-sm text-muted-foreground">
              {formatNumber(entry.fileCount)} {entry.fileCount === 1 ? "Datei" : "Dateien"}
            </span>
          )}
          {entry.permanent && <Badge variant="outline">endgültig</Badge>}
          {restoredCount > 0 && entry.kind !== "restore" && (
            <Badge variant="secondary">
              <CircleCheckIcon /> {formatNumber(restoredCount)} wiederhergestellt
            </Badge>
          )}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          <span title={formatDate(entry.at)}>{formatRelative(entry.at)}</span>
          {bytesLabel(entry) && <> · {bytesLabel(entry)}</>}
          {entry.note && <> · {entry.note}</>}
        </div>
        {entry.files.length > 0 && (
          <details className="mt-2 text-xs">
            <summary className="cursor-pointer text-muted-foreground select-none hover:text-foreground">Dateien anzeigen</summary>
            <ul className="mt-2 space-y-1">
              {entry.files.slice(0, 12).map((f) => (
                <li key={f.id} className="flex gap-3">
                  <span className="min-w-0 flex-1 truncate">
                    {f.name} <span className="text-muted-foreground">· {f.path}</span>
                  </span>
                  <span className="shrink-0 text-muted-foreground tabular">{formatBytes(f.size)}</span>
                </li>
              ))}
              {entry.files.length > 12 && <li className="text-muted-foreground">und {formatNumber(entry.files.length - 12)} weitere</li>}
            </ul>
          </details>
        )}
        {progress && <Progress className="mt-3" value={(progress.done / Math.max(1, progress.total)) * 100} />}
      </div>
      {restorable.length > 0 && (
        <Button variant="outline" size="sm" onClick={restore} disabled={progress !== null} className="shrink-0">
          {progress ? <Spinner /> : <ListRestartIcon />} Wiederherstellen
        </Button>
      )}
    </li>
  );
}

export function HistoryView() {
  const history = useApp((s) => s.history);
  const mode = useApp((s) => s.mode);
  const restorable = history.reduce((s, e) => s + restorableFiles(e).reduce((b, f) => b + f.size, 0), 0);

  return (
    <div>
      <PageHeader
        title="Verlauf"
        description="Alles, was in dieser Site aufgeräumt wurde. Dateien aus dem Papierkorb lassen sich bis zu 93 Tage wiederherstellen."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-5">
          <div className="text-sm text-muted-foreground">Insgesamt freigegeben</div>
          <div className="mt-2 text-3xl font-semibold tracking-tight">{formatBytes(totalFreed(history))}</div>
        </div>
        <div className="rounded-xl border bg-card p-5">
          <div className="text-sm text-muted-foreground">Wiederherstellbar</div>
          <div className="mt-2 text-3xl font-semibold tracking-tight">{formatBytes(restorable)}</div>
        </div>
        <div className="rounded-xl border bg-card p-5">
          <div className="text-sm text-muted-foreground">Maßnahmen</div>
          <div className="mt-2 text-3xl font-semibold tracking-tight">{formatNumber(history.length)}</div>
        </div>
      </div>

      {history.length ? (
        <ul className="divide-y rounded-xl border bg-card">
          {history.map((e) => (
            <EntryRow key={e.id} entry={e} />
          ))}
        </ul>
      ) : (
        <Empty className="rounded-xl border border-dashed py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HistoryIcon />
            </EmptyMedia>
            <EmptyTitle>Noch nichts passiert</EmptyTitle>
            <EmptyDescription>
              Gelöschte Dateien, bereinigte Versionen und andere Änderungen erscheinen hier
              {mode === "demo" ? " – im Demo-Modus nur bis zum Verlassen der Site." : "."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
}
