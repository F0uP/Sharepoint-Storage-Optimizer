"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CATEGORY_META, CATEGORY_ORDER } from "@/lib/file-types";
import { formatBytes, formatNumber } from "@/lib/format";
import { matchRule, newRuleId, useRules, type CleanupRule } from "@/lib/rules";
import { useApp } from "@/lib/store";
import type { FileCategory } from "@/lib/types";

interface Props {
  rule: CleanupRule | null;
  onClose(saved?: CleanupRule): void;
}

const AGES = [
  { value: "0", label: "Egal" },
  { value: "1", label: "1 Monat" },
  { value: "3", label: "3 Monate" },
  { value: "6", label: "6 Monate" },
  { value: "12", label: "1 Jahr" },
  { value: "24", label: "2 Jahre" },
  { value: "36", label: "3 Jahre" },
  { value: "60", label: "5 Jahre" },
];

export function RuleEditorDialog({ rule, onClose }: Props) {
  const files = useApp((s) => s.scan?.files ?? []);
  const save = useRules((s) => s.save);
  const editing = Boolean(rule && !rule.builtin);
  const [draft, setDraft] = useState<CleanupRule>(() =>
    rule
      ? { ...rule, id: rule.builtin ? newRuleId() : rule.id, name: rule.builtin ? `${rule.name} (Kopie)` : rule.name, builtin: false }
      : { id: newRuleId(), name: "", categories: [], extensions: [] },
  );
  const [extensions, setExtensions] = useState(draft.extensions.join(", "));
  const patch = (p: Partial<CleanupRule>) => setDraft((d) => ({ ...d, ...p }));

  const effective = useMemo<CleanupRule>(
    () => ({
      ...draft,
      extensions: extensions
        .split(/[,;\s]+/)
        .map((e) => e.trim().replace(/^\./, "").toLowerCase())
        .filter(Boolean),
    }),
    [draft, extensions],
  );
  const matches = useMemo(() => matchRule(effective, files), [effective, files]);
  const bytes = matches.reduce((s, f) => s + f.size, 0);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!effective.name.trim()) return;
    const clean = { ...effective, name: effective.name.trim() };
    save(clean);
    onClose(clean);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[min(880px,92svh)] flex-col overflow-hidden sm:max-w-lg">
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-4">
          <DialogHeader className="text-left">
            <DialogTitle>{editing ? "Regel bearbeiten" : "Neue Regel"}</DialogTitle>
            <DialogDescription>Alle Bedingungen müssen zutreffen. Leere Felder werden ignoriert.</DialogDescription>
          </DialogHeader>

          <div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 pb-1">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="rule-name">Name</FieldLabel>
                <Input id="rule-name" value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder="z. B. Alte Messevideos" autoFocus />
              </Field>
              <Field>
                <FieldLabel>Dateitypen</FieldLabel>
                <ToggleGroup
                  type="multiple"
                  variant="outline"
                  size="sm"
                  value={draft.categories}
                  onValueChange={(v) => patch({ categories: v as FileCategory[] })}
                  className="flex-wrap"
                >
                  {CATEGORY_ORDER.map((c) => (
                    <ToggleGroupItem key={c} value={c}>
                      {CATEGORY_META[c].plural}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="rule-ext">Dateiendungen</FieldLabel>
                  <Input id="rule-ext" value={extensions} onChange={(e) => setExtensions(e.target.value)} placeholder="zip, iso, mov" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="rule-pattern">Dateiname</FieldLabel>
                  <Input
                    id="rule-pattern"
                    value={draft.namePattern ?? ""}
                    onChange={(e) => patch({ namePattern: e.target.value })}
                    placeholder="*Export*; *.bak"
                  />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="rule-path">Pfad enthält</FieldLabel>
                <Input id="rule-path" value={draft.pathContains ?? ""} onChange={(e) => patch({ pathContains: e.target.value })} placeholder="Archiv/2019" />
                <FieldDescription>Muster mit * und ?; mehrere Namensmuster mit Semikolon trennen.</FieldDescription>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="rule-size">Mindestgröße (MB)</FieldLabel>
                  <Input
                    id="rule-size"
                    type="number"
                    min={0}
                    value={draft.minSizeMB ?? ""}
                    onChange={(e) => patch({ minSizeMB: e.target.value ? Math.max(0, Number(e.target.value)) : undefined })}
                    placeholder="0"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="rule-age">Nicht geändert seit</FieldLabel>
                  <Select
                    value={String(draft.olderThanMonths ?? 0)}
                    onValueChange={(v) => patch({ olderThanMonths: Number(v) || undefined })}
                  >
                    <SelectTrigger id="rule-age" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AGES.map((a) => (
                        <SelectItem key={a.value} value={a.value}>
                          {a.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <div className="flex flex-col gap-3 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="rule-dups" className="font-normal">
                    Nur doppelte Dateien (das Original bleibt)
                  </Label>
                  <Switch id="rule-dups" checked={Boolean(draft.duplicatesOnly)} onCheckedChange={(v) => patch({ duplicatesOnly: v })} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="rule-rec" className="font-normal">
                    Nur Teams-Aufnahmen
                  </Label>
                  <Switch id="rule-rec" checked={Boolean(draft.teamsRecordingsOnly)} onCheckedChange={(v) => patch({ teamsRecordingsOnly: v })} />
                </div>
              </div>
            </FieldGroup>
          </div>

          <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm" aria-live="polite">
            Trifft aktuell auf <span className="font-medium tabular">{formatNumber(matches.length)} Dateien</span> mit{" "}
            <span className="font-medium tabular">{formatBytes(bytes)}</span> zu.
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onClose()}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={!draft.name.trim()}>
              Regel speichern
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
