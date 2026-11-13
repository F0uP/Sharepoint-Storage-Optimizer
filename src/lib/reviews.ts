import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { del as idbDel, get as idbGet, set as idbSet } from "idb-keyval";
import { toast } from "sonner";
import { formatBytes, formatDate, formatNumber } from "./format";
import { addEntry, createEntry, loadHistory, saveHistory, type HistoryEntry } from "./history";
import { buildOwnerMail, type OwnerGroup } from "./notify";
import { getSource } from "./source";
import { useApp } from "./store";
import type { SiteRef, SpFile } from "./types";

/**
 * Review rounds ("Freigaben"): owners decide whether their files may be deleted – in the Teams app
 * "Approvals" (Graph beta) or by replying to a mail (decision entered by hand). Approved files, and
 * files without an answer after the deadline if so configured, are moved to the recycle bin.
 */

export type ReviewState = "pending" | "approved" | "rejected" | "expired" | "deleted" | "kept" | "failed";

export interface ReviewRequest {
  ownerName: string;
  ownerEmail: string;
  ownerId?: string;
  channel: "teams" | "mail";
  approvalId?: string;
  files: SpFile[];
  bytes: number;
  state: ReviewState;
  decidedAt?: string;
  error?: string;
}

export interface ReviewRound {
  id: string;
  createdAt: string;
  deadline: string;
  site: SiteRef;
  /** what happens with files nobody answered for */
  onTimeout: "delete" | "keep";
  demo: boolean;
  requests: ReviewRequest[];
}

/* ------------------------------------------------------------ pure helpers */

/** Maps the state of a Teams approval to the request state. */
export function fromApproval(approval: { state: string; result?: string }): ReviewState | null {
  if (approval.state === "canceled") return "kept";
  if (approval.state !== "completed") return null;
  return /^approve/i.test(approval.result ?? "") ? "approved" : "rejected";
}

/** Pending requests become "expired" after the deadline. */
export function expire(round: ReviewRound, now = Date.now()): ReviewRound {
  if (now < Date.parse(round.deadline)) return round;
  return { ...round, requests: round.requests.map((r) => (r.state === "pending" ? { ...r, state: "expired" } : r)) };
}

/** Requests whose files are now deleted, and those that are settled by keeping the files. */
export function decisions(round: ReviewRound): { toDelete: ReviewRequest[]; toKeep: ReviewRequest[] } {
  const toDelete = round.requests.filter((r) => r.state === "approved" || (r.state === "expired" && round.onTimeout === "delete"));
  const toKeep = round.requests.filter((r) => r.state === "rejected" || (r.state === "expired" && round.onTimeout === "keep"));
  return { toDelete, toKeep };
}

export function summarize(round: ReviewRound) {
  const count = (states: ReviewState[]) => round.requests.filter((r) => states.includes(r.state)).length;
  return {
    pending: count(["pending"]),
    approved: count(["approved", "deleted"]),
    rejected: count(["rejected", "kept"]),
    deletedBytes: round.requests.filter((r) => r.state === "deleted").reduce((s, r) => s + r.bytes, 0),
    open: round.requests.some((r) => r.state === "pending" || r.state === "approved" || r.state === "expired"),
  };
}

/* ------------------------------------------------------------------ store */

const idbStorage: StateStorage = {
  getItem: async (name) => (await idbGet<string>(name)) ?? null,
  setItem: (name, value) => idbSet(name, value),
  removeItem: (name) => idbDel(name),
};

interface ReviewsState {
  rounds: ReviewRound[];
  add(round: ReviewRound): void;
  update(id: string, fn: (round: ReviewRound) => ReviewRound): void;
  remove(id: string): void;
}

