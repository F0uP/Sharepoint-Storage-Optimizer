"use client";

import { useEffect, useState } from "react";
import { MsalProvider, useMsal } from "@azure/msal-react";
import { InteractionStatus } from "@azure/msal-browser";
import { Spinner } from "@/components/ui/spinner";
import { configureMsal, getMsal, isMsalConfigured } from "@/lib/msal";
import { authConfig, loadSettings, useSettings } from "@/lib/settings";
import { useApp } from "@/lib/store";
import { CommandMenu } from "./command-menu";
import { SettingsDialog } from "./settings-dialog";
import { DesktopIntegration } from "./desktop-integration";
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
      <DesktopIntegration />
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
    loadSettings().then(() => {
      configureMsal(authConfig(useSettings.getState()));
      setReady(true);
    });
  }, []);

  if (!ready) {
    return (
      <div className="grid min-h-svh place-items-center">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    );
  }
  if (!isMsalConfigured()) return <Shell />;
  return (
    <MsalProvider instance={getMsal()}>
      <SessionRestorer />
      <Shell />
    </MsalProvider>
  );
}
