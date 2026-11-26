"use client";

import { useEffect, useState } from "react";
import { MsalProvider, useMsal } from "@azure/msal-react";
import { InteractionStatus } from "@azure/msal-browser";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/spinner";
import { appSession, configureAuth, isAppAuth, isAuthConfigured } from "@/lib/auth";
import { clearCachesAfterUpdate } from "@/lib/cache-version";
import { configureMsal, getMsal, isMsalConfigured } from "@/lib/msal";
import { appCredentials, authConfig, loadSettings, useSettings } from "@/lib/settings";
import { useApp } from "@/lib/store";
import { CommandMenu } from "./command-menu";
import { SettingsDialog } from "./settings-dialog";
import { DesktopIntegration } from "./desktop-integration";
import { WelcomeDialog } from "./onboarding/welcome-dialog";
import { Automation } from "./automation";
import { LoginScreen } from "./login-screen";
import { SitePicker } from "./site-picker";
import { ScanScreen } from "./scan-screen";
import { Workspace } from "./workspace";

function Screens() {
  const mode = useApp((s) => s.mode);
  const site = useApp((s) => s.site);
  const scan = useApp((s) => s.scan);

  if (!mode) return <LoginScreen />;
  if (!site) return <SitePicker />;
  if (!scan) return <ScanScreen />;
  return (
    <>
      <Workspace />
      <CommandMenu />
    </>
  );
}

function Shell() {
  return (
    <>
      <Screens />
      <SettingsDialog />
      <WelcomeDialog />
      <DesktopIntegration />
      <Automation />
    </>
  );
}

/** Restores an existing Microsoft session after a reload. */
function SessionRestorer() {
  const { instance, accounts, inProgress } = useMsal();
  useEffect(() => {
    if (inProgress !== InteractionStatus.None || !accounts.length) return;
    if (useApp.getState().mode) return;
    instance.setActiveAccount(accounts[0]);
    useApp.getState().setMode("live");
  }, [instance, accounts, inProgress]);
  return null;
}

export function AppRoot() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // after an update no site may open from a scan the previous version cached
    Promise.all([loadSettings(), clearCachesAfterUpdate()]).then(([, cleared]) => {
      const snapshot = useSettings.getState();
      configureMsal(authConfig(snapshot));
      configureAuth(appCredentials(snapshot));
      // app access needs no sign-in: reconnect right away if it was connected before
      if (isAppAuth() && isAuthConfigured() && appSession() && !useApp.getState().mode) useApp.getState().setMode("live");
      setReady(true);
      if (cleared) {
        toast.info(`Version ${process.env.APP_VERSION} installiert`, {
          description: "Die zwischengespeicherten Scans wurden verworfen – jede Site wird beim Öffnen vollständig neu eingelesen.",
          duration: 15_000,
        });
      }
    });
  }, []);

  if (!ready) {
    return (
      <div className="grid min-h-svh place-items-center">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    );
  }
  if (isAppAuth() || !isMsalConfigured()) return <Shell />;
  return (
    <MsalProvider instance={getMsal()}>
      <SessionRestorer />
      <Shell />
    </MsalProvider>
  );
}