export const useReviews = create<ReviewsState>()(
  persist(
    (set) => ({
      rounds: [],
      add: (round) => set((s) => ({ rounds: [round, ...s.rounds] })),
      update: (id, fn) => set((s) => ({ rounds: s.rounds.map((r) => (r.id === id ? fn(r) : r)) })),
      remove: (id) => set((s) => ({ rounds: s.rounds.filter((r) => r.id !== id) })),
    }),
    {
      name: "spo:reviews",
      storage: createJSONStorage(() => idbStorage),
      // demo rounds only live as long as the demo session
      partialize: (s) => ({ rounds: s.rounds.filter((r) => !r.demo) }),
    },
  ),
);

/* ---------------------------------------------------------------- actions */

const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;

function approvalDescription(group: OwnerGroup, site: SiteRef, deadline: Date) {
  const lines = group.files
    .toSorted((a, b) => b.size - a.size)
    .slice(0, 10)
    .map((f) => `• ${f.name} (${formatBytes(f.size)}) – ${f.path}`);
  const more = group.files.length > 10 ? [`… und ${group.files.length - 10} weitere`] : [];
  return [
    `Im SharePoint „${site.name}“ wird Speicher frei gemacht. Diese Dateien hast du zuletzt bearbeitet:`,
    ...lines,
    ...more,
    "",
    `Zustimmen = die Dateien werden in den Papierkorb verschoben (93 Tage wiederherstellbar). Ablehnen = sie bleiben. Bitte bis ${formatDate(deadline.toISOString())} entscheiden.`,
  ].join("\n");
}

/** Starts a review round for the current site. Owners without Entra id are asked by mail. */
export async function startReview(
  groups: OwnerGroup[],
  options: { channel: "teams" | "mail"; days: number; onTimeout: "delete" | "keep"; message: string },
): Promise<ReviewRound | undefined> {
  const { mode, site } = useApp.getState();
  if (!mode || !site) return;
  const source = getSource(mode);
  const deadline = new Date(Date.now() + options.days * 864e5);
  const roundId = `r${Date.now().toString(36)}`;
  const requests: ReviewRequest[] = [];

  for (const group of groups) {
    const ownerId = group.files.find((f) => f.modifiedById)?.modifiedById;
    const base = { ownerName: group.name, ownerEmail: group.email, ownerId, files: group.files, bytes: group.bytes, state: "pending" as const };
    if (options.channel === "teams" && ownerId) {
      try {
        const approvalId = await source.createApproval({
          title: `Speicher freigeben: ${plural(group.files.length, "Datei", "Dateien")} (${formatBytes(group.bytes)}) in „${site.name}“ · ${roundId}-${requests.length}`,
          description: approvalDescription(group, site, deadline),
          approver: { id: ownerId, name: group.name },
        });
        requests.push({ ...base, channel: "teams", approvalId });
        continue;
      } catch (e) {
        requests.push({ ...base, channel: "teams", state: "failed", error: e instanceof Error ? e.message : String(e) });
        continue;
      }
    }
    requests.push({ ...base, channel: "mail" });
  }

  const mailRequests = requests.filter((r) => r.channel === "mail");
  if (mailRequests.length) {
    const mails = mailRequests.map((r) =>
      buildOwnerMail(
        { name: r.ownerName, email: r.ownerEmail, files: r.files, bytes: r.bytes },
        { siteName: site.name, message: options.message, deadline },
      ),
    );
    const sent = await source.sendMails(mails);
    for (const failed of sent.failed) {
      const r = mailRequests.find((m) => m.ownerEmail === failed.id);
      if (r) Object.assign(r, { state: "failed", error: failed.error });
    }
  }

  const round: ReviewRound = {
    id: roundId,
    createdAt: new Date().toISOString(),
    deadline: deadline.toISOString(),
    site,
    onTimeout: options.onTimeout,
    demo: mode === "demo",
    requests,
  };
  useReviews.getState().add(round);
  const asked = requests.filter((r) => r.state !== "failed");
  if (asked.length) {
    useApp.getState().pushHistory(
      createEntry("notify", asked.flatMap((r) => r.files), 0, {
        note: `${plural(asked.length, "Besitzer", "Besitzer")} gefragt (${options.channel === "teams" ? "Teams" : "E-Mail"})`,
      }),
    );
  }
  const failed = requests.filter((r) => r.state === "failed");
  if (failed.length) toast.error(`${plural(failed.length, "Anfrage", "Anfragen")} nicht zugestellt`, { description: failed[0].error });
  return round;
}

