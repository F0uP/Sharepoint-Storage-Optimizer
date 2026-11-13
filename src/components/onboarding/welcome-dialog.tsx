"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ArrowRightIcon, CheckIcon, LockKeyholeIcon, Undo2Icon, UserCheckIcon, FileTextIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { hasSeen, markSeen, useOnboarding } from "@/lib/onboarding";
import { cn } from "@/lib/utils";
import { LogoMark } from "../logo";

interface Slide {
  title: string;
  description: string;
  body: ReactNode;
}

function Row({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <li className="flex gap-3">
      <div className="grid size-8 shrink-0 place-items-center rounded-lg border bg-muted/40 text-xs font-semibold [&_svg]:size-4 [&_svg]:text-muted-foreground">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-sm text-pretty text-muted-foreground">{text}</div>
      </div>
    </li>
  );
}

const SLIDES: Slide[] = [
  {
    title: "Mehr Platz in SharePoint",
    description:
      "Der Storage Optimizer zeigt, was in deinen SharePoint-Sites Speicher belegt – und hilft dir, ihn schnell und gezielt freizugeben.",
    body: (
      <div className="grid grid-cols-3 gap-2 text-center text-xs text-muted-foreground">
        {[
          ["Duplikate", "gleicher Inhalt, mehrfach abgelegt"],
          ["Versionen", "bis zu 500 je Datei"],
          ["Große Medien", "Videos, Aufnahmen, RAW"],
        ].map(([title, text]) => (
          <div key={title} className="rounded-lg border bg-muted/30 px-2 py-3">
            <div className="text-sm font-medium text-foreground">{title}</div>
            <div className="mt-0.5 text-pretty">{text}</div>
          </div>
        ))}
      </div>
    ),
  },
  {
    title: "In drei Schritten",
    description: "Von der Anmeldung bis zum freien Speicher.",
    body: (
      <ol className="space-y-4">
        <Row icon="1" title="Verbinden" text="Microsoft 365 anbinden – oder erst einmal die Demo mit Beispieldaten ansehen." />
        <Row icon="2" title="Site wählen" text="Die Übersicht zeigt alle Sites, die vollsten zuerst." />
        <Row icon="3" title="Aufräumen" text="Optimierungen, Regeln und KI zeigen, was weg kann – markieren, löschen, fertig." />
      </ol>
    ),
  },
  {
    title: "Sicher und umkehrbar",
    description: "Du behältst die Kontrolle über jede Änderung.",
    body: (
      <ul className="space-y-4">
        <Row icon={<UserCheckIcon />} title="Deine Berechtigungen" text="Die App sieht und ändert nur, was du in SharePoint auch darfst." />
        <Row icon={<Undo2Icon />} title="Rückgängig per Klick" text="Gelöschtes landet im Papierkorb und lässt sich aus dem Verlauf wiederherstellen." />
        <Row icon={<FileTextIcon />} title="Nur Metadaten an die KI" text="Pfad, Größe und Datum – niemals Dateiinhalte." />
        <Row icon={<LockKeyholeIcon />} title="Schlüssel bleiben bei dir" text="Einstellungen und API-Schlüssel liegen nur auf diesem Gerät." />
      </ul>
    ),
  },
];

/** First-run introduction on the start screen. */
export function WelcomeDialog({ onDemo }: { onDemo(): void }) {
  const open = useOnboarding((s) => s.welcomeOpen);
  const [index, setIndex] = useState(0);
  const slide = SLIDES[index];
  const last = index === SLIDES.length - 1;

  useEffect(() => {
    if (!hasSeen("welcome")) useOnboarding.setState({ welcomeOpen: true });
  }, []);

  function close() {
    markSeen("welcome");
    useOnboarding.setState({ welcomeOpen: false });
    setIndex(0);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md" showCloseButton={false}>
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <LogoMark className="size-6 rounded-md" />
            Willkommen
          </div>
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={close}>
            Überspringen
          </Button>
        </div>

        <div className="px-5 pt-5 pb-6">
          <div key={index} className="animate-in duration-300 fade-in slide-in-from-right-2">
            <DialogTitle className="text-lg font-semibold tracking-tight">{slide.title}</DialogTitle>
            <DialogDescription className="mt-1 text-sm text-pretty">{slide.description}</DialogDescription>
            <div className="mt-5">{slide.body}</div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t bg-muted/30 px-5 py-3">
          <div className="flex items-center gap-1.5" aria-label={`Schritt ${index + 1} von ${SLIDES.length}`}>
            {SLIDES.map((s, i) => (
              <button
                key={s.title}
                onClick={() => setIndex(i)}
                aria-label={`Schritt ${i + 1}`}
                className={cn("h-1.5 rounded-full bg-foreground/15 transition-all", i === index ? "w-5 bg-foreground" : "w-1.5")}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {index > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setIndex(index - 1)}>
                Zurück
              </Button>
            )}
            {last ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    close();
                    onDemo();
                  }}
                >
                  Demo ansehen
                </Button>
                <Button size="sm" onClick={close}>
                  <CheckIcon /> Los geht&apos;s
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => setIndex(index + 1)}>
                Weiter <ArrowRightIcon />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
