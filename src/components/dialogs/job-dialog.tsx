"use client";

import { useState } from "react";
import { CircleAlertIcon, CircleCheckIcon, PlayIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { isAppAuth } from "@/lib/auth";
import { formatDate, formatRelative } from "@/lib/format";
import { JOB_MODE_LABEL, nextRunAfter, runJob, useJobs, type CleanupJob, type JobMode, type JobSchedule } from "@/lib/jobs";
import { useApp } from "@/lib/store";

export function JobDialog({ job, onClose }: { job: CleanupJob; onClose(): void }) {
  const save = useJobs((s) => s.save);
  const remove = useJobs((s) => s.remove);
  const stored = useJobs((s) => s.jobs.find((j) => j.id === job.id));
  const isNew = !stored;
  const [draft, setDraft] = useState(job);
  const [running, setRunning] = useState(false);
  const runs = stored?.runs ?? [];
  const patch = (p: Partial<CleanupJob>) => setDraft((d) => ({ ...d, ...p }));
  const appAccess = useApp((s) => s.mode) === "live" && isAppAuth();

  function persist() {
    const scheduleChanged = draft.schedule !== stored?.schedule;
    const next = { ...draft, name: draft.name.trim() || job.name, nextRunAt: scheduleChanged ? nextRunAfter(draft.schedule, new Date()) : draft.nextRunAt };
    save(next);
    return next;
  }

  async function runNow() {
    setRunning(true);
    try {
      await runJob(persist());
    } finally {
      setRunning(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !running && onClose()}>
      <DialogContent className="flex max-h-[min(880px,92svh)] flex-col overflow-hidden sm:max-w-lg">
        <DialogHeader className="text-left">
          <DialogTitle>{isNew ? "Regel automatisieren" : "Aufräum-Job"}</DialogTitle>
          <DialogDescription>
            Läuft automatisch, solange die App geöffnet ist – in der Desktop-App auch im Hintergrund. Gelöscht wird nur in den
            Papierkorb, geschützte Dateien werden übersprungen.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="job-name">Name</FieldLabel>
              <Input id="job-name" value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
              <FieldDescription>Site: {draft.site.name}</FieldDescription>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="job-schedule">Zeitplan</FieldLabel>
                <Select value={draft.schedule} onValueChange={(v) => patch({ schedule: v as JobSchedule })}>
                  <SelectTrigger id="job-schedule" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Täglich (nachts)</SelectItem>
                    <SelectItem value="weekly">Wöchentlich</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="job-max">Höchstens pro Lauf</FieldLabel>
                <Select value={String(draft.maxFiles)} onValueChange={(v) => patch({ maxFiles: Number(v) })}>
                  <SelectTrigger id="job-max" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[50, 200, 1000].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n} Dateien
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="job-mode">Aktion</FieldLabel>
              <Select value={draft.mode} onValueChange={(v) => patch({ mode: v as JobMode })}>
                <SelectTrigger id="job-mode" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(JOB_MODE_LABEL) as JobMode[]).map((m) => (
                    <SelectItem key={m} value={m}>
                      {JOB_MODE_LABEL[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                {draft.mode === "report"
                  ? "Meldet nur, was die Regel findet – ideal zum Ausprobieren."
                  : draft.mode === "recycle"
                    ? "Verschiebt die Treffer in den Papierkorb; im Verlauf rückgängig zu machen."
                    : appAccess
                      ? "Fragt die Besitzer per E-Mail; ihre Antworten trägst du unter „Freigaben“ ein."
                      : "Startet eine Freigabe in Teams; zugestimmte Dateien werden danach gelöscht."}
              </FieldDescription>
            </Field>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="job-enabled">Aktiv</FieldLabel>
                <FieldDescription>
                  {draft.enabled ? `Nächster Lauf ${formatRelative(draft.nextRunAt)} (${formatDate(draft.nextRunAt)})` : "Pausiert"}
                </FieldDescription>
              </FieldContent>
              <Switch id="job-enabled" checked={draft.enabled} onCheckedChange={(v) => patch({ enabled: v })} />
            </Field>

            {runs.length > 0 && (
              <div>
                <div className="mb-2 text-sm font-medium">Letzte Läufe</div>
                <ul className="space-y-2 text-xs">
                  {runs.map((r) => (
                    <li key={r.at} className="flex items-start gap-2">
                      {r.ok ? (
                        <CircleCheckIcon className="mt-px size-3.5 shrink-0 text-success" />
                      ) : (
                        <CircleAlertIcon className="mt-px size-3.5 shrink-0 text-destructive" />
                      )}
                      <span className="min-w-0 flex-1">{r.message}</span>
                      <span className="shrink-0 text-muted-foreground">{formatRelative(r.at)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </FieldGroup>
        </div>

        <DialogFooter className="sm:justify-between">
          {!isNew ? (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => {
                remove(job.id);
                onClose();
              }}
              disabled={running}
            >
              <Trash2Icon /> Job löschen
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" onClick={runNow} disabled={running}>
              {running ? <Spinner /> : <PlayIcon />} Jetzt ausführen
            </Button>
            <Button
              onClick={() => {
                persist();
                onClose();
              }}
              disabled={running}
            >
              {isNew ? "Job anlegen" : "Speichern"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
