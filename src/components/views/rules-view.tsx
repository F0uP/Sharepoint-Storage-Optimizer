"use client";

import { useMemo, useState } from "react";
import { CopyPlusIcon, ListFilterIcon, PencilIcon, PlusIcon, Trash2Icon, ZapIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BulkActionDialog } from "../bulk-action-dialog";
import { RuleEditorDialog } from "../dialogs/rule-editor-dialog";
import { FileTable, type FileRow } from "../file-table";
import { PageHeader } from "../page-header";
import { formatBytes, formatNumber } from "@/lib/format";
import { BUILTIN_RULES, describeRule, duplicateCopyIds, matchRule, useRules, type CleanupRule } from "@/lib/rules";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

interface RuleMatch {
  rule: CleanupRule;
  rows: FileRow[];
  bytes: number;
}

function RuleItem({ match, active, onClick }: { match: RuleMatch; active: boolean; onClick(): void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted/60",
        active && "bg-muted hover:bg-muted",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{match.rule.name}</div>
        <div className="text-xs text-muted-foreground">
          {formatNumber(match.rows.length)} {match.rows.length === 1 ? "Datei" : "Dateien"}
        </div>
      </div>
      <div className={cn("text-sm font-medium tabular", match.bytes === 0 && "text-muted-foreground")}>{formatBytes(match.bytes)}</div>
    </button>
  );
}

export function RulesView() {
  const scan = useApp((s) => s.scan)!;
  const custom = useRules((s) => s.custom);
  const remove = useRules((s) => s.remove);
  const [activeId, setActiveId] = useState<string>(custom[0]?.id ?? BUILTIN_RULES[0].id);
  const [editing, setEditing] = useState<CleanupRule | null | undefined>(undefined);
  const [applyOpen, setApplyOpen] = useState(false);

  const now = Date.parse(scan.scannedAt);
  const matches = useMemo(() => {
    const dups = duplicateCopyIds(scan.files);
    const toMatch = (rule: CleanupRule): RuleMatch => {
      const rows = matchRule(rule, scan.files, now, dups).map((f) => ({ id: f.id, file: f, bytes: f.size }));
      return { rule, rows, bytes: rows.reduce((s, r) => s + r.bytes, 0) };
    };
    return { custom: custom.map(toMatch), builtin: BUILTIN_RULES.map(toMatch) };
  }, [scan.files, custom, now]);

  const all = [...matches.custom, ...matches.builtin];
  const active = all.find((m) => m.rule.id === activeId) ?? all[0];
  const conditions = describeRule(active.rule);

  return (
    <div>
      <PageHeader
        title="Regeln"
        description="Aufräum-Profile: einmal festlegen, bei jedem Scan mit einem Klick anwenden. Vorlagen lassen sich kopieren und anpassen."
        actions={
          <Button onClick={() => setEditing(null)}>
            <PlusIcon /> Neue Regel
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-4">
          {matches.custom.length > 0 && (
            <div>
              <div className="mb-1.5 px-1 text-xs font-medium text-muted-foreground">Eigene Regeln</div>
              <nav className="flex flex-col gap-0.5 rounded-xl border bg-card p-1.5">
                {matches.custom.map((m) => (
                  <RuleItem key={m.rule.id} match={m} active={m.rule.id === active.rule.id} onClick={() => setActiveId(m.rule.id)} />
                ))}
              </nav>
            </div>
          )}
          <div>
            <div className="mb-1.5 px-1 text-xs font-medium text-muted-foreground">Vorlagen</div>
            <nav className="flex flex-col gap-0.5 rounded-xl border bg-card p-1.5">
              {matches.builtin.map((m) => (
                <RuleItem key={m.rule.id} match={m} active={m.rule.id === active.rule.id} onClick={() => setActiveId(m.rule.id)} />
              ))}
            </nav>
          </div>
        </aside>

        <section className="min-w-0">
          <div className="mb-4 flex flex-wrap items-start gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg border bg-card">
              <ListFilterIcon className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="flex items-center gap-2 font-semibold">
                {active.rule.name}
                {active.rule.builtin && <Badge variant="secondary">Vorlage</Badge>}
              </h2>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {conditions.map((c) => (
                  <Badge key={c} variant="outline" className="font-normal">
                    {c}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {active.rule.builtin ? (
                <Button variant="ghost" size="sm" onClick={() => setEditing(active.rule)}>
                  <CopyPlusIcon /> Anpassen
                </Button>
              ) : (
                <>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(active.rule)}>
                    <PencilIcon /> Bearbeiten
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      remove(active.rule.id);
                      setActiveId(BUILTIN_RULES[0].id);
                    }}
                  >
                    <Trash2Icon /> Entfernen
                  </Button>
                </>
              )}
              <Button
                size="sm"
                className="bg-destructive text-white hover:bg-destructive/90"
                disabled={!active.rows.length}
                onClick={() => setApplyOpen(true)}
              >
                <ZapIcon /> Anwenden · {formatBytes(active.bytes)}
              </Button>
            </div>
          </div>

          <FileTable
            key={active.rule.id}
            rows={active.rows}
            action="delete"
            exportName={`regel-${active.rule.name}`}
            emptyTitle="Keine Treffer"
            emptyDescription="Diese Regel trifft in der aktuellen Site auf keine Dateien zu."
          />
        </section>
      </div>

      <BulkActionDialog open={applyOpen} onOpenChange={setApplyOpen} rows={active.rows} action="delete" onDone={() => {}} />
      {editing !== undefined && (
        <RuleEditorDialog
          rule={editing}
          onClose={(saved) => {
            setEditing(undefined);
            if (saved) setActiveId(saved.id);
          }}
        />
      )}
    </div>
  );
}
