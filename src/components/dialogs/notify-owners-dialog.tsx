"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { MailIcon, SendIcon, UsersIcon } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { errorMessage } from "@/lib/actions";
import { formatBytes, formatNumber } from "@/lib/format";
import { DEFAULT_OWNER_MESSAGE, groupByOwner } from "@/lib/notify";
import { startReview } from "@/lib/reviews";
import { useApp } from "@/lib/store";
import type { SpFile } from "@/lib/types";

interface Props {
  open: boolean;
  onOpenChange(open: boolean): void;
  files: SpFile[];
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

type Channel = "teams" | "mail";

/** Asks the owners of the selected files for a decision – in Teams (Approvals) or by mail. */
export function NotifyOwnersDialog({ open, onOpenChange, files }: Props) {
  const mode = useApp((s) => s.mode);
  const { groups, unknown } = useMemo(() => groupByOwner(files), [files]);
  const [channel, setChannel] = useState<Channel>("teams");
  const [message, setMessage] = useState(DEFAULT_OWNER_MESSAGE);
  const [days, setDays] = useState("14");
  const [onTimeout, setOnTimeout] = useState<"delete" | "keep">("delete");
  const [busy, setBusy] = useState(false);
  const withTeams = (g: (typeof groups)[number]) => g.files.some((f) => f.modifiedById);

  async function send() {
    setBusy(true);
    try {
      const round = await startReview(groups, { channel, days: Number(days), onTimeout, message });
      if (round) {
        const asked = round.requests.filter((r) => r.state !== "failed").length;
        toast.success(`${formatNumber(asked)} ${asked === 1 ? "Besitzer gefragt" : "Besitzer gefragt"}`, {
          description: channel === "teams" ? "Die Freigaben erscheinen in der Teams-App „Genehmigungen“." : "Die Mails sind verschickt.",
          action: { label: "Freigaben ansehen", onClick: () => useApp.getState().setView("reviews") },
        });
      }
      onOpenChange(false);
    } catch (e) {
      toast.error("Freigabe konnte nicht gestartet werden", { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="flex max-h-[min(860px,92svh)] flex-col overflow-hidden sm:max-w-lg">
        <DialogHeader className="text-left">
          <DialogTitle>Besitzer fragen</DialogTitle>
          <DialogDescription>
            Jede Person entscheidet über ihre Dateien. Zustimmung oder ausbleibende Antwort führt – je nach Einstellung – zum
            Verschieben in den Papierkorb.{mode === "demo" ? " Im Demo-Modus wird alles simuliert." : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4">
          <ToggleGroup
            type="single"
            variant="outline"
            value={channel}
            onValueChange={(v) => v && setChannel(v as Channel)}
            className="w-full"
            aria-label="Kanal"
          >
            <ToggleGroupItem value="teams" className="flex-1">
              <UsersIcon /> Freigabe in Teams
            </ToggleGroupItem>
            <ToggleGroupItem value="mail" className="flex-1">
              <MailIcon /> E-Mail
            </ToggleGroupItem>
          </ToggleGroup>
          <p className="-mt-2 text-xs text-pretty text-muted-foreground">
            {channel === "teams"
              ? "Erscheint in der Teams-App „Genehmigungen“ mit „Zustimmen“ und „Ablehnen“ – die App liest die Antworten automatisch aus."
              : "Mail aus deinem Postfach mit Dateiliste und Links. Antworten trägst du unter „Freigaben“ ein."}
          </p>

          <div className="max-h-48 divide-y overflow-y-auto rounded-lg border">
            {groups.map((g) => (
              <div key={g.email} className="flex items-center gap-3 px-3 py-2">
                <Avatar className="size-7">
                  <AvatarFallback className="text-[11px]">{initials(g.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{g.name}</span>
                    {channel === "teams" && !withTeams(g) && (
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-normal">
                        per E-Mail
                      </Badge>
                    )}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{g.email}</div>
                </div>
                <div className="text-right text-xs tabular">
                  <div className="font-medium">{formatBytes(g.bytes)}</div>
                  <div className="text-muted-foreground">
                    {formatNumber(g.files.length)} {g.files.length === 1 ? "Datei" : "Dateien"}
                  </div>
                </div>
              </div>
            ))}
            {!groups.length && <div className="p-4 text-sm text-muted-foreground">Für keine der Dateien ist ein Besitzer bekannt.</div>}
          </div>
          {unknown.length > 0 && (
            <p className="-mt-2 text-xs text-muted-foreground">
              {formatNumber(unknown.length)} {unknown.length === 1 ? "Datei hat" : "Dateien haben"} keinen bekannten Besitzer und
              werden übersprungen.
            </p>
          )}

          {(channel === "mail" || groups.some((g) => !withTeams(g))) && (
            <Field>
              <FieldLabel htmlFor="owner-message">Nachricht für die E-Mail</FieldLabel>
              <Textarea id="owner-message" value={message} onChange={(e) => setMessage(e.target.value)} rows={4} disabled={busy} />
              <FieldDescription>Anrede, Frist und die Liste der Dateien mit Links werden automatisch ergänzt.</FieldDescription>
            </Field>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="owner-deadline">Frist</FieldLabel>
              <Select value={days} onValueChange={setDays} disabled={busy}>
                <SelectTrigger id="owner-deadline" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">1 Woche</SelectItem>
                  <SelectItem value="14">2 Wochen</SelectItem>
                  <SelectItem value="30">30 Tage</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="owner-timeout">Ohne Antwort</FieldLabel>
              <Select value={onTimeout} onValueChange={(v) => setOnTimeout(v as "delete" | "keep")} disabled={busy}>
                <SelectTrigger id="owner-timeout" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="delete">In den Papierkorb</SelectItem>
                  <SelectItem value="keep">Behalten</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Abbrechen
          </Button>
          <Button onClick={send} disabled={busy || !groups.length || (channel === "mail" && !message.trim())}>
            {busy ? <Spinner /> : <SendIcon />}
            {groups.length === 1 ? "1 Person fragen" : `${formatNumber(groups.length)} Personen fragen`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
