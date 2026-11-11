"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArchiveIcon,
  HistoryIcon,
  KeyRoundIcon,
  Minimize2Icon,
  ScanEyeIcon,
  ShieldCheckIcon,
  SparklesIcon,
  Trash2Icon,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { FileTable, type FileRow } from "../file-table";
import { PageHeader } from "../page-header";
import { getAiStatus, runAiAnalysis, selectCandidates, type AiStatus } from "@/lib/ai";
import { errorMessage } from "@/lib/actions";
import { formatBytes, formatNumber, formatRelative } from "@/lib/format";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { AiAction, AiPriority, AiProviderInfo, SpFile } from "@/lib/types";

const ACTIONS: { value: AiAction; label: string; hint: string; icon: LucideIcon }[] = [
  { value: "delete", label: "Löschen", hint: "Verzichtbar", icon: Trash2Icon },
  { value: "clean_versions", label: "Versionen", hint: "Alte Versionen entfernen", icon: HistoryIcon },
  { value: "archive", label: "Archivieren", hint: "Selten genutzt, aufbewahren", icon: ArchiveIcon },
  { value: "compress", label: "Komprimieren", hint: "Medien verkleinern", icon: Minimize2Icon },
  { value: "review", label: "Prüfen", hint: "Manuell entscheiden", icon: ScanEyeIcon },
];

const PRIORITY: Record<AiPriority, { label: string; rank: number }> = {
  high: { label: "Hoch", rank: 3 },
  medium: { label: "Mittel", rank: 2 },
  low: { label: "Niedrig", rank: 1 },
};

function RecommendationCell({ priority, reason }: { priority: AiPriority; reason: string }) {
  return (
    <div className="min-w-0">
      <Badge variant={priority === "high" ? "default" : priority === "medium" ? "secondary" : "outline"} className="h-5 px-1.5 text-[11px]">
        {PRIORITY[priority].label}
      </Badge>
      <div className="mt-1 line-clamp-2 text-xs whitespace-normal text-muted-foreground" title={reason}>
        {reason}
      </div>
    </div>
  );
}

interface AiRow {
  action: AiAction;
  priority: AiPriority;
  row: FileRow;
}

