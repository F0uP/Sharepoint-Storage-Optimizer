"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FileDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useInsights } from "@/hooks/use-insights";
import { errorMessage } from "@/lib/actions";
import { potential as potentialOf } from "@/lib/analysis";
import { pricePerGb } from "@/lib/costs";
import type { FolderTree } from "@/lib/folders";
import { useSettings } from "@/lib/settings";
import { useApp } from "@/lib/store";

export function useReport() {
  const { insights, potential } = useInsights();
  const [busy, setBusy] = useState(false);

  async function generate() {
    const { scan, history, trend, ai, mode } = useApp.getState();
    if (!scan) return;
    setBusy(true);
    try {
      // react-pdf is only loaded when a report is actually created
      const { downloadReport } = await import("@/lib/report/generate");
      await downloadReport({
        scan,
        insights,
        potential,
        history,
        trend,
        ai,
        generatedAt: new Date(),
        demo: mode === "demo",
        price: pricePerGb(useSettings.getState().settings),
      });
      toast.success("Bericht erstellt", { description: "Das PDF wurde heruntergeladen." });
    } catch (e) {
      toast.error("Bericht konnte nicht erstellt werden", { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return { generate, busy };
}

/** Report on a single folder (subfolders included); `busy` is the path being rendered. */
export function useFolderReport() {
  const { insights } = useInsights();
  const [busy, setBusy] = useState<string | null>(null);

  async function generate(path: string, tree?: FolderTree) {
    const { scan, mode } = useApp.getState();
    if (!scan || busy) return;
    setBusy(path);
    try {
      const [{ downloadFolderReport }, { folderTree, summarizeFolder }] = await Promise.all([
        import("@/lib/report/generate"),
        import("@/lib/folders"),
      ]);
      const folders = tree ?? folderTree(scan.files);
      const summary = summarizeFolder(scan.files, folders, path, insights, Date.parse(scan.scannedAt));
      if (!summary) throw new Error("Den Ordner gibt es nicht mehr – die Site wurde inzwischen aktualisiert.");
      await downloadFolderReport({
        site: scan.site,
        scannedAt: scan.scannedAt,
        summary,
        potential: potentialOf(summary.insights),
        siteBytes: folders.roots.reduce((s, r) => s + r.bytes, 0),
        generatedAt: new Date(),
        demo: mode === "demo",
        price: pricePerGb(useSettings.getState().settings),
      });
      toast.success(`Bericht für „${summary.folder.name}“ erstellt`, { description: "Das PDF wurde heruntergeladen." });
    } catch (e) {
      toast.error("Ordnerbericht konnte nicht erstellt werden", { description: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  return { generate, busy };
}

export function ReportButton() {
  const { generate, busy } = useReport();
  return (
    <Button variant="outline" size="sm" onClick={generate} disabled={busy} data-tour="report" aria-label="Bericht">
      {busy ? <Spinner /> : <FileDownIcon />} <span className="hidden xl:inline">Bericht</span>
    </Button>
  );
}
