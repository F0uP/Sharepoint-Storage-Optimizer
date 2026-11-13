"use client";

import { useMemo, useState } from "react";
import { ArrowRightIcon, HistoryIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { FileTable } from "../file-table";
import { PageHeader } from "../page-header";
import { RecycleBinButton } from "../recycle-bin-button";
import { VersionLimitsCard } from "../version-limits-card";
import { INSIGHT_ICONS } from "../insight-icons";
import { useInsights } from "@/hooks/use-insights";
import { scanVersionsAction } from "@/lib/actions";
import type { Insight } from "@/lib/analysis";
import { formatBytes, formatNumber } from "@/lib/format";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

function VersionScanPrompt() {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  async function run() {
    setProgress({ done: 0, total: 1 });
    await scanVersionsAction((done, total) => setProgress({ done, total }));
    setProgress(null);
  }
  return (
    <div className="grid place-items-center rounded-xl border border-dashed px-6 py-16 text-center">
      <div className="max-w-sm">
        <div className="mx-auto grid size-10 place-items-center rounded-lg bg-muted">
          <HistoryIcon className="size-5" />
        </div>
        <h3 className="mt-4 font-medium">Versionsverlauf analysieren</h3>
        <p className="mt-1 text-sm text-pretty text-muted-foreground">
          SharePoint speichert bis zu 500 Versionen pro Datei – das ist oft der größte unsichtbare Speicherfresser. Geprüft werden
          die größten Dateien und Office-Dokumente.
        </p>
        {progress ? (
          <div className="mt-6 space-y-2">
            <Progress value={(progress.done / Math.max(1, progress.total)) * 100} />
            <div className="text-xs text-muted-foreground tabular">
              {formatNumber(progress.done)} von {formatNumber(progress.total)} Dateien geprüft
            </div>
          </div>
        ) : (
          <Button className="mt-6" onClick={run}>
            Jetzt analysieren
          </Button>
        )}
      </div>
    </div>
  );
}

/** Insights that need a separate analysis step before they can show anything. */
function isInsightPending(i: Insight, versionsScanned: boolean, hasAi: boolean) {
  return (i.id === "versions" && !versionsScanned) || (i.id === "ai" && !hasAi);
}

function AiPrompt() {
  const setView = useApp((s) => s.setView);
  return (
    <div className="grid place-items-center rounded-xl border border-dashed px-6 py-16 text-center">
      <div className="max-w-sm">
        <div className="mx-auto grid size-10 place-items-center rounded-lg bg-muted">
          <SparklesIcon className="size-5" />
        </div>
        <h3 className="mt-4 font-medium">Noch keine KI-Analyse</h3>
        <p className="mt-1 text-sm text-pretty text-muted-foreground">
          Lass OpenAI oder Gemini die relevantesten Dateien bewerten. Die Löschempfehlungen erscheinen danach hier – mit Begründung.
        </p>
        <Button className="mt-6" onClick={() => setView("ai")}>
          Zur KI-Analyse <ArrowRightIcon />
        </Button>
      </div>
    </div>
  );
}

function InsightListItem({ insight, active, pending, onClick }: { insight: Insight; active: boolean; pending: boolean; onClick(): void }) {
  const Icon = INSIGHT_ICONS[insight.id];
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted/60",
        active && "bg-muted hover:bg-muted",
      )}
    >
      <Icon className={cn("size-4 shrink-0 text-muted-foreground", active && "text-foreground")} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{insight.title}</div>
        <div className="text-xs text-muted-foreground">
          {pending ? "Noch nicht analysiert" : `${formatNumber(insight.rows.length)} ${insight.rows.length === 1 ? "Datei" : "Dateien"}`}
        </div>
      </div>
      <div className={cn("text-sm font-medium tabular", (pending || insight.savings === 0) && "text-muted-foreground")}>
        {pending ? "–" : formatBytes(insight.savings)}
      </div>
    </button>
  );
}

