"use client";

import dynamic from "next/dynamic";
import { Spinner } from "@/components/ui/spinner";

/** The app talks to Microsoft Graph from the browser, so it is rendered client-only. */
const AppRoot = dynamic(() => import("./app-root").then((m) => m.AppRoot), {
  ssr: false,
  loading: () => (
    <div className="grid min-h-svh place-items-center">
      <Spinner className="size-5 text-muted-foreground" />
    </div>
  ),
});

export function ClientApp() {
  return <AppRoot />;
}
