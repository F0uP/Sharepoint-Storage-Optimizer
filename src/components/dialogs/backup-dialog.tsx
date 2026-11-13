"use client";

import { useState } from "react";
import { FolderDownIcon, FolderOpenIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { backupAndDeleteAction, errorMessage } from "@/lib/actions";
import { desktopBridge } from "@/lib/desktop";
import { formatBytes, formatNumber } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { SpFile } from "@/lib/types";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange(open: boolean): void;
  files: SpFile[];
  onDone(succeeded: string[]): void;
}

export function BackupDialog({ open, onOpenChange, files, onDone }: Props) {
  const mode = useApp((s) => s.mode);
  const [folder, setFolder] = useState<string | null>(null);
  const [permanent, setPermanent] = useState(true);
  const [progress, setProgress] = useState<{ phase: "download" | "delete"; done: number; total: number } | null>(null);
  const running = progress !== null;
  const bytes = files.reduce((s, f) => s + f.size, 0);

  async function choose() {
    const picked = await desktopBridge()?.chooseFolder();
    if (picked) setFolder(picked);
  }

  async function run() {
    if (!folder) return;
    setProgress({ phase: "download", done: 0, total: files.length });
    try {
      const result = await backupAndDeleteAction(files, { folder, permanent }, (phase, done, total) => setProgress({ phase, done, total }));
      onDone(result.succeeded);
      onOpenChange(false);
    } catch (e) {
      toast.error("Sicherung fehlgeschlagen", { description: errorMessage(e) });
    } finally {
      setProgress(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !running && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-left">
          <DialogTitle>
            {formatNumber(files.length)} {files.length === 1 ? "Datei" : "Dateien"} sichern & löschen
          </DialogTitle>
          <DialogDescription>
            Die Dateien ({formatBytes(bytes)}) werden mit ihrer Ordnerstruktur in einen lokalen Ordner – z. B. eine externe Festplatte
            oder ein NAS – geladen. Gelöscht wird nur, was vollständig gesichert wurde.
            {mode === "demo" && " Im Demo-Modus werden kleine Platzhalter-Dateien geschrieben."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3 rounded-lg border p-3">
          <FolderOpenIcon className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1 truncate text-sm" title={folder ?? undefined}>
            {folder ?? <span className="text-muted-foreground">Noch kein Zielordner gewählt</span>}
          </div>
          <Button variant="outline" size="sm" onClick={choose} disabled={running}>
            {folder ? "Ändern" : "Ordner wählen"}
          </Button>
        </div>

        <div className="flex items-start gap-3 rounded-lg border p-3">
          <Switch id="backup-permanent" checked={permanent} onCheckedChange={setPermanent} disabled={running} className="mt-0.5" />
          <Label htmlFor="backup-permanent" className="flex flex-col items-start gap-1 font-normal">
            <span className="font-medium">Danach endgültig löschen</span>
            <span className="text-xs text-muted-foreground">
              {permanent
                ? "Der Speicher in SharePoint wird sofort frei – die Originale liegen ja im Zielordner."
                : "Die Dateien landen im Papierkorb und zählen dort bis zu 93 Tage weiter zum Kontingent."}
            </span>
          </Label>
        </div>

        {running && (
          <div className="space-y-2">
            <Progress value={(progress.done / Math.max(1, progress.total)) * 100} />
            <div className="text-xs text-muted-foreground tabular">
              {progress.phase === "download" ? "Gesichert" : "Gelöscht"}: {formatNumber(progress.done)} von {formatNumber(progress.total)}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={running}>
            Abbrechen
          </Button>
          <Button onClick={run} disabled={!folder || running || !files.length}>
            {running ? <Spinner /> : <FolderDownIcon />}
            Sichern & löschen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
