"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CopyIcon, HistoryIcon, ScanSearchIcon, SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { LogoMark } from "./logo";
import { ThemeToggle } from "./theme-toggle";
import { isMsalConfigured, signIn } from "@/lib/msal";
import { useApp } from "@/lib/store";
import { errorMessage } from "@/lib/actions";

function MicrosoftMark() {
  return (
    <svg viewBox="0 0 21 21" className="size-4" aria-hidden>
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

const FEATURES = [
  { icon: ScanSearchIcon, text: "Große Dateien, Videos und Bilder auf einen Blick" },
  { icon: CopyIcon, text: "Duplikate, Altlasten und Temp-Dateien finden" },
  { icon: HistoryIcon, text: "Versionsverlauf und Papierkorb bereinigen" },
  { icon: SparklesIcon, text: "KI-Empfehlungen mit OpenAI oder Gemini" },
];

export function LoginScreen() {
  const setMode = useApp((s) => s.setMode);
  const [busy, setBusy] = useState(false);

  async function handleSignIn() {
    setBusy(true);
    try {
      await signIn();
      setMode("live");
    } catch (e) {
      toast.error("Anmeldung fehlgeschlagen", { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-svh flex-col">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <main className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <LogoMark className="size-10 rounded-xl" />
          <h1 className="mt-8 text-2xl font-semibold tracking-tight text-balance">
            Mehr Platz in SharePoint – in Minuten.
          </h1>
          <p className="mt-2 text-sm text-pretty text-muted-foreground">
            Analysiere den Speicher deiner Sites, finde die größten Platzfresser und räume sie gezielt auf.
          </p>

          <div className="mt-8 flex flex-col gap-2">
            <Button size="lg" className="h-10" onClick={handleSignIn} disabled={!isMsalConfigured() || busy}>
              {busy ? <Spinner /> : <MicrosoftMark />}
              Mit Microsoft anmelden
            </Button>
            <Button size="lg" variant="outline" className="h-10" onClick={() => setMode("demo")}>
              Demo ansehen
            </Button>
          </div>

          {!isMsalConfigured() && (
            <p className="mt-3 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
              Für die Anmeldung fehlt noch die Azure-App-Registrierung. Trage{" "}
              <code className="font-mono text-foreground">AZURE_CLIENT_ID</code> in{" "}
              <code className="font-mono text-foreground">.env.local</code> ein (siehe README).
            </p>
          )}

          <ul className="mt-10 space-y-3 border-t pt-6">
            {FEATURES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-muted-foreground">
                <Icon className="size-4 shrink-0 text-foreground/70" />
                {text}
              </li>
            ))}
          </ul>
        </div>
      </main>
      <footer className="px-6 pb-6 text-center text-xs text-muted-foreground">
        Zugriff ausschließlich über die Microsoft Graph API – mit deinen eigenen Berechtigungen.
      </footer>
    </div>
  );
}
