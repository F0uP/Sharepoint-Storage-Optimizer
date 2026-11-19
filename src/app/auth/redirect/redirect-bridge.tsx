"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { broadcastResponseToMainFrame } from "@azure/msal-browser/redirect-bridge";

type ConsentResult = { granted: boolean; message?: string };

/** The admin consent endpoint returns here as well – without the MSAL state, as plain query parameters. */
function readConsentResult(): ConsentResult | null {
  const params = new URLSearchParams(window.location.search);
  if (params.has("state") || (!params.has("admin_consent") && !params.has("error"))) return null;
  if (params.get("admin_consent")?.toLowerCase() === "true") return { granted: true };
  return { granted: false, message: params.get("error_description")?.split(/\r?\n/)[0] ?? params.get("error") ?? undefined };
}

let cached: ConsentResult | null | undefined;
const consentSnapshot = () => (cached === undefined ? (cached = readConsentResult()) : cached);
const subscribe = () => () => {};

export function RedirectBridge() {
  // the URL is only readable in the browser – the server renders the neutral state
  const consent = useSyncExternalStore(subscribe, consentSnapshot, () => null);

  useEffect(() => {
    if (consentSnapshot()) return;
    broadcastResponseToMainFrame().catch(() => {
      // opened directly (not as a popup) – go back to the app
      window.location.replace("/");
    });
  }, []);

  if (consent) {
    return (
      <main className="grid min-h-svh place-items-center p-6">
        <div className="max-w-sm text-sm">
          <h1 className="text-lg font-semibold tracking-tight">{consent.granted ? "Zustimmung erteilt" : "Keine Zustimmung erteilt"}</h1>
          <p className="mt-2 text-pretty text-muted-foreground">
            {consent.granted
              ? "Die App darf jetzt in deiner Organisation genutzt werden – alle können sich ohne Adminrechte anmelden. Dieses Fenster kann geschlossen werden."
              : (consent.message ?? "Die Administratorzustimmung wurde abgebrochen.")}
          </p>
          <Link href="/" className="mt-4 inline-block text-sm font-medium underline underline-offset-4">
            Zur App
          </Link>
        </div>
      </main>
    );
  }
  return <p className="p-6 text-sm text-muted-foreground">Anmeldung wird abgeschlossen …</p>;
}