export function AiView() {
  const scan = useApp((s) => s.scan)!;
  const ai = useApp((s) => s.ai);
  const setAi = useApp((s) => s.setAi);
  const dismissAi = useApp((s) => s.dismissAi);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [provider, setProvider] = useState<AiProviderInfo["id"] | undefined>();
  const [running, setRunning] = useState(false);
  const [action, setAction] = useState<AiAction>("delete");

  useEffect(() => {
    getAiStatus().then((s) => {
      setStatus(s);
      setProvider(s.providers[0]?.id);
    });
  }, []);

  const candidateCount = useMemo(() => selectCandidates(scan).files.length, [scan]);
  const activeProvider = status?.providers.find((p) => p.id === provider);

  async function analyze() {
    setRunning(true);
    try {
      const result = await runAiAnalysis(scan, provider);
      setAi(result);
      const first = ACTIONS.find((a) => result.recommendations.some((r) => r.action === a.value));
      if (first) setAction(first.value);
      toast.success(`${formatNumber(result.recommendations.length)} Empfehlungen erhalten`, {
        description: `${result.provider} · ${result.model}`,
      });
    } catch (e) {
      toast.error("KI-Analyse fehlgeschlagen", { description: errorMessage(e) });
    } finally {
      setRunning(false);
    }
  }

  const fileById = useMemo(() => new Map<string, SpFile>(scan.files.map((f) => [f.id, f])), [scan.files]);

  const allRows = useMemo<AiRow[]>(() => {
    if (!ai) return [];
    return ai.recommendations.flatMap((r) => {
      const file = fileById.get(r.fileId);
      if (!file) return [];
      const bytes = r.action === "clean_versions" ? (file.versionBytes ?? 0) : file.size;
      if (bytes <= 0) return [];
      return [
        {
          action: r.action,
          priority: r.priority,
          row: { id: file.id, file, bytes, rank: PRIORITY[r.priority].rank, tag: <RecommendationCell priority={r.priority} reason={r.reason} /> },
        },
      ];
    });
  }, [ai, fileById]);

  const stats = useMemo(() => {
    const m = new Map<AiAction, { count: number; bytes: number }>();
    for (const r of allRows) {
      const s = m.get(r.action) ?? { count: 0, bytes: 0 };
      s.count++;
      s.bytes += r.row.bytes;
      m.set(r.action, s);
    }
    return m;
  }, [allRows]);

  const current = useMemo(() => allRows.filter((r) => r.action === action), [allRows, action]);
  const rows = useMemo(() => current.map((r) => r.row), [current]);
  const quickSelect = useMemo(
    () => [
      { label: "Hohe Priorität", ids: current.filter((r) => r.priority === "high").map((r) => r.row.id) },
      { label: "Hoch + Mittel", ids: current.filter((r) => r.priority !== "low").map((r) => r.row.id) },
    ],
    [current],
  );
  const totalBytes = allRows.reduce((s, r) => s + r.row.bytes, 0);

  const runControls = (
    <div className="flex items-center gap-2">
      {status && status.providers.length > 1 && (
        <Select value={provider} onValueChange={(v) => setProvider(v as AiProviderInfo["id"])} disabled={running}>
          <SelectTrigger className="w-[190px]" aria-label="KI-Anbieter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {status.providers.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label} <span className="text-muted-foreground">{p.model}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Button onClick={analyze} disabled={running || !status?.configured}>
        {running ? <Spinner /> : <SparklesIcon />}
        {ai ? "Neu analysieren" : "Analyse starten"}
      </Button>
    </div>
  );

  return (
    <div>
      <PageHeader
        title="KI-Analyse"
        description="Ein Sprachmodell bewertet die relevantesten Dateien und schlägt konkret vor, was gelöscht, archiviert, komprimiert oder bereinigt werden kann."
        actions={status?.configured ? runControls : undefined}
      />

      {status && !status.configured && (
        <Empty className="rounded-xl border border-dashed py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <KeyRoundIcon />
            </EmptyMedia>
            <EmptyTitle>Noch kein KI-Anbieter verbunden</EmptyTitle>
            <EmptyDescription>
              Hinterlege einen API-Key für OpenAI oder Google Gemini in <code className="font-mono text-foreground">.env.local</code>{" "}
              und starte die App neu.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <pre className="rounded-lg border bg-muted/50 px-4 py-3 text-left font-mono text-xs">
              OPENAI_API_KEY=sk-…{"\n"}GEMINI_API_KEY=…
            </pre>
          </EmptyContent>
        </Empty>
      )}

      {status?.configured && !ai && !running && (
        <div className="rounded-xl border border-dashed px-6 py-16 text-center">
          <div className="mx-auto grid size-10 place-items-center rounded-lg bg-muted">
            <SparklesIcon className="size-5" />
          </div>
          <h3 className="mt-4 font-medium">Bereit für die Analyse</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-pretty text-muted-foreground">
            {formatNumber(candidateCount)} Kandidaten – die größten, ältesten und doppelten Dateien sowie große Versionsverläufe –
            werden mit {activeProvider?.label} ({activeProvider?.model}) bewertet.
          </p>
          <div className="mt-6 flex justify-center">{runControls}</div>
        </div>
      )}

      {running && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl border bg-card p-5 text-sm">
            <Spinner className="size-4" />
            <span>
              {activeProvider?.label} analysiert {formatNumber(candidateCount)} Dateien … das dauert meist 20–60 Sekunden.
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-80 rounded-xl" />
        </div>
      )}

      {ai && !running && (
        <div className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="rounded-xl border bg-card p-5">
              <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <SparklesIcon className="size-3.5" />
                {ai.provider} · {ai.model} · {formatNumber(ai.analyzedFiles)} Dateien bewertet · {formatRelative(ai.createdAt)}
              </div>
              <p className="mt-3 text-sm leading-relaxed text-pretty">{ai.summary}</p>
            </div>
            <div className="rounded-xl border bg-card p-5">
              <div className="text-xs text-muted-foreground">Empfohlenes Potenzial</div>
              <div className="mt-1 text-3xl font-semibold tracking-tight">{formatBytes(totalBytes)}</div>
              <div className="mt-1 text-xs text-muted-foreground">{formatNumber(allRows.length)} Dateien mit Empfehlung</div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5" role="tablist" aria-label="Empfohlene Aktion">
            {ACTIONS.map((a) => {
              const s = stats.get(a.value);
              const Icon = a.icon;
              const active = a.value === action;
              return (
                <button
                  key={a.value}
                  role="tab"
                  aria-selected={active}
                  disabled={!s}
                  onClick={() => setAction(a.value)}
                  className={cn(
                    "rounded-xl border bg-card p-4 text-left transition-colors hover:border-foreground/20 disabled:pointer-events-none disabled:opacity-50",
                    active && "border-foreground/40 ring-1 ring-foreground/10",
                  )}
                >
                  <div className="flex items-center justify-between text-sm font-medium">
                    {a.label}
                    <Icon className="size-4 text-muted-foreground" />
                  </div>
                  <div className="mt-3 text-xl font-semibold tracking-tight tabular">{s ? formatBytes(s.bytes) : "–"}</div>
                  <div className="text-xs text-muted-foreground">{s ? `${formatNumber(s.count)} Dateien · ${a.hint}` : a.hint}</div>
                </button>
              );
            })}
          </div>

          <FileTable
            key={action}
            rows={rows}
            action={action === "clean_versions" ? "versions" : "delete"}
            sizeLabel={action === "clean_versions" ? "Alte Versionen" : "Größe"}
            tagHeader="Priorität & Begründung"
            quickSelect={quickSelect}
            onDismiss={(ids) => {
              dismissAi(ids);
              toast(`${formatNumber(ids.length)} Empfehlungen ignoriert`);
            }}
            exportName="ki-empfehlungen"
            emptyTitle="Keine Empfehlungen"
            emptyDescription="Für diese Aktion gibt es (keine weiteren) Vorschläge."
          />

          {ai.tips.length > 0 && (
            <div>
              <h2 className="mb-3 text-sm font-medium">Generelle Empfehlungen</h2>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {ai.tips.map((tip, i) => (
                  <div key={i} className="rounded-xl border bg-card p-4">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs text-muted-foreground tabular">{String(i + 1).padStart(2, "0")}</span>
                      <h3 className="text-sm font-medium">{tip.title}</h3>
                    </div>
                    <p className="mt-1.5 text-sm text-pretty text-muted-foreground">{tip.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <p className="mt-8 flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldCheckIcon className="size-3.5 shrink-0" />
        An den KI-Anbieter werden nur Metadaten übertragen (Pfad, Name, Größe, Datum) – keine Dateiinhalte.
      </p>
    </div>
  );
}
