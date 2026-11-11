"use client";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cancelScan } from "@/lib/actions";
import { formatNumber } from "@/lib/format";
import { useApp } from "@/lib/store";

export function ScanScreen() {
  const site = useApp((s) => s.site);
  const progress = useApp((s) => s.progress);
  const libraryProgress = progress && progress.driveCount > 0 ? (progress.driveIndex + 1) / progress.driveCount : 0;

  return (
    <div className="grid min-h-svh place-items-center px-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          Scanne Site
        </div>
        <h1 className="mt-2 truncate text-2xl font-semibold tracking-tight">{site?.name}</h1>

        <div className="mt-8 text-5xl font-semibold tracking-tight tabular">{formatNumber(progress?.items ?? 0)}</div>
        <div className="mt-1 text-sm text-muted-foreground">Elemente erfasst</div>

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

        <Button variant="ghost" size="sm" className="mt-8 -ml-2.5 text-muted-foreground" onClick={cancelScan}>
          Abbrechen
        </Button>
      </div>
    </div>
  );
}
