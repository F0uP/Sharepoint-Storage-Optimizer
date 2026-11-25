"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronRightIcon, FileIcon, FolderDownIcon, FolderIcon, FolderOpenIcon, HardDriveIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { backupAndDeleteAction, errorMessage } from "@/lib/actions";
import {
  BACKUP_LAYOUTS,
  backupSegments,
  countFolders,
  countLongPaths,
  loadBackupLayout,
  saveBackupLayout,
  type BackupLayout,
} from "@/lib/backup";
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

/** Deep paths are shortened in the middle – the start and the end tell where a file lands. */
function visibleSegments(segments: string[]): (string | null)[] {
  return segments.length <= 6 ? segments : [...segments.slice(0, 2), null, ...segments.slice(-3)];
}

function PathPreview({ root, segments }: { root: string; segments: string[] }) {
  return (
    <ol
      className="flex flex-wrap items-center gap-x-1 gap-y-1 rounded-lg border bg-muted/40 px-3 py-2.5 text-xs"
      aria-label="Beispiel für den Zielpfad"
      title={[root, ...segments].join(" › ")}
      data-testid="backup-preview"
    >
      <li className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        <HardDriveIcon className="size-3.5 shrink-0" />
        <span className="max-w-36 truncate">{root}</span>
      </li>
      {visibleSegments(segments).map((segment, i, all) => {
        const file = i === all.length - 1;
        return (
          <Fragment key={i}>
            <li aria-hidden className="text-muted-foreground/50">
              <ChevronRightIcon className="size-3" />
            </li>
            <li className="flex min-w-0 items-center gap-1.5">
              {segment === null ? (
                <span className="text-muted-foreground">…</span>
              ) : (
                <>
                  {file ? <FileIcon className="size-3.5 shrink-0" /> : <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />}
                  <span className={file ? "max-w-56 truncate font-medium" : "max-w-36 truncate"}>{segment}</span>
                </>
              )}
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}

export function BackupDialog({ open, onOpenChange, files, onDone }: Props) {
  const mode = useApp((s) => s.mode);
  const siteName = useApp((s) => s.site?.name ?? s.scan?.site.name ?? "Site");
  const [folder, setFolder] = useState<string | null>(null);
  const [permanent, setPermanent] = useState(true);
  const [layout, setLayout] = useState<BackupLayout>(loadBackupLayout);
  const [progress, setProgress] = useState<{ phase: "download" | "delete"; done: number; total: number } | null>(null);
  const running = progress !== null;
  const bytes = files.reduce((s, f) => s + f.size, 0);

  const paths = useMemo(() => files.map((f) => backupSegments(f, layout, siteName)), [files, layout, siteName]);
  // the deepest path shows best what the layout does
  const example = useMemo(() => paths.reduce<string[]>((deepest, p) => (p.length > deepest.length ? p : deepest), []), [paths]);
  const folders = useMemo(() => countFolders(paths), [paths]);
  const tooLong = folder && desktopBridge()?.platform === "win32" ? countLongPaths(folder, paths) : 0;
  const folderName = folder?.split(/[\\/]/).filter(Boolean).at(-1) ?? "Zielordner";
  const hint = BACKUP_LAYOUTS.find((l) => l.value === layout)?.hint;

  async function choose() {
    const picked = await desktopBridge()?.chooseFolder();
    if (picked) setFolder(picked);
  }

  function changeLayout(value: string) {
    if (!value) return;
    setLayout(value as BackupLayout);
    saveBackupLayout(value as BackupLayout);
  }

  async function run() {
    if (!folder) return;
    setProgress({ phase: "download", done: 0, total: files.length });
    try {
      const result = await backupAndDeleteAction(files, { folder, permanent, layout }, (phase, done, total) =>
        setProgress({ phase, done, total }),
      );
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="text-left">
          <DialogTitle>
            {formatNumber(files.length)} {files.length === 1 ? "Datei" : "Dateien"} sichern & löschen
          </DialogTitle>
          <DialogDescription>
            Die Dateien ({formatBytes(bytes)}) werden in einen lokalen Ordner geladen – z. B. auf eine externe Festplatte oder ein NAS –,
            mit ihrem ursprünglichen Änderungsdatum und einem Inhaltsverzeichnis (CSV). Gelöscht wird nur, was vollständig gesichert
            wurde.
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

        <section className="space-y-2.5" aria-labelledby="backup-layout-label">
          <div className="flex items-baseline justify-between gap-2">
            <h3 id="backup-layout-label" className="text-sm font-medium">
              Ordnerstruktur
            </h3>
            <span className="text-xs text-muted-foreground tabular">
              {layout === "flat" ? "keine Unterordner" : `${formatNumber(folders)} ${folders === 1 ? "Ordner wird" : "Ordner werden"} angelegt`}
            </span>
          </div>
          <ToggleGroup
            type="single"
            variant="outline"
            spacing={0}
            value={layout}
            onValueChange={changeLayout}
            disabled={running}
            aria-label="Ordnerstruktur"
            className="w-full"
          >
            {BACKUP_LAYOUTS.map((l) => (
              <ToggleGroupItem key={l.value} value={l.value} className="flex-1 px-2 text-xs sm:text-sm">
                {l.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="text-xs text-pretty text-muted-foreground">{hint}</p>
          {example.length > 0 && <PathPreview root={folderName} segments={example} />}
          {tooLong > 0 && (
            <p className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-xs text-pretty" role="status">
              <TriangleAlertIcon className="mt-px size-3.5 shrink-0 text-warning" />
              <span>
                {tooLong === 1 ? "Ein Pfad wird" : `${formatNumber(tooLong)} Pfade werden`} länger als 260 Zeichen – der Explorer und manche
                Programme können solche Dateien nicht öffnen. „Ab Bibliothek“ oder ein Zielordner näher am Laufwerk hält die Pfade
                kürzer.
              </span>
            </p>
          )}
        </section>

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
