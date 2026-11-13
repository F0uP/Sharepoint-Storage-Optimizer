"use client";

import { useMemo, useState } from "react";
import { MailIcon } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { notifyOwnersAction } from "@/lib/actions";
import { formatBytes, formatNumber } from "@/lib/format";
import { buildOwnerMail, DEFAULT_OWNER_MESSAGE, groupByOwner } from "@/lib/notify";
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

export function NotifyOwnersDialog({ open, onOpenChange, files }: Props) {
  const mode = useApp((s) => s.mode);
  const siteName = useApp((s) => s.site?.name ?? "SharePoint");
  const { groups, unknown } = useMemo(() => groupByOwner(files), [files]);
  const [message, setMessage] = useState(DEFAULT_OWNER_MESSAGE);
  const [days, setDays] = useState("14");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const running = progress !== null;

  async function send() {
    const deadline = new Date(Date.now() + Number(days) * 864e5);
    const mails = groups.map((g) => buildOwnerMail(g, { siteName, message, deadline }));
    setProgress({ done: 0, total: mails.length });
    try {
      await notifyOwnersAction(mails, files, (done, total) => setProgress({ done, total }));
      onOpenChange(false);
    } finally {
      setProgress(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !running && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="text-left">
          <DialogTitle>Besitzer benachrichtigen</DialogTitle>
          <DialogDescription>
            Jede Person bekommt eine Mail mit ihren Dateien und der Bitte, sie zu prüfen. Gesendet wird aus deinem Postfach
            {mode === "demo" ? " – im Demo-Modus nur simuliert." : "."}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-52 divide-y overflow-y-auto rounded-lg border">
          {groups.map((g) => (
            <div key={g.email} className="flex items-center gap-3 px-3 py-2">
              <Avatar className="size-7">
                <AvatarFallback className="text-[11px]">{initials(g.name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{g.name}</div>
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
            {formatNumber(unknown.length)} {unknown.length === 1 ? "Datei hat" : "Dateien haben"} keine bekannte E-Mail-Adresse und
            werden übersprungen.
          </p>
        )}

        <Field>
          <FieldLabel htmlFor="owner-message">Nachricht</FieldLabel>
          <Textarea id="owner-message" value={message} onChange={(e) => setMessage(e.target.value)} rows={5} disabled={running} />
          <FieldDescription>Anrede, Frist und die Liste der Dateien mit Links werden automatisch ergänzt.</FieldDescription>
        </Field>
        <Field orientation="horizontal" className="justify-between">
          <FieldLabel htmlFor="owner-deadline">Rückmeldung bis</FieldLabel>
          <Select value={days} onValueChange={setDays} disabled={running}>
            <SelectTrigger id="owner-deadline" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">in 1 Woche</SelectItem>
              <SelectItem value="14">in 2 Wochen</SelectItem>
              <SelectItem value="30">in 30 Tagen</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        {running && <Progress value={(progress.done / Math.max(1, progress.total)) * 100} />}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={running}>
            Abbrechen
          </Button>
          <Button onClick={send} disabled={running || !groups.length || !message.trim()}>
            {running ? <Spinner /> : <MailIcon />}
            {groups.length === 1 ? "1 Mail senden" : `${formatNumber(groups.length)} Mails senden`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
