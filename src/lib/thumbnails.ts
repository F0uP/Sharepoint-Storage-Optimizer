import { useEffect, useSyncExternalStore } from "react";
import { getSource } from "./source";
import { useApp } from "./store";
import type { FileCategory, SpFile } from "./types";

/**
 * Preview images for the file lists. Requests from all visible rows are collected for a moment and
 * loaded in one Graph batch; results (also "no preview") are cached for the session.
 */

const WITH_PREVIEW = new Set<FileCategory>(["image", "video", "document"]);

const cache = new Map<string, string | null>();
const listeners = new Set<() => void>();
const queue = new Map<string, SpFile>();
let timer: ReturnType<typeof setTimeout> | null = null;

function emit() {
  for (const listener of listeners) listener();
}

async function flush() {
  timer = null;
  const batch = [...queue.values()];
  queue.clear();
  const { mode } = useApp.getState();
  if (!batch.length || !mode) return;
  for (let i = 0; i < batch.length; i += 20) {
    const chunk = batch.slice(i, i + 20);
    const urls = await getSource(mode)
      .getThumbnails(chunk)
      .catch(() => new Map<string, string>());
    for (const f of chunk) cache.set(f.id, urls.get(f.id) ?? null);
    emit();
  }
}

export function requestThumbnail(file: SpFile) {
  if (!WITH_PREVIEW.has(file.category) || cache.has(file.id) || queue.has(file.id)) return;
  queue.set(file.id, file);
  timer ??= setTimeout(() => void flush(), 60);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** URL of the preview, null if there is none, undefined while loading. */
export function useThumbnail(file: SpFile): string | null | undefined {
  useEffect(() => requestThumbnail(file), [file]);
  return useSyncExternalStore(
    subscribe,
    () => cache.get(file.id),
    () => undefined,
  );
}