/** Decision entered by hand (mail replies). */
export function setDecision(roundId: string, ownerEmail: string, state: "approved" | "rejected") {
  useReviews.getState().update(roundId, (round) => ({
    ...round,
    requests: round.requests.map((r) =>
      r.ownerEmail === ownerEmail && r.state === "pending" ? { ...r, state, decidedAt: new Date().toISOString() } : r,
    ),
  }));
}

async function recordDeletion(site: SiteRef, files: SpFile[], ok: string[], startedAt: Date, note: string) {
  const deleted = files.filter((f) => ok.includes(f.id));
  if (!deleted.length) return;
  const entry: HistoryEntry = createEntry("delete", deleted, deleted.reduce((s, f) => s + f.size, 0), { permanent: false, note }, startedAt);
  const app = useApp.getState();
  if (app.site?.id === site.id) {
    app.removeFiles(ok, false);
    app.pushHistory(entry);
  } else if (app.mode === "live") {
    saveHistory(site.id, addEntry(await loadHistory(site.id), entry));
  }
}

let syncing = false;

/** Reads Teams answers, applies deadlines and deletes approved files. Safe to call often. */
export async function syncReviews({ quiet = false } = {}) {
  const { mode } = useApp.getState();
  if (!mode || syncing) return;
  syncing = true;
  const source = getSource(mode);
  let deletedFiles = 0;
  let deletedBytes = 0;
  try {
    for (const original of useReviews.getState().rounds.filter((r) => r.demo === (mode === "demo"))) {
      let round = original;
      // 1. answers from Teams
      const requests: ReviewRequest[] = [];
      for (const r of round.requests) {
        if (r.state === "pending" && r.channel === "teams" && r.approvalId) {
          const state = await source
            .getApproval(r.approvalId)
            .then(fromApproval)
            .catch(() => null);
          requests.push(state ? { ...r, state, decidedAt: new Date().toISOString() } : r);
        } else requests.push(r);
      }
      round = expire({ ...round, requests });

      // 2. carry out the decisions
      const { toDelete, toKeep } = decisions(round);
      const done = new Map<ReviewRequest, ReviewRequest>();
      for (const r of toKeep) done.set(r, { ...r, state: "kept" });
      for (const r of toDelete) {
        const startedAt = new Date();
        try {
          const result = await source.deleteFiles(r.files, false);
          await recordDeletion(round.site, r.files, result.succeeded, startedAt, `Freigabe von ${r.ownerName}`);
          deletedFiles += result.succeeded.length;
          deletedBytes += r.files.filter((f) => result.succeeded.includes(f.id)).reduce((s, f) => s + f.size, 0);
          done.set(r, { ...r, state: result.failed.length ? "failed" : "deleted", error: result.failed[0]?.error });
        } catch (e) {
          done.set(r, { ...r, state: "failed", error: e instanceof Error ? e.message : String(e) });
        }
      }
      round = { ...round, requests: round.requests.map((r) => done.get(r) ?? r) };
      useReviews.getState().update(original.id, () => round);
    }
  } finally {
    syncing = false;
  }
  if (deletedFiles && !quiet) {
    toast.success(`Freigaben umgesetzt: ${plural(deletedFiles, "Datei", "Dateien")} gelöscht`, {
      description: `${formatBytes(deletedBytes)} liegen jetzt im Papierkorb.`,
    });
  }
  return { deletedFiles, deletedBytes };
}
