"use client";

import { CircleCheckIcon, FolderOpenIcon, LayoutGridIcon, SparklesIcon, ZapIcon, type LucideIcon } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { Logo } from "./logo";
import { UserMenu } from "./user-menu";
import { useInsights } from "@/hooks/use-insights";
import { formatBytes, formatNumber, formatPercent } from "@/lib/format";
import { useApp, type View } from "@/lib/store";

const NAV: { view: View; label: string; icon: LucideIcon }[] = [
  { view: "overview", label: "Übersicht", icon: LayoutGridIcon },
  { view: "files", label: "Dateien", icon: FolderOpenIcon },
  { view: "optimize", label: "Optimierungen", icon: ZapIcon },
  { view: "ai", label: "KI-Analyse", icon: SparklesIcon },
];

export function AppSidebar() {
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const scan = useApp((s) => s.scan)!;
  const { potential } = useInsights();
  const cleanup = useApp((s) => s.cleanup);
  const quota = scan.quota;
  const usage = quota && quota.total > 0 ? quota.used / quota.total : 0;

  const badges: Partial<Record<View, string>> = {
    files: formatNumber(scan.files.length),
    optimize: potential.bytes > 0 ? formatBytes(potential.bytes, 0) : undefined,
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-14 justify-center border-b px-3 group-data-[collapsible=icon]:px-2">
        <Logo className="group-data-[collapsible=icon]:[&>div:last-child]:hidden" />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Analyse</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map(({ view: v, label, icon: Icon }) => (
                <SidebarMenuItem key={v}>
                  <SidebarMenuButton isActive={view === v} tooltip={label} onClick={() => setView(v)}>
                    <Icon />
                    <span>{label}</span>
                  </SidebarMenuButton>
                  {badges[v] && <SidebarMenuBadge className="tabular text-muted-foreground">{badges[v]}</SidebarMenuBadge>}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-3">
        {quota && (
          <button
            onClick={() => setView("overview")}
            className="rounded-lg border bg-background/50 p-3 text-left group-data-[collapsible=icon]:hidden"
          >
            <div className="flex items-baseline justify-between text-xs">
              <span className="font-medium">Speicher</span>
              <span className="text-muted-foreground tabular">{formatPercent(usage)}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(100, usage * 100)}%`,
                  background: usage > 0.9 ? "var(--destructive)" : usage > 0.75 ? "var(--warning)" : "var(--foreground)",
                }}
              />
            </div>
            <div className="mt-2 text-xs text-muted-foreground tabular">
              {formatBytes(quota.used)} von {formatBytes(quota.total)}
            </div>
            {(cleanup.freedBytes > 0 || cleanup.recycledBytes > 0) && (
              <div className="mt-3 flex items-start gap-2 border-t pt-3 text-xs">
                <CircleCheckIcon className="mt-px size-3.5 shrink-0 text-success" />
                <div className="tabular">
                  <span className="font-medium">{formatBytes(cleanup.freedBytes)}</span> freigegeben
                  {cleanup.recycledBytes > 0 && (
                    <div className="text-muted-foreground">+ {formatBytes(cleanup.recycledBytes)} im Papierkorb</div>
                  )}
                </div>
              </div>
            )}
          </button>
        )}
        <UserMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
