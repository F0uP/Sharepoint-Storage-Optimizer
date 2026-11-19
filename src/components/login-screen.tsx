"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  ArrowRightIcon,
  CopyIcon,
  ExternalLinkIcon,
  HistoryIcon,
  KeyRoundIcon,
  ScanSearchIcon,
  Settings2Icon,
  ShieldAlertIcon,
  SparklesIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LogoMark } from "./logo";
import { openSettings } from "./settings-dialog";
import { ThemeToggle } from "./theme-toggle";
import { connectApp, isAppAuth, isAuthConfigured } from "@/lib/auth";
import { classifyLoginError, type LoginProblem } from "@/lib/entra";
import { adminConsentUrl, signIn } from "@/lib/msal";
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
  const [problem, setProblem] = useState<{ kind: LoginProblem | "app"; message: string } | null>(null);
  const appMode = isAppAuth();
  const configured = isAuthConfigured();

  async function handleSignIn() {
    setBusy(true);
    setProblem(null);
    try {
      await signIn();
      setMode("live");
    } catch (e) {
      setProblem({ kind: classifyLoginError(e), message: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  async function handleConnect() {
    setBusy(true);
    setProblem(null);
    try {
      const session = await connectApp();
      toast.success("Verbunden", { description: session.host ? `App-Zugriff auf ${session.host}` : undefined });
      setMode("live");
    } catch (e) {
      setProblem({ kind: "app", message: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-svh flex-col">
      <div className="absolute top-4 right-4 flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={() => openSettings()} aria-label="Einstellungen">
              <Settings2Icon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Einstellungen</TooltipContent>
        </Tooltip>
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
            {configured && appMode ? (
              <Button size="lg" className="h-10" onClick={handleConnect} disabled={busy}>
                {busy ? <Spinner /> : <KeyRoundIcon />}
                Mit App-Zugriff verbinden
              </Button>
            ) : configured ? (
              <Button size="lg" className="h-10" onClick={handleSignIn} disabled={busy}>
                {busy ? <Spinner /> : <MicrosoftMark />}
                Mit Microsoft anmelden
              </Button>
            ) : (
              <Button size="lg" className="h-10" onClick={() => openSettings("microsoft")}>
                <MicrosoftMark />
                Microsoft 365 verbinden
              </Button>
            )}
            <Button size="lg" variant="outline" className="h-10" onClick={() => setMode("demo")}>
              Demo ansehen
            </Button>
          </div>

          {problem && <ProblemPanel problem={problem} />}

          {!configured && (
            <button
              type="button"
              onClick={() => openSettings("microsoft")}
              className="group mt-3 flex w-full items-center gap-3 rounded-lg border border-dashed px-3 py-2.5 text-left text-xs text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
            >
              <span className="flex-1 text-pretty">
                {appMode
                  ? "App-Zugriff vervollständigen: Client-ID, Tenant-ID und Client-Secret oder Zertifikat."
                  : "Einmalig die Azure-App-Registrierung hinterlegen – direkt hier in der App, ohne Konfigurationsdatei."}
              </span>
              <ArrowRightIcon className="size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5" />
            </button>
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
        {appMode
          ? "App-Zugriff: Die App nutzt die Berechtigungen ihrer App-Registrierung – ohne Benutzerkonto."
          : "Zugriff ausschließlich über die Microsoft Graph API – mit deinen eigenen Berechtigungen."}
      </footer>
    </div>
  );
}

/** Explains a failed sign-in – above all the "admin approval required" case, which no app setting can bypass. */
function ProblemPanel({ problem }: { problem: { kind: LoginProblem | "app"; message: string } }) {
  const consent = problem.kind === "admin-consent" || problem.kind === "cancelled";

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(adminConsentUrl());
      toast.success("Link kopiert", { description: "Schick ihn an einen Administrator deiner Organisation." });
    } catch {
      toast.error("Kopieren nicht möglich");
    }
  }

  if (problem.kind === "app") {
    return (
      <div role="alert" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
        <p className="flex items-center gap-2 font-medium">
          <ShieldAlertIcon className="size-4 shrink-0 text-destructive" /> Verbindung fehlgeschlagen
        </p>
        <p className="mt-1 text-xs text-pretty text-muted-foreground">{problem.message}</p>
        <Button variant="link" size="sm" className="mt-1 h-auto px-0" onClick={() => openSettings("microsoft")}>
          In den Einstellungen prüfen <ArrowRightIcon />
        </Button>
      </div>
    );
  }

  return (
    <div role="alert" className="mt-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <ShieldAlertIcon className="size-4 shrink-0" />
        {problem.kind === "admin-consent" ? "Administratorfreigabe nötig" : problem.kind === "cancelled" ? "Anmeldung abgebrochen" : "Anmeldung fehlgeschlagen"}
      </p>
      <p className="mt-1 text-xs text-pretty text-muted-foreground">
        {problem.kind === "admin-consent"
          ? "Deine Organisation lässt Benutzer dieser App nicht selbst zustimmen. Ein Administrator muss einmal zustimmen – danach meldet sich jeder ohne Adminrechte an."
          : problem.kind === "cancelled"
            ? "Hat Microsoft „Genehmigung erforderlich“ angezeigt? Dann muss ein Administrator der App einmal zustimmen – danach klappt die Anmeldung für alle."
            : problem.message}
      </p>
      {consent && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <Button variant="link" size="sm" className="h-auto px-0" onClick={copyLink}>
            <CopyIcon /> Link für Admin kopieren
          </Button>
          <Button asChild variant="link" size="sm" className="h-auto px-0">
            <a href={adminConsentUrl()} target="_blank" rel="noreferrer">
              Als Admin zustimmen <ExternalLinkIcon />
            </a>
          </Button>
        </div>
      )}
      <Button variant="link" size="sm" className="h-auto px-0" onClick={() => openSettings("microsoft")}>
        Stattdessen App-Zugriff ohne Anmeldung einrichten <ArrowRightIcon />
      </Button>
    </div>
  );
}
