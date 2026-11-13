"use client";

import {
  ArrowLeftRightIcon,
  ChevronsUpDownIcon,
  CompassIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  Settings2Icon,
  SunIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getMsal, isMsalConfigured, signOut } from "@/lib/msal";
import { openSettings } from "./settings-dialog";
import { requestTour, showWelcome } from "@/lib/onboarding";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/actions";

export function useCurrentUser() {
  const mode = useApp((s) => s.mode);
  if (mode === "live" && isMsalConfigured()) {
    const account = getMsal().getActiveAccount() ?? getMsal().getAllAccounts()[0];
    return { name: account?.name ?? account?.username ?? "Angemeldet", email: account?.username ?? "" };
  }
  return { name: "Demo-Modus", email: "Beispieldaten" };
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function UserMenu({ compact, className }: { compact?: boolean; className?: string }) {
  const user = useCurrentUser();
  const { theme, setTheme } = useTheme();
  const mode = useApp((s) => s.mode);
  const site = useApp((s) => s.site);

  async function logout() {
    try {
      if (mode === "live") await signOut();
    } catch (e) {
      toast.error("Abmelden fehlgeschlagen", { description: errorMessage(e) });
      return;
    }
    useApp.getState().reset();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-sidebar-accent",
          className,
        )}
      >
        <Avatar className="size-8 rounded-lg">
          <AvatarFallback className="rounded-lg text-xs font-medium">{initials(user.name) || "?"}</AvatarFallback>
        </Avatar>
        {!compact && (
          <>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-sm font-medium">{user.name}</div>
              <div className="truncate text-xs text-muted-foreground">{user.email}</div>
            </div>
            <ChevronsUpDownIcon className="size-4 text-muted-foreground" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side={compact ? "bottom" : "top"} className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="truncate text-sm font-medium">{user.name}</div>
          <div className="truncate text-xs text-muted-foreground">{user.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light">
            <SunIcon /> Hell
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <MoonIcon /> Dunkel
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <MonitorIcon /> System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => openSettings()}>
          <Settings2Icon /> Einstellungen
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => (useApp.getState().scan ? requestTour() : showWelcome())}>
          <CompassIcon /> Einführung zeigen
        </DropdownMenuItem>
        {site && (
          <DropdownMenuItem onSelect={() => useApp.getState().selectSite(null)}>
            <ArrowLeftRightIcon /> Site wechseln
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={logout}>
          <LogOutIcon /> {mode === "demo" ? "Demo beenden" : "Abmelden"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
