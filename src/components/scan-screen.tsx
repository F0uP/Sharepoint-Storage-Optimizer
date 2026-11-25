"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { leaveSite } from "@/lib/actions";
import { formatNumber } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { ScanProgress } from "@/lib/types";

/** "Microsoft drosselt die Anfragen. Weiter in 12 s" – counts down while the scan waits out a problem. */
export function WaitingNotice({ waiting }: { waiting: NonNullable<ScanProgress["waiting"]> }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.ceil((waiting.until - now) / 1000));
  return (
    <>
      {waiting.reason} {seconds > 0 ? `Neuer Versuch in ${seconds} s.` : "Neuer Versuch läuft …"}
    </>
  );
}

export function ScanScreen() {
  const site = useApp((s) => s.site);
  const progress = useApp((s) => s.progress);
  const mode = useApp((s) => s.mode);
  const libraryProgress = progress && progress.driveCount > 0 ? (progress.driveIndex + 1) / progress.driveCount : 0;

  return (
    <div className="grid min-h-svh place-items-center px-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          {progress?.resumed ? "Setze unterbrochenen Scan fort" : "Scanne Site"}
        </div>
        <h1 className="mt-2 truncate text-2xl font-semibold tracking-tight">{site?.name}</h1>

        <div className="mt-8 text-5xl font-semibold tracking-tight tabular">{formatNumber(progress?.items ?? 0)}</div>
        <div className="mt-1 text-sm text-muted-foreground">
          Elemente erfasst
          {progress?.resumed ? ` · ${formatNumber(progress.resumed)} davon aus dem letzten Versuch` : ""}
        </div>

        <div className="mt-8 h-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-foreground transition-[width] duration-500"
            style={{ width: `${Math.max(4, libraryProgress * 100)}%` }}
          />
        </div>
        <div className="mt-2 flex justify-between text-xs text-muted-foreground">
          <span className="truncate">{progress?.driveName ? `Bibliothek „${progress.driveName}“` : "Bibliotheken werden geladen …"}</span>
          {progress && progress.driveCount > 0 && (
            <span className="tabular">
              {progress.driveIndex + 1} / {progress.driveCount}
            </span>
          )}
        </div>

        {progress?.waiting && (
          <p className="mt-4 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-pretty text-muted-foreground" role="status">
            <WaitingNotice key={progress.waiting.until} waiting={progress.waiting} />
          </p>
        )}

        <Button variant="ghost" size="sm" className="mt-8 -ml-2.5 text-muted-foreground" onClick={leaveSite}>
          Abbrechen
        </Button>
        {mode === "live" && (
          <p className="mt-1 text-xs text-pretty text-muted-foreground">
            Der Fortschritt wird laufend gespeichert – nach einem Abbruch geht es beim nächsten Öffnen dort weiter.
          </p>
        )}
      </div>
    </div>
  );
}
