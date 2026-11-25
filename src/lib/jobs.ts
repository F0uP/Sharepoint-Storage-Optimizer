import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { toast } from "sonner";
import { latestScan } from "./actions";
import { isAppAuth } from "./auth";
import { generateDemoScan } from "./demo";
import { desktopBridge } from "./desktop";
import { formatBytes, formatNumber } from "./format";
import { addEntry, createEntry, loadHistory, saveHistory } from "./history";
import { groupByOwner } from "./notify";
import { BUILTIN_RULES, matchRule, useRules, type CleanupRule } from "./rules";
import { getSource } from "./source";
import { useApp } from "./store";
import type { SiteRef, SpFile } from "./types";

/**
 * Scheduled cleanup jobs: a rule applied to a site on a schedule. Jobs run while the app is open –
 * in the desktop app also in the background. Deleting always goes to the recycle bin and is capped.
 */

export type JobMode = "report" | "recycle" | "review";
export type JobSchedule = "daily" | "weekly";

export interface JobRun {
  at: string;
  matched: number;
  bytes: number;
  processed: number;
  ok: boolean;
  message: string;
}

export interface CleanupJob {
  id: string;
  name: string;
  ruleId: string;
  site: SiteRef;
  schedule: JobSchedule;
  mode: JobMode;
  maxFiles: number;
  enabled: boolean;
  demo: boolean;
  createdAt: string;
  nextRunAt: string;
  runs: JobRun[];
}

const DAY = 864e5;

/** Next run: tomorrow / in a week at 02:00 local time (nights are quiet in SharePoint). */
export function nextRunAfter(schedule: JobSchedule, from: Date): string {
  const next = new Date(from);
  next.setDate(next.getDate() + (schedule === "daily" ? 1 : 7));
  next.setHours(2, 0, 0, 0);
  return next.toISOString();
}

export function dueJobs(jobs: CleanupJob[], now = Date.now()): CleanupJob[] {
  return jobs.filter((j) => j.enabled && Date.parse(j.nextRunAt) <= now);
}

export const JOB_MODE_LABEL: Record<JobMode, string> = {
  report: "Nur berichten",
  recycle: "In den Papierkorb",
  review: "Besitzer fragen (Teams)",
};

interface JobsState {
  jobs: CleanupJob[];
  save(job: CleanupJob): void;
  remove(id: string): void;
  recordRun(id: string, run: JobRun): void;
}

export const useJobs = create<JobsState>()(
  persist(
    (set) => ({
      jobs: [],
      save: (job) =>
        set((s) => ({ jobs: s.jobs.some((j) => j.id === job.id) ? s.jobs.map((j) => (j.id === job.id ? job : j)) : [...s.jobs, job] })),
      remove: (id) => set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) })),
      recordRun: (id, run) =>
        set((s) => ({
          jobs: s.jobs.map((j) =>
            j.id === id ? { ...j, runs: [run, ...j.runs].slice(0, 10), nextRunAt: nextRunAfter(j.schedule, new Date(run.at)) } : j,
          ),
        })),
    }),
    {
      name: "spo:jobs",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ jobs: s.jobs.filter((j) => !j.demo) }),
    },
  ),
);

export function findRule(id: string): CleanupRule | undefined {
  return [...useRules.getState().custom, ...BUILTIN_RULES].find((r) => r.id === id);
}

function notify(title: string, body: string) {
  const bridge = desktopBridge();
  if (bridge) void bridge.notify(title, body);
  toast(title, { description: body });
}

