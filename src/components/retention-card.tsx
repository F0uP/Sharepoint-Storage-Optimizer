"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ShieldIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage, loadPreservationHold } from "@/lib/actions";
import { formatBytes, formatNumber } from "@/lib/format";
import { useApp } from "@/lib/store";

/**
 * With retention policies, deleted files are kept in the hidden Preservation Hold Library and still
 * count against the quota – the most common reason why deleting "doesn't free anything".
 */
export function RetentionCard() {
  const mode = useApp((s) => s.mode);
  const [state, setState] = useState<{ bytes: number; files: number } | null | "loading" | undefined>(undefined);

  async function check() {
    setState("loading");
    try {
      setState(await loadPreservationHold());
    } catch (e) {
      setState(undefined);
      toast.error("Aufbewahrung konnte nicht geprüft werden", { description: errorMessage(e) });
    }
  }

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ShieldIcon className="size-4 text-muted-foreground" /> Aufbewahrung
      </div>
      {state === undefined || state === "loading" ? (
        <>
          <p className="mt-2 text-xs text-pretty text-muted-foreground">
            Gelten Aufbewahrungsrichtlinien, landen gelöschte Dateien in einer versteckten Bibliothek und belegen weiter Speicher.
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={check} disabled={state === "loading"}>
            {state === "loading" && <Spinner />} Aufbewahrungsbibliothek prüfen
          </Button>
        </>
      ) : state === null ? (
        <p className="mt-2 text-xs text-pretty text-muted-foreground">
          Keine Aufbewahrungsbibliothek – gelöschte Dateien geben den Speicher wie erwartet frei.
        </p>
      ) : (
        <>
          <div className="mt-2 text-2xl font-semibold tracking-tight" data-testid="preservation-hold">
            {formatBytes(state.bytes)}
          </div>
          <p className="mt-1 text-xs text-pretty text-muted-foreground">
            in {formatNumber(state.files)} Dateien der Aufbewahrungsbibliothek. Dieser Speicher wird erst nach Ablauf der
            Aufbewahrungsfrist frei – ändern können das nur Compliance-Administratoren im Microsoft Purview-Portal.
          </p>
        </>
      )}
      {mode === "live" && state === undefined && (
        <p className="mt-2 text-[11px] text-muted-foreground">Benötigt die SharePoint-Berechtigung AllSites.Manage.</p>
      )}
    </div>
  );
}
