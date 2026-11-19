"use client";

import { useEffect } from "react";
import { desktopBridge } from "@/lib/desktop";
import { runDueJobs } from "@/lib/jobs";
import { hasLiveSession } from "@/lib/auth";
import { syncReviews } from "@/lib/reviews";
import { useApp } from "@/lib/store";

const INTERVAL = 15 * 60_000;

async function tick() {
  const { mode } = useApp.getState();
  if (!mode) return;
  if (mode === "live" && !(await hasLiveSession())) return;
  await syncReviews({ quiet: true }).catch(() => {});
  await runDueJobs().catch(() => {});
}

/**
 * Runs due cleanup jobs and follows up on review rounds: shortly after signing in, every 15 minutes
 * while the app is open, and on every background check of the desktop app.
 */
export function Automation() {
  const mode = useApp((s) => s.mode);

  useEffect(() => {
    if (!mode) return;
    const first = setTimeout(() => void tick(), 5_000);
    const timer = setInterval(() => void tick(), INTERVAL);
    const off = desktopBridge()?.on("watch-check", () => void tick());
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      off?.();
    };
  }, [mode]);

  return null;
}