/** Runs one job now: fresh scan of the site, rule, then report / recycle bin / review round. */
export async function runJob(job: CleanupJob): Promise<JobRun> {
  const at = new Date();
  const source = getSource(job.demo ? "demo" : "live");
  const rule = findRule(job.ruleId);
  let run: JobRun;
  try {
    if (!rule) throw new Error("Die Regel gibt es nicht mehr.");
    // live: cached file list plus the changes since – a job does not read the whole site again
    const scan = job.demo ? generateDemoScan(job.site) : await latestScan(job.site);
    const matched = matchRule(rule, scan.files, at.getTime()).toSorted((a, b) => b.size - a.size);
    const bytes = matched.reduce((s, f) => s + f.size, 0);
    let candidates = matched.slice(0, job.maxFiles);
    let processed = 0;
    let message: string;

    if (job.mode === "report" || !candidates.length) {
      message = matched.length ? `${formatNumber(matched.length)} Dateien (${formatBytes(bytes)}) gefunden.` : "Nichts gefunden.";
    } else {
      // protected files are never touched
      const labels = await source.getRetentionLabels(candidates).catch(() => new Map());
      candidates = candidates.filter((f) => labels.get(f.id)?.deleteAllowed !== false);
      if (job.mode === "recycle") {
        const result = await source.deleteFiles(candidates, false);
        processed = result.succeeded.length;
        await recordDeletion(job, candidates.filter((f) => result.succeeded.includes(f.id)), at);
        message = `${formatNumber(processed)} Dateien in den Papierkorb verschoben (${formatBytes(
          candidates.filter((f) => result.succeeded.includes(f.id)).reduce((s, f) => s + f.size, 0),
        )}).`;
      } else {
        const { startReview } = await import("./reviews");
        const app = useApp.getState();
        // review rounds belong to the site that is open – only start one there
        if (app.site?.id !== job.site.id) throw new Error("Für „Besitzer fragen“ muss die Site geöffnet sein.");
        const round = await startReview(groupByOwner(candidates).groups, {
          // Teams approvals need a signed-in user – with app access the owners get a mail
          channel: app.mode === "live" && isAppAuth() ? "mail" : "teams",
          days: 14,
          onTimeout: "delete",
          message: "Ein automatischer Aufräum-Job hat diese Dateien gefunden. Werden sie noch gebraucht?",
        });
        processed = round?.requests.reduce((s, r) => s + r.files.length, 0) ?? 0;
        message = `${formatNumber(round?.requests.length ?? 0)} Besitzer gefragt.`;
      }
    }
    run = { at: at.toISOString(), matched: matched.length, bytes, processed, ok: true, message };
  } catch (e) {
    run = { at: at.toISOString(), matched: 0, bytes: 0, processed: 0, ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  useJobs.getState().recordRun(job.id, run);
  return run;
}

async function recordDeletion(job: CleanupJob, files: SpFile[], at: Date) {
  if (!files.length) return;
  const entry = createEntry("delete", files, files.reduce((s, f) => s + f.size, 0), { permanent: false, note: `Job „${job.name}“` }, at);
  const app = useApp.getState();
  if (app.site?.id === job.site.id && app.scan) {
    app.removeFiles(
      files.map((f) => f.id),
      false,
    );
    app.pushHistory(entry);
  } else if (!job.demo) {
    saveHistory(job.site.id, addEntry(await loadHistory(job.site.id), entry));
  }
}

let running = false;

/** Runs every due job of the current mode (called on start, on a timer and by the desktop background check). */
export async function runDueJobs() {
  const { mode } = useApp.getState();
  if (!mode || running) return;
  running = true;
  try {
    for (const job of dueJobs(useJobs.getState().jobs.filter((j) => j.demo === (mode === "demo")))) {
      const run = await runJob(job);
      notify(`Aufräum-Job „${job.name}“`, run.message);
    }
  } finally {
    running = false;
  }
}

export function newJob(rule: CleanupRule, site: SiteRef, demo: boolean): CleanupJob {
  const now = new Date();
  return {
    id: `job-${now.getTime().toString(36)}`,
    name: `${rule.name} – ${site.name}`,
    ruleId: rule.id,
    site,
    schedule: "weekly",
    mode: "report",
    maxFiles: 200,
    enabled: true,
    demo,
    createdAt: now.toISOString(),
    nextRunAt: nextRunAfter("weekly", now),
    runs: [],
  };
}

export function daysUntil(iso: string, now = Date.now()) {
  return Math.max(0, Math.round((Date.parse(iso) - now) / DAY));
}
