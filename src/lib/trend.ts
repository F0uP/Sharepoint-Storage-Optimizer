import { get as idbGet, set as idbSet } from "idb-keyval";
import type { Quota, SiteRef } from "./types";

/** Quota reading of a site at one point in time – one per day is kept. */
export interface Snapshot {
  at: string;
  used: number;
  total: number;
  deleted: number;
}

const MAX_SNAPSHOTS = 400;

export function toSnapshot(quota: Quota, at = new Date()): Snapshot {
  return { at: at.toISOString(), used: quota.used, total: quota.total, deleted: quota.deleted };
}

/** Adds a reading; a reading from the same day replaces the earlier one. Sorted oldest first. */
export function addSnapshot(list: Snapshot[], snapshot: Snapshot): Snapshot[] {
  const day = snapshot.at.slice(0, 10);
  return [...list.filter((s) => s.at.slice(0, 10) !== day), snapshot]
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .slice(-MAX_SNAPSHOTS);
}

const trendKey = (siteId: string) => `trend:${siteId}`;
const WATCHED = "watch:sites";

export async function loadTrend(siteId: string): Promise<Snapshot[]> {
  try {
    return (await idbGet<Snapshot[]>(trendKey(siteId))) ?? [];
  } catch {
    return [];
  }
}

/** Stores a reading and remembers the site for the background quota check (desktop). */
export async function recordSnapshot(site: SiteRef, quota: Quota): Promise<Snapshot[]> {
  const next = addSnapshot(await loadTrend(site.id), toSnapshot(quota));
  await idbSet(trendKey(site.id), next).catch(() => {});
  const watched = await loadWatchedSites();
  if (!watched.some((s) => s.id === site.id)) await idbSet(WATCHED, [...watched, site]).catch(() => {});
  return next;
}

export async function loadWatchedSites(): Promise<SiteRef[]> {
  try {
    return (await idbGet<SiteRef[]>(WATCHED)) ?? [];
  } catch {
    return [];
  }
}

/** Change between the first and the last reading (positive = grown). */
export function trendDelta(list: Snapshot[]): number {
  return list.length < 2 ? 0 : list[list.length - 1].used - list[0].used;
}
