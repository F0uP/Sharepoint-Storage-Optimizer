"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FileDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useInsights } from "@/hooks/use-insights";
import { errorMessage } from "@/lib/actions";
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
      await downloadReport({ scan, insights, potential, history, trend, ai, generatedAt: new Date(), demo: mode === "demo" });
      toast.success("Bericht erstellt", { description: "Das PDF wurde heruntergeladen." });
    } catch (e) {
      toast.error("Bericht konnte nicht erstellt werden", { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return { generate, busy };
}

export function ReportButton() {
  const { generate, busy } = useReport();
  return (
    <Button variant="outline" size="sm" onClick={generate} disabled={busy} data-tour="report">
      {busy ? <Spinner /> : <FileDownIcon />} Bericht
    </Button>
  );
}
