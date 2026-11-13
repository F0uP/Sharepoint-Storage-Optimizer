"use client";

import { useEffect, useState } from "react";
import { HistoryIcon, ShieldAlertIcon, ShieldCheckIcon, Trash2Icon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import type { FileRow } from "./file-table";
import { FileThumbnail } from "./file-thumbnail";
import { checkRetention, cleanVersionsAction, deleteFilesAction, type RetentionCheck } from "@/lib/actions";
import { formatBytes, formatNumber } from "@/lib/format";

interface Props {
  open: boolean;
  onOpenChange(open: boolean): void;
  rows: FileRow[];
  action: "delete" | "versions";
  onDone(succeeded: string[]): void;
}

/** Retention labels are checked whenever the dialog opens for deleting. */
function useRetention(open: boolean, action: Props["action"], rows: FileRow[]) {
  const [state, setState] = useState<{ rows: FileRow[]; result: RetentionCheck | "error" } | null>(null);
  useEffect(() => {
    if (!open || action !== "delete" || !rows.length) return;
    let cancelled = false;
    checkRetention(rows.map((r) => r.file))
      .then((result) => !cancelled && setState({ rows, result }))
      .catch(() => !cancelled && setState({ rows, result: "error" }));
    return () => {
      cancelled = true;
    };
  }, [open, action, rows]);
  // only a result for the current selection counts
  return state?.rows === rows ? state.result : action === "delete" && open ? "checking" : null;
}

export function BulkActionDialog({ open, onOpenChange, rows, action, onDone }: Props) {
  const [permanent, setPermanent] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const retention = useRetention(open, action, rows);
  const running = progress !== null;

  const blockedIds = new Set(typeof retention === "object" && retention ? retention.blocked.map((b) => b.file.id) : []);
  const target = rows.filter((r) => !blockedIds.has(r.id));
  const bytes = target.reduce((s, r) => s + r.bytes, 0);
  const preview = target.toSorted((a, b) => b.bytes - a.bytes).slice(0, 4);

  async function run() {
    setProgress({ done: 0, total: target.length });
    const files = target.map((r) => r.file);
    const onProgress = (done: number, total: number) => setProgress({ done, total });
    try {
      const result =
        action === "delete" ? await deleteFilesAction(files, permanent, onProgress) : await cleanVersionsAction(files, onProgress);
      onDone(result.succeeded);
    } finally {
      setProgress(null);
      onOpenChange(false);
    }
  }

  const n = formatNumber(target.length);
  const nothingLeft = action === "delete" && target.length === 0 && rows.length > 0 && typeof retention === "object" && retention !== null;
  return (
    <AlertDialog open={open} onOpenChange={(o) => !running && onOpenChange(o)}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader className="flex flex-row items-start gap-4 text-left">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-destructive/10 text-destructive">
            {action === "delete" ? <Trash2Icon className="size-5" /> : <HistoryIcon className="size-5" />}
          </div>
          <div className="space-y-1">
            <AlertDialogTitle>
              {nothingLeft
                ? "Keine löschbaren Dateien"
                : action === "delete"
                  ? `${n} ${target.length === 1 ? "Datei" : "Dateien"} löschen?`
                  : `Alte Versionen von ${n} Dateien löschen?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {nothingLeft
                ? "Alle ausgewählten Dateien sind durch Aufbewahrungsbezeichnungen geschützt."
                : action === "delete"
                ? `Gibt ${formatBytes(bytes)} frei.`
                : `Gibt ${formatBytes(bytes)} frei. Die aktuelle Version bleibt erhalten, alte Versionen werden endgültig gelöscht.`}
            </AlertDialogDescription>
          </div>
        </AlertDialogHeader>

        {!nothingLeft && (
        <ul className="space-y-1.5 rounded-lg border bg-muted/30 p-3 text-xs">
          {preview.map((r) => (
            <li key={r.id} className="flex items-center gap-2.5">
              <FileThumbnail file={r.file} className="size-6 rounded" />
              <span className="min-w-0 flex-1 truncate">{r.file.name}</span>
              <span className="shrink-0 text-muted-foreground tabular">{formatBytes(r.bytes)}</span>
            </li>
          ))}
          {target.length > preview.length && (
            <li className="pl-8 text-muted-foreground">und {formatNumber(target.length - preview.length)} weitere</li>
          )}
        </ul>
        )}

        {action === "delete" && (
          <div className="text-xs" aria-live="polite">
            {retention === "checking" && (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Spinner className="size-3.5" /> Aufbewahrungsbezeichnungen werden geprüft …
              </p>
            )}
            {retention === "error" && (
              <p className="flex items-center gap-2 text-muted-foreground">
                <ShieldAlertIcon className="size-3.5" /> Aufbewahrung konnte nicht geprüft werden – SharePoint verhindert das
                Löschen geschützter Dateien trotzdem.
              </p>
            )}
            {typeof retention === "object" && retention && (
              <>
                {retention.blocked.length === 0 && retention.retained.length === 0 && (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <ShieldCheckIcon className="size-3.5 text-success" /> Keine Aufbewahrungsbezeichnungen gefunden.
                  </p>
                )}
                {retention.blocked.length > 0 && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                    <p className="font-medium">
                      {formatNumber(retention.blocked.length)} {retention.blocked.length === 1 ? "Datei ist" : "Dateien sind"} als
                      Datensatz geschützt und {retention.blocked.length === 1 ? "wird" : "werden"} übersprungen
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      {retention.blocked.slice(0, 3).map((b) => `${b.file.name} (${b.label})`).join(", ")}
                      {retention.blocked.length > 3 ? " …" : ""}
                    </p>
                  </div>
                )}
                {retention.retained.length > 0 && (
                  <div className="mt-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
                    <p className="font-medium">
                      {formatNumber(retention.retained.length)} {retention.retained.length === 1 ? "Datei unterliegt" : "Dateien unterliegen"}{" "}
                      einer Aufbewahrung
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      Sie werden gelöscht, belegen aber bis zum Ende der Frist weiter Speicher in der Aufbewahrungsbibliothek (
                      {formatBytes(retention.retained.reduce((s, r) => s + r.file.size, 0))}).
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {action === "delete" && !nothingLeft && (
          <div className="flex items-start gap-3 rounded-lg border p-3">
            <Switch id="permanent" checked={permanent} onCheckedChange={setPermanent} disabled={running} className="mt-0.5" />
            <Label htmlFor="permanent" className="flex flex-col items-start gap-1 font-normal">
              <span className="font-medium">Endgültig löschen</span>
              <span className="text-xs text-muted-foreground">
                {permanent
                  ? "Speicher wird sofort frei. Nicht wiederherstellbar."
                  : "Dateien landen im Papierkorb und belegen dort weiter Speicher, bis er geleert wird (93 Tage wiederherstellbar)."}
              </span>
            </Label>
          </div>
        )}

        {running && (
          <div className="space-y-2">
            <Progress value={(progress.done / Math.max(1, progress.total)) * 100} />
            <div className="text-xs text-muted-foreground tabular">
              {formatNumber(progress.done)} von {formatNumber(progress.total)} verarbeitet
            </div>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={running}>Abbrechen</AlertDialogCancel>
          <Button
            className="bg-destructive text-white hover:bg-destructive/90"
            onClick={run}
            disabled={running || target.length === 0 || retention === "checking"}
          >
            {(running || retention === "checking") && <Spinner />}
            {action === "delete" ? (permanent ? "Endgültig löschen" : "In Papierkorb verschieben") : "Versionen löschen"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
