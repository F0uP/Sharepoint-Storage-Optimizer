"use client";

import { useEffect, useState } from "react";
import { CheckIcon, MailIcon, RefreshCwIcon, UserCheckIcon, UsersIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { PageHeader } from "../page-header";
import { formatBytes, formatDate, formatNumber, formatRelative } from "@/lib/format";
import { setDecision, summarize, syncReviews, useReviews, type ReviewRequest, type ReviewRound, type ReviewState } from "@/lib/reviews";
import { useApp } from "@/lib/store";

const STATE: Record<ReviewState, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  pending: { label: "Offen", variant: "outline" },
  approved: { label: "Zugestimmt", variant: "default" },
  rejected: { label: "Abgelehnt", variant: "secondary" },
  expired: { label: "Frist abgelaufen", variant: "outline" },
  deleted: { label: "Gelöscht", variant: "default" },
  kept: { label: "Behalten", variant: "secondary" },
  failed: { label: "Fehler", variant: "destructive" },
};

function RequestRow({ round, request }: { round: ReviewRound; request: ReviewRequest }) {
  const state = STATE[request.state];
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="grid size-8 shrink-0 place-items-center rounded-md border bg-background">
        {request.channel === "teams" ? <UsersIcon className="size-4 text-muted-foreground" /> : <MailIcon className="size-4 text-muted-foreground" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{request.ownerName}</div>
        <div className="truncate text-xs text-muted-foreground" title={request.error}>
          {formatNumber(request.files.length)} {request.files.length === 1 ? "Datei" : "Dateien"} · {formatBytes(request.bytes)}
          {request.error ? ` · ${request.error}` : ""}
        </div>
      </div>
      {request.state === "pending" && request.channel === "mail" ? (
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => setDecision(round.id, request.ownerEmail, "rejected")}>
            <XIcon /> Behalten
          </Button>
          <Button variant="outline" size="sm" onClick={() => setDecision(round.id, request.ownerEmail, "approved")}>
            <CheckIcon /> Löschen
          </Button>
        </div>
      ) : (
        <Badge variant={state.variant}>{request.state === "pending" ? "Wartet auf Antwort in Teams" : state.label}</Badge>
      )}
    </li>
  );
}

function RoundCard({ round }: { round: ReviewRound }) {
  const s = summarize(round);
  const remove = useReviews((st) => st.remove);
  return (
    <section className="rounded-xl border bg-card">
      <header className="flex flex-wrap items-start gap-3 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium">{round.site.name}</h2>
          <p className="text-xs text-muted-foreground">
            Gestartet {formatRelative(round.createdAt)} · Frist {formatDate(round.deadline)} · ohne Antwort{" "}
            {round.onTimeout === "delete" ? "in den Papierkorb" : "behalten"}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs tabular">
          <span>
            <span className="font-medium">{s.approved}</span> zugestimmt
          </span>
          <span>
            <span className="font-medium">{s.rejected}</span> abgelehnt
          </span>
          <span>
            <span className="font-medium">{s.pending}</span> offen
          </span>
          {s.deletedBytes > 0 && <Badge variant="secondary">{formatBytes(s.deletedBytes)} gelöscht</Badge>}
          {!s.open && (
            <Button variant="ghost" size="sm" onClick={() => remove(round.id)}>
              Entfernen
            </Button>
          )}
        </div>
      </header>
      <ul className="divide-y">
        {round.requests.map((r) => (
          <RequestRow key={r.ownerEmail} round={round} request={r} />
        ))}
      </ul>
    </section>
  );
}

export function ReviewsView() {
  const mode = useApp((s) => s.mode);
  const rounds = useReviews((s) => s.rounds).filter((r) => r.demo === (mode === "demo"));
  const [syncing, setSyncing] = useState(false);

  async function sync() {
    setSyncing(true);
    try {
      await syncReviews();
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    void syncReviews({ quiet: true });
  }, []);

  return (
    <div>
      <PageHeader
        title="Freigaben"
        description="Besitzer entscheiden selbst über ihre Dateien – in Teams oder per Mail. Zugestimmte Dateien werden automatisch in den Papierkorb verschoben."
        actions={
          rounds.length > 0 && (
            <Button variant="outline" onClick={sync} disabled={syncing}>
              {syncing ? <Spinner /> : <RefreshCwIcon />} Aktualisieren
            </Button>
          )
        }
      />
      {rounds.length ? (
        <div className="space-y-4">
          {rounds.map((r) => (
            <RoundCard key={r.id} round={r} />
          ))}
        </div>
      ) : (
        <Empty className="rounded-xl border border-dashed py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UserCheckIcon />
            </EmptyMedia>
            <EmptyTitle>Noch keine Freigaben</EmptyTitle>
            <EmptyDescription>
              Dateien auswählen und unter <span className="font-medium text-foreground">Weitere → Besitzer fragen</span> eine Freigabe
              starten. Jede Person bekommt ihre Dateien zur Entscheidung.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
}
