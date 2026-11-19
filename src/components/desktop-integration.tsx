"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { desktopBridge, type UpdateStatus } from "@/lib/desktop";
import { formatBytes, formatPercent } from "@/lib/format";
import { hasLiveSession } from "@/lib/auth";
import { useSettings } from "@/lib/settings";
import { getSource } from "@/lib/source";
import { useApp } from "@/lib/store";
import { loadWatchedSites, recordSnapshot } from "@/lib/trend";

/**
 * Background quota check (triggered by the main process on a timer): reads the quota of every site that
 * was analysed before, extends its trend and sends a system notification when one is nearly full.
 */
export async function checkWatchedQuotas() {
  const bridge = desktopBridge();
  if (!bridge || !(await hasLiveSession())) return;
  const sites = await loadWatchedSites();
  if (!sites.length) return;

  const threshold = Number(useSettings.getState().settings.desktopThreshold) / 100;
  const quotas = await getSource("live").siteQuotas(sites);
  const critical: { name: string; used: number; total: number }[] = [];
  for (const site of sites) {
    const quota = quotas.get(site.id);
    if (!quota) continue;
    const trend = await recordSnapshot(site, quota);
    if (useApp.getState().site?.id === site.id) useApp.getState().setTrend(trend);
    if (quota.total > 0 && quota.used / quota.total >= threshold) critical.push({ name: site.name, ...quota });
  }
  if (!critical.length) return;
  const [first] = critical.toSorted((a, b) => b.used / b.total - a.used / a.total);
  await bridge.notify(
    critical.length === 1 ? `${first.name}: ${formatPercent(first.used / first.total)} belegt` : `${critical.length} Sites fast voll`,
    critical.length === 1
      ? `${formatBytes(first.used)} von ${formatBytes(first.total)} – jetzt aufräumen.`
      : `Am vollsten: ${first.name} mit ${formatPercent(first.used / first.total)}.`,
  );
}

function showUpdate(status: UpdateStatus) {
  const bridge = desktopBridge();
  if (status.state === "ready") {
    toast("Update bereit", {
      id: "app-update",
      description: `Version ${status.version} wird beim nächsten Start installiert.`,
      duration: Infinity,
      action: { label: "Jetzt neu starten", onClick: () => void bridge?.installUpdate() },
    });
  } else if (status.state === "available" && status.mode === "notify" && status.releaseUrl) {
    toast("Neue Version verfügbar", {
      id: "app-update",
      description: `Version ${status.version} kann heruntergeladen werden.`,
      duration: Infinity,
      action: { label: "Herunterladen", onClick: () => window.open(status.releaseUrl, "_blank") },
    });
  }
}

export function DesktopIntegration() {
  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge) return;
    const offCheck = bridge.on("watch-check", () => {
      checkWatchedQuotas().catch((e) => console.warn("Hintergrund-Prüfung fehlgeschlagen", e));
    });
    const offUpdate = bridge.on("update", (payload) => showUpdate(payload as UpdateStatus));
    return () => {
      offCheck();
      offUpdate();
    };
  }, []);
  return null;
}