export function OptimizeView() {
  const scan = useApp((s) => s.scan)!;
  const preset = useApp((s) => s.preset);
  const ai = useApp((s) => s.ai);
  const { insights, potential } = useInsights();
  const versionsScanned = Boolean(scan.versionsScannedAt);
  const hasAi = Boolean(ai);
  const isPending = (i: Insight) => isInsightPending(i, versionsScanned, hasAi);

  const sorted = useMemo(
    () =>
      insights.toSorted(
        (a, b) =>
          Number(isInsightPending(a, versionsScanned, hasAi)) - Number(isInsightPending(b, versionsScanned, hasAi)) ||
          b.savings - a.savings,
      ),
    [insights, versionsScanned, hasAi],
  );
  const [activeId, setActiveId] = useState<string>(preset?.insight ?? sorted.find((i) => i.rows.length)?.id ?? "duplicates");
  const active = insights.find((i) => i.id === activeId) ?? sorted[0];
  const rows = useMemo(() => active.rows.map((r) => ({ id: r.file.id, file: r.file, bytes: r.bytes, note: r.note })), [active]);
  const Icon = INSIGHT_ICONS[active.id];
  const recycle = scan.quota?.deleted ?? 0;

  return (
    <div>
      <PageHeader
        title="Optimierungen"
        description="Automatisch erkannte Einsparmöglichkeiten. Wähle eine Kategorie, markiere die Dateien und gib Speicher frei."
      />

      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-4">
          <div className="rounded-xl border bg-card p-4">
            <div className="text-xs text-muted-foreground">Mögliche Einsparung</div>
            <div className="mt-1 text-3xl font-semibold tracking-tight">{formatBytes(potential.bytes)}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {formatNumber(potential.files)} Dateien{recycle > 0 ? " + Papierkorb" : ""}
              {!versionsScanned ? " · ohne Versionen" : ""}
            </div>
            <div className="mt-3 border-t pt-3 text-xs text-muted-foreground">
              Davon risikoarm: <span className="font-medium text-foreground">{formatBytes(potential.safeBytes)}</span>
              <br />
              Duplikate, Temp-Dateien, Versionen, Papierkorb
            </div>
          </div>

          <nav className="flex flex-col gap-0.5 rounded-xl border bg-card p-1.5">
            {sorted.map((i) => (
              <InsightListItem
                key={i.id}
                insight={i}
                active={i.id === active.id}
                pending={isPending(i)}
                onClick={() => setActiveId(i.id)}
              />
            ))}
          </nav>

          {scan.quota && (
            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Trash2Icon className="size-4 text-muted-foreground" /> Papierkorb
              </div>
              <div className="mt-2 text-2xl font-semibold tracking-tight">{formatBytes(recycle)}</div>
              <p className="mt-1 text-xs text-pretty text-muted-foreground">
                Gelöschte Dateien zählen bis zu 93 Tage weiter zum Speicherkontingent.
              </p>
              <div className="mt-3">
                <RecycleBinButton />
              </div>
            </div>
          )}
        </aside>

        <section className="min-w-0">
          <div className="mb-4 flex items-start gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg border bg-card">
              <Icon className="size-4" />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold">{active.title}</h2>
              <p className="text-sm text-pretty text-muted-foreground">{active.description}</p>
            </div>
          </div>

          {active.id === "versions" && !versionsScanned ? (
            <VersionScanPrompt />
          ) : active.id === "ai" && !ai ? (
            <AiPrompt />
          ) : (
            <FileTable
              key={active.id}
              rows={rows}
              action={active.action}
              sizeLabel={active.action === "versions" ? "Alte Versionen" : "Größe"}
              exportName={`optimierung-${active.id}`}
              emptyTitle="Nichts gefunden"
              emptyDescription="In dieser Kategorie gibt es aktuell keine Einsparmöglichkeiten."
            />
          )}
          {active.id === "versions" && <VersionLimitsCard />}
        </section>
      </div>
    </div>
  );
}
