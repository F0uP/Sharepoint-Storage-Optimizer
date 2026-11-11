"use client";

import { useEffect } from "react";
import { broadcastResponseToMainFrame } from "@azure/msal-browser/redirect-bridge";

export function RedirectBridge() {
  useEffect(() => {
    broadcastResponseToMainFrame().catch(() => {
      // opened directly (not as a popup) – go back to the app
      window.location.replace("/");
    });
  }, []);

  return <p className="p-6 text-sm text-muted-foreground">Anmeldung wird abgeschlossen …</p>;
}
