"use client";

import { useEffect, useState } from "react";
import { CircleAlertIcon, CircleCheckIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldSeparator, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { desktopBridge, type AppInfo, type MediaStatus, type UpdateStatus } from "@/lib/desktop";
import type { Settings } from "@/lib/settings";

type Patch = (patch: Partial<Settings>) => void;

const UPDATE_TEXT: Record<UpdateStatus["state"], string> = {
  disabled: "Automatische Updates sind für diesen Build nicht eingerichtet.",
  idle: "Updates werden beim Start automatisch gesucht.",
  checking: "Suche nach Updates …",
  none: "Die App ist aktuell.",
  available: "Update verfügbar",
  downloading: "Update wird geladen",
  ready: "Update bereit – wird spätestens beim Beenden der App installiert.",
  error: "Update-Prüfung fehlgeschlagen",
};

export function DesktopSettings({ draft, patch }: { draft: Settings; patch: Patch }) {
  const bridge = desktopBridge();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [media, setMedia] = useState<MediaStatus | null>(null);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    bridge?.appInfo().then(setInfo).catch(() => {});
    bridge?.mediaStatus().then(setMedia).catch(() => {});
    // live status: download progress and "ready" arrive as events after the check
    bridge?.updateStatus?.().then(setUpdate).catch(() => {});
    return bridge?.on("update", (payload) => setUpdate(payload as UpdateStatus));
  }, [bridge]);

  async function checkUpdates() {
    if (!bridge) return;
    setChecking(true);
    try {
      setUpdate(await bridge.checkForUpdates());
    } finally {
      setChecking(false);
    }
  }

  const background = draft.desktopBackground === "on";

  return (
    <FieldGroup>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="desktop-background">Im Hintergrund weiterlaufen</FieldLabel>
          <FieldDescription>
            Beim Schließen bleibt die App im Infobereich und prüft regelmäßig das Kontingent aller bereits analysierten Sites. Wird es
            knapp, gibt es eine Benachrichtigung – für Sites mit eigenem Speicherlimit; die übrigen erweitern nur den Verlauf.
          </FieldDescription>
        </FieldContent>
        <Switch id="desktop-background" checked={background} onCheckedChange={(v) => patch({ desktopBackground: v ? "on" : "" })} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="desktop-interval">Prüfen</FieldLabel>
          <Select value={draft.desktopIntervalHours} onValueChange={(v) => patch({ desktopIntervalHours: v })} disabled={!background}>
            <SelectTrigger id="desktop-interval" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3">alle 3 Stunden</SelectItem>
              <SelectItem value="6">alle 6 Stunden</SelectItem>
              <SelectItem value="12">alle 12 Stunden</SelectItem>
              <SelectItem value="24">einmal täglich</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="desktop-threshold">Warnen ab</FieldLabel>
          <Select value={draft.desktopThreshold} onValueChange={(v) => patch({ desktopThreshold: v })} disabled={!background}>
            <SelectTrigger id="desktop-threshold" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["75", "80", "90", "95"].map((t) => (
                <SelectItem key={t} value={t}>
                  {t} % belegt
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="desktop-autostart">Bei der Anmeldung starten</FieldLabel>
          <FieldDescription>Mit „Im Hintergrund weiterlaufen“ startet die App direkt im Infobereich, sonst mit Fenster.</FieldDescription>
        </FieldContent>
        <Switch id="desktop-autostart" checked={draft.desktopAutostart === "on"} onCheckedChange={(v) => patch({ desktopAutostart: v ? "on" : "" })} />
      </Field>

      <FieldSeparator />

      <Field>
        <FieldLabel htmlFor="ffmpeg-path">ffmpeg für Videokomprimierung</FieldLabel>
        <Input
          id="ffmpeg-path"
          value={draft.ffmpegPath}
          onChange={(e) => patch({ ffmpegPath: e.target.value })}
          placeholder={media?.ffmpeg.path ?? "Automatisch suchen"}
          spellCheck={false}
          className="font-mono text-[13px]"
        />
        {media ? (
          media.ffmpeg.available ? (
            <p className="flex items-center gap-1.5 text-xs text-success">
              <CircleCheckIcon className="size-3.5" /> Gefunden · {media.ffmpeg.version}
            </p>
          ) : (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <CircleAlertIcon className="mt-px size-3.5 shrink-0 text-warning" />
              <span>
                Nicht gefunden. Installieren mit <code className="font-mono">winget install Gyan.FFmpeg</code> (Windows) bzw.{" "}
                <code className="font-mono">brew install ffmpeg</code> (macOS) oder den Pfad zu ffmpeg hier eintragen.
              </span>
            </p>
          )
        ) : (
          <FieldDescription>Leer lassen für automatische Suche.</FieldDescription>
        )}
      </Field>

      <FieldSeparator />

      <Field orientation="horizontal">
        <FieldContent>
          <FieldTitle>Version {info?.version ?? "…"}</FieldTitle>
          <FieldDescription>
            {update ? (
              <>
                {UPDATE_TEXT[update.state]}
                {update.version && update.state !== "none" ? ` (${update.version})` : ""}
                {update.state === "downloading" ? (update.percent ? ` … ${update.percent} %` : " …") : ""}
                {update.message ? ` – ${update.message}` : ""}{" "}
                {update.releaseUrl && update.state !== "ready" && (
                  <a href={update.releaseUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                    Zum Download
                  </a>
                )}
              </>
            ) : (
              UPDATE_TEXT.idle
            )}
          </FieldDescription>
        </FieldContent>
        {update?.state === "ready" ? (
          <Button type="button" size="sm" onClick={() => void bridge?.installUpdate()}>
            <RefreshCwIcon /> Jetzt neu starten
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={checkUpdates}
            disabled={checking || update?.state === "checking" || update?.state === "downloading"}
          >
            {checking || update?.state === "checking" ? <Spinner /> : <RefreshCwIcon />} Prüfen
          </Button>
        )}
      </Field>
    </FieldGroup>
  );
}
