"use client";

import { useState } from "react";
import { HistoryIcon, Trash2Icon } from "lucide-react";
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
import { cleanVersionsAction, deleteFilesAction } from "@/lib/actions";
import { formatBytes, formatNumber } from "@/lib/format";

interface Props {
  open: boolean;
  onOpenChange(open: boolean): void;
  rows: FileRow[];
  action: "delete" | "versions";
  onDone(succeeded: string[]): void;
}

export function BulkActionDialog({ open, onOpenChange, rows, action, onDone }: Props) {
  const [permanent, setPermanent] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const running = progress !== null;
  const bytes = rows.reduce((s, r) => s + r.bytes, 0);
  const preview = rows.toSorted((a, b) => b.bytes - a.bytes).slice(0, 4);

  async function run() {
    setProgress({ done: 0, total: rows.length });
    const files = rows.map((r) => r.file);
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

  const n = formatNumber(rows.length);
  return (
    <AlertDialog open={open} onOpenChange={(o) => !running && onOpenChange(o)}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader className="flex flex-row items-start gap-4 text-left">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-destructive/10 text-destructive">
            {action === "delete" ? <Trash2Icon className="size-5" /> : <HistoryIcon className="size-5" />}
          </div>
          <div className="space-y-1">
            <AlertDialogTitle>
              {action === "delete" ? `${n} ${rows.length === 1 ? "Datei" : "Dateien"} löschen?` : `Alte Versionen von ${n} Dateien löschen?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {action === "delete"
                ? `Gibt ${formatBytes(bytes)} frei.`
                : `Gibt ${formatBytes(bytes)} frei. Die aktuelle Version bleibt erhalten, alte Versionen werden endgültig gelöscht.`}
            </AlertDialogDescription>
          </div>
        </AlertDialogHeader>

        <ul className="space-y-1 rounded-lg border bg-muted/30 p-3 text-xs">
          {preview.map((r) => (
            <li key={r.id} className="flex justify-between gap-3">
              <span className="truncate">{r.file.name}</span>
              <span className="shrink-0 text-muted-foreground tabular">{formatBytes(r.bytes)}</span>
            </li>
          ))}
          {rows.length > preview.length && (
            <li className="text-muted-foreground">und {formatNumber(rows.length - preview.length)} weitere</li>
          )}
        </ul>

        {action === "delete" && (
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
          <Button className="bg-destructive text-white hover:bg-destructive/90" onClick={run} disabled={running || rows.length === 0}>
            {running && <Spinner />}
            {action === "delete" ? (permanent ? "Endgültig löschen" : "In Papierkorb verschieben") : "Versionen löschen"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
