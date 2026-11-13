"use client";

import { useState } from "react";
import { toast } from "sonner";
import { SlidersHorizontalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage, loadVersionSettings, setVersionLimitAction } from "@/lib/actions";
import { formatNumber } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { LibraryVersionSetting } from "@/lib/types";

/** SharePoint Online accepts 100 to 50,000 major versions. */
const LIMITS = [500, 300, 200, 100];

function current(s: LibraryVersionSetting) {
  if (!s.enabled) return "Versionierung aus";
  return s.majorLimit ? `${formatNumber(s.majorLimit)} Versionen` : "Unbegrenzt";
}

/** Caps the number of versions per library so the space doesn't grow back after a cleanup. */
export function VersionLimitsCard() {
  const mode = useApp((s) => s.mode);
  const [settings, setSettings] = useState<LibraryVersionSetting[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      setSettings(await loadVersionSettings());
    } catch (e) {
      toast.error("Bibliothekseinstellungen konnten nicht geladen werden", { description: errorMessage(e) });
    } finally {
      setLoading(false);
    }
  }

  async function apply(targets: LibraryVersionSetting[], limitFor: (s: LibraryVersionSetting) => number) {
    for (const s of targets) {
      const limit = limitFor(s);
      setSaving(s.driveId);
      if (await setVersionLimitAction(s, limit)) {
        setSettings((list) => list?.map((x) => (x.driveId === s.driveId ? { ...x, enabled: true, majorLimit: limit } : x)) ?? null);
      }
    }
    setSaving(null);
  }

  const chosen = (s: LibraryVersionSetting) => Number(choice[s.driveId] ?? 100);

  return (
    <div className="mt-6 rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-start gap-3">
        <SlidersHorizontalIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">Versionslimit je Bibliothek</h3>
          <p className="mt-0.5 text-sm text-pretty text-muted-foreground">
            Verhindert, dass der Speicher nach dem Bereinigen wieder wächst. SharePoint behält standardmäßig 500 Versionen pro Datei,
            das Minimum sind 100. Das Limit gilt für neue Versionen – vorhandene alte Versionen oben mit „Versionen löschen“ entfernen.
          </p>
        </div>
        {!settings && (
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            {loading && <Spinner />} Einstellungen laden
          </Button>
        )}
      </div>

      {settings && (
        <>
          <ul className="mt-4 divide-y border-t">
            {settings.map((s) => (
              <li key={s.driveId} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{s.driveName}</div>
                  <div className="text-xs text-muted-foreground">Aktuell: {current(s)}</div>
                </div>
                <Select value={String(chosen(s))} onValueChange={(v) => setChoice((c) => ({ ...c, [s.driveId]: v }))}>
                  <SelectTrigger size="sm" className="w-36" aria-label={`Versionslimit für ${s.driveName}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LIMITS.map((l) => (
                      <SelectItem key={l} value={String(l)}>
                        {formatNumber(l)} Versionen
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={saving !== null || (s.enabled && s.majorLimit === chosen(s))}
                  onClick={() => apply([s], chosen)}
                >
                  {saving === s.driveId && <Spinner />} Übernehmen
                </Button>
              </li>
            ))}
          </ul>
          {settings.length > 1 && (
            <div className="flex justify-end border-t pt-3">
              <Button size="sm" disabled={saving !== null} onClick={() => apply(settings, chosen)}>
                Für alle Bibliotheken übernehmen
              </Button>
            </div>
          )}
          {mode === "live" && (
            <p className="mt-2 text-xs text-muted-foreground">Benötigt die optionale SharePoint-Berechtigung AllSites.Manage.</p>
          )}
        </>
      )}
    </div>
  );
}
