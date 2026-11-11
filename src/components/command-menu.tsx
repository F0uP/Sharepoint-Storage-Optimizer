"use client";

import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { useTheme } from "next-themes";
import {
  ArrowLeftRightIcon,
  FolderOpenIcon,
  HistoryIcon,
  LayoutGridIcon,
  RefreshCwIcon,
  SparklesIcon,
  SunMoonIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { openSite } from "@/lib/actions";
import { CATEGORY_META } from "@/lib/file-types";
import { formatBytes } from "@/lib/format";
import { useApp } from "@/lib/store";

export const useCommandMenu = create<{ open: boolean; setOpen(open: boolean): void }>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

interface Entry {
  id: string;
  label: string;
  icon: LucideIcon;
  run(): void;
}

function matches(text: string, q: string) {
  return text.toLowerCase().includes(q);
}

export function CommandMenu() {
  const { open, setOpen } = useCommandMenu();
  const [query, setQuery] = useState("");
  const scan = useApp((s) => s.scan);
  const setView = useApp((s) => s.setView);
  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        useCommandMenu.getState().setOpen(!useCommandMenu.getState().open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const navigation: Entry[] = [
    { id: "overview", label: "Übersicht", icon: LayoutGridIcon, run: () => setView("overview") },
    { id: "files", label: "Dateien", icon: FolderOpenIcon, run: () => setView("files") },
    { id: "optimize", label: "Optimierungen", icon: ZapIcon, run: () => setView("optimize") },
    { id: "ai", label: "KI-Analyse", icon: SparklesIcon, run: () => setView("ai") },
  ];
  const actions: Entry[] = [
    { id: "rescan", label: "Neu scannen", icon: RefreshCwIcon, run: () => scan && openSite(scan.site, true) },
    { id: "versions", label: "Versionsverlauf analysieren", icon: HistoryIcon, run: () => setView("optimize", { insight: "versions" }) },
    { id: "theme", label: "Farbschema wechseln", icon: SunMoonIcon, run: () => setTheme(resolvedTheme === "dark" ? "light" : "dark") },
    { id: "site", label: "Site wechseln", icon: ArrowLeftRightIcon, run: () => useApp.getState().selectSite(null) },
  ];

  const q = query.trim().toLowerCase();
  const files = useMemo(() => {
    if (!scan || q.length < 2) return [];
    const hits = [];
    for (const f of scan.files) {
      if (matches(f.name, q) || matches(f.path, q)) hits.push(f);
    }
    return hits.sort((a, b) => b.size - a.size).slice(0, 8);
  }, [scan, q]);

  const renderGroup = (heading: string, entries: Entry[]) => {
    const visible = entries.filter((e) => !q || matches(e.label, q));
    if (!visible.length) return null;
    return (
      <CommandGroup heading={heading}>
        {visible.map(({ id, label, icon: Icon, run }) => (
          <CommandItem
            key={id}
            value={id}
            onSelect={() => {
              run();
              close();
            }}
          >
            <Icon />
            {label}
          </CommandItem>
        ))}
      </CommandGroup>
    );
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => (o ? setOpen(true) : close())}
      className="sm:max-w-xl"
      title="Befehle & Suche"
      description="Ansichten wechseln, Aktionen ausführen oder Dateien finden"
    >
      <Command shouldFilter={false}>
        <CommandInput placeholder="Befehl oder Dateiname suchen …" value={query} onValueChange={setQuery} />
        <CommandList>
          <CommandEmpty>Keine Treffer.</CommandEmpty>
          {files.length > 0 && (
            <CommandGroup heading="Dateien">
              {files.map((f) => {
                const Icon = CATEGORY_META[f.category].icon;
                return (
                  <CommandItem
                    key={f.id}
                    value={`file-${f.id}`}
                    onSelect={() => {
                      setView("files", { query: f.name });
                      close();
                    }}
                  >
                    <Icon style={{ color: CATEGORY_META[f.category].color }} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{f.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{f.path}</div>
                    </div>
                    <CommandShortcut className="tabular">{formatBytes(f.size)}</CommandShortcut>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}
          {renderGroup("Navigation", navigation)}
          {renderGroup("Aktionen", actions)}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
