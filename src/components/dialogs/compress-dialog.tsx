"use client";

import { useEffect, useMemo, useState } from "react";
import { CircleAlertIcon, CircleCheckIcon, CircleMinusIcon, FolderOpenIcon, Minimize2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { compressFilesAction, type CompressOutcome } from "@/lib/actions";
import { desktopBridge, type CompressQuality, type MediaStatus } from "@/lib/desktop";
import { isCompressible } from "@/lib/file-types";
import { formatBytes, formatNumber } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { SpFile } from "@/lib/types";
import { openSettings } from "../settings-dialog";

interface Props {
  open: boolean;
  onOpenChange(open: boolean): void;
  files: SpFile[];
  onDone(): void;
}

const QUALITY: Record<CompressQuality, { label: string; hint: string; video: number; image: number }> = {
  balanced: { label: "Ausgewogen", hint: "Kaum sichtbarer Unterschied · H.264 CRF 23, Bilder JPEG 82 %", video: 0.45, image: 0.6 },
  strong: { label: "Stark", hint: "Max. Full HD bzw. 2560 px · H.264 CRF 28, Bilder JPEG 70 %", video: 0.3, image: 0.4 },
};

export function CompressDialog({ open, onOpenChange, files, onDone }: Props) {
  const mode = useApp((s) => s.mode);
  const targets = useMemo(() => files.filter(isCompressible), [files]);
  const videos = targets.filter((f) => f.category === "video");
  const [quality, setQuality] = useState<CompressQuality>("balanced");
  const [keepOriginals, setKeepOriginals] = useState(false);
  const [folder, setFolder] = useState<string | null>(null);
  const [status, setStatus] = useState<MediaStatus | null>(null);
  const [current, setCurrent] = useState<number | null>(null);
  const [outcomes, setOutcomes] = useState<CompressOutcome[]>([]);
  const running = current !== null;

  useEffect(() => {
    if (open && mode === "live") desktopBridge()?.mediaStatus().then(setStatus).catch(() => {});
  }, [open, mode]);

  const ffmpegMissing = mode === "live" && videos.length > 0 && status !== null && !status.ffmpeg.available;
  const imagesMissing = mode === "live" && targets.length > videos.length && status !== null && !status.images;
  const estimate = targets.reduce(
    (s, f) => s + f.size * (1 - (f.category === "video" ? QUALITY[quality].video : QUALITY[quality].image)),
    0,
  );

  async function chooseFolder() {
    const picked = await desktopBridge()?.chooseFolder();
    if (picked) setFolder(picked);
  }

  async function run() {
    setOutcomes([]);
    setCurrent(0);
    try {
      await compressFilesAction(targets, { quality, backupFolder: keepOriginals && folder ? folder : undefined }, (index, outcome) => {
        setCurrent(index);
        if (outcome) setOutcomes((o) => [...o, outcome]);
      });
    } finally {
      setCurrent(null);
      onDone();
    }
  }

  const finished = !running && outcomes.length > 0;
  const freed = outcomes.filter((o) => o.status === "done").reduce((s, o) => s + o.before - (o.after ?? o.before), 0);

  return (
    <Dialog open={open} onOpenChange={(o) => !running && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="text-left">
          <DialogTitle>Medien komprimieren</DialogTitle>
          <DialogDescription>
            {formatNumber(targets.length)} von {formatNumber(files.length)} ausgewählten Dateien lassen sich komprimieren (MP4, MOV,
            MKV, MTS, JPEG, PNG, WebP). Die kleinere Fassung ersetzt die Datei in SharePoint – gleicher Name, gleiche Links. Danach
            werden die alten Versionen gelöscht, sonst würde kein Speicher frei.
            {mode === "demo" && " Im Demo-Modus wird das Ergebnis simuliert."}
          </DialogDescription>
        </DialogHeader>

        {!finished && (
          <>
            <ToggleGroup
              type="single"
              variant="outline"
              value={quality}
              onValueChange={(v) => v && setQuality(v as CompressQuality)}
              className="w-full"
              disabled={running}
            >
              {(Object.keys(QUALITY) as CompressQuality[]).map((q) => (
                <ToggleGroupItem key={q} value={q} className="flex-1">
                  {QUALITY[q].label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <p className="-mt-2 text-xs text-muted-foreground">
              {QUALITY[quality].hint} · geschätzte Einsparung{" "}
              <span className="font-medium text-foreground">{formatBytes(estimate)}</span>
            </p>

            <div className="flex items-start gap-3 rounded-lg border p-3">
              <Switch id="keep-originals" checked={keepOriginals} onCheckedChange={setKeepOriginals} disabled={running} className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <Label htmlFor="keep-originals" className="font-medium">
                  Originale vorher lokal sichern
                </Label>
                <p className="mt-1 text-xs text-muted-foreground">Für den Fall, dass die Qualität nicht reicht.</p>
                {keepOriginals && (
                  <Button variant="outline" size="sm" className="mt-2 max-w-full" onClick={chooseFolder} disabled={running}>
                    <FolderOpenIcon /> <span className="truncate">{folder ?? "Ordner wählen"}</span>
                  </Button>
                )}
              </div>
            </div>

            {(ffmpegMissing || imagesMissing) && (
              <div className="flex gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
                <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
                <div>
                  {ffmpegMissing && (
                    <p>
                      Für Videos wird <strong>ffmpeg</strong> benötigt. Installieren mit{" "}
                      <code className="font-mono">winget install Gyan.FFmpeg</code> bzw. <code className="font-mono">brew install ffmpeg</code>{" "}
                      oder den Pfad in den{" "}
                      <button className="underline underline-offset-2" onClick={() => openSettings("desktop")}>
                        Einstellungen
                      </button>{" "}
                      hinterlegen. Videos werden sonst übersprungen.
                    </p>
                  )}
                  {imagesMissing && <p>Die Bildkomprimierung ist auf diesem System nicht verfügbar.</p>}
                </div>
              </div>
            )}
          </>
        )}

        {(running || finished) && (
          <div className="space-y-3">
            {running && (
              <>
                <Progress value={(current / Math.max(1, targets.length)) * 100} />
                <div className="truncate text-xs text-muted-foreground">
                  {formatNumber(current + 1)} von {formatNumber(targets.length)}: {targets[current]?.name}
                </div>
              </>
            )}
            {finished && (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <span className="font-medium">{formatBytes(freed)}</span> freigegeben ·{" "}
                {formatNumber(outcomes.filter((o) => o.status === "done").length)} komprimiert
              </div>
            )}
            <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
              {outcomes.map((o) => (
                <li key={o.file.id} className="flex items-center gap-2">
                  {o.status === "done" ? (
                    <CircleCheckIcon className="size-3.5 shrink-0 text-success" />
                  ) : o.status === "skipped" ? (
                    <CircleMinusIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <CircleAlertIcon className="size-3.5 shrink-0 text-destructive" />
                  )}
                  <span className="min-w-0 flex-1 truncate" title={o.error}>
                    {o.file.name}
                  </span>
                  <span className="shrink-0 text-muted-foreground tabular">
                    {o.status === "done"
                      ? `${formatBytes(o.before)} → ${formatBytes(o.after ?? 0)}`
                      : o.status === "skipped"
                        ? "kaum kleiner, unverändert"
                        : "fehlgeschlagen"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          {finished ? (
            <Button onClick={() => onOpenChange(false)}>Fertig</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={running}>
                Abbrechen
              </Button>
              <Button onClick={run} disabled={running || !targets.length || (keepOriginals && !folder)}>
                {running ? <Spinner /> : <Minimize2Icon />}
                {formatNumber(targets.length)} komprimieren
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
