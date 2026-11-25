"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { FolderIcon, SearchIcon, SparklesIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { FileTable, type FileRow } from "../file-table";
import { PageHeader } from "../page-header";
import { CATEGORY_META, CATEGORY_ORDER } from "@/lib/file-types";
import { isInFolder } from "@/lib/folders";
import { ageInYears } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { FileCategory } from "@/lib/types";

const MB = 1024 ** 2;
const SIZE_FILTERS = [
  { value: "0", label: "Jede Größe" },
  { value: String(MB), label: "> 1 MB" },
  { value: String(10 * MB), label: "> 10 MB" },
  { value: String(100 * MB), label: "> 100 MB" },
  { value: String(1024 * MB), label: "> 1 GB" },
];
const AGE_FILTERS = [
  { value: "0", label: "Jedes Alter" },
  { value: "1", label: "Älter als 1 Jahr" },
  { value: "2", label: "Älter als 2 Jahre" },
  { value: "5", label: "Älter als 5 Jahre" },
];

export function FilesView() {
  const scan = useApp((s) => s.scan)!;
  const preset = useApp((s) => s.preset);
  const [category, setCategory] = useState<FileCategory | "all">(preset?.category ?? "all");
  const [query, setQuery] = useState(preset?.query ?? "");
  const [aiOnly, setAiOnly] = useState(false);
  const ai = useApp((s) => s.ai);
  const [minSize, setMinSize] = useState("0");
  const [minAge, setMinAge] = useState("0");
  const [drive, setDrive] = useState("all");
  const [folder, setFolder] = useState(preset?.folder ?? null);
  const deferredQuery = useDeferredValue(query);

  const counts = useMemo(() => {
    const c = new Map<FileCategory, number>();
    for (const f of scan.files) c.set(f.category, (c.get(f.category) ?? 0) + 1);
    return c;
  }, [scan.files]);

  const aiHints = useMemo(
    () => new Map((ai?.recommendations ?? []).map((r) => [r.fileId, { action: r.action, reason: r.reason }] as const)),
    [ai],
  );

  const rows = useMemo<FileRow[]>(() => {
    const q = deferredQuery.trim().toLowerCase();
    const size = Number(minSize);
    const age = Number(minAge);
    const now = Date.parse(scan.scannedAt);
    return scan.files
      .filter(
        (f) =>
          (category === "all" || f.category === category) &&
          f.size >= size &&
          (drive === "all" || f.driveId === drive) &&
          (!folder || isInFolder(f, folder)) &&
          (age === 0 || ageInYears(f.modified, now) >= age) &&
          (!aiOnly || aiHints.has(f.id)) &&
          (!q || f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)),
      )
      .map((f) => ({ id: f.id, file: f, bytes: f.size, ai: aiHints.get(f.id) }));
  }, [scan.files, scan.scannedAt, category, minSize, minAge, drive, folder, deferredQuery, aiOnly, aiHints]);

  return (
    <div>
      <PageHeader title="Dateien" description="Alle Dateien der Site – nach Größe sortiert. Filtere nach Typ, Größe und Alter." />

      <div className="mb-4 flex flex-col gap-3">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={category}
          onValueChange={(v) => v && setCategory(v as FileCategory | "all")}
          className="flex-wrap"
        >
          <ToggleGroupItem value="all" className="px-3">
            Alle <span className="text-muted-foreground tabular">{scan.files.length.toLocaleString("de-DE")}</span>
          </ToggleGroupItem>
          {CATEGORY_ORDER.filter((c) => counts.get(c)).map((c) => {
            const meta = CATEGORY_META[c];
            const Icon = meta.icon;
            return (
              <ToggleGroupItem key={c} value={c} className="px-3">
                <Icon style={{ color: meta.color }} />
                {meta.plural}
                <span className="text-muted-foreground tabular">{counts.get(c)!.toLocaleString("de-DE")}</span>
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-72">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name oder Pfad suchen …" className="pl-8" />
          </div>
          <Select value={minSize} onValueChange={setMinSize}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SIZE_FILTERS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={minAge} onValueChange={setMinAge}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AGE_FILTERS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {scan.drives.length > 1 && (
            <Select value={drive} onValueChange={setDrive}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Bibliotheken</SelectItem>
                {scan.drives.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {folder && (
            <Button
              variant="secondary"
              size="sm"
              className="max-w-full"
              onClick={() => setFolder(null)}
              aria-label={`Ordnerfilter ${folder} entfernen`}
              title={folder}
            >
              <FolderIcon />
              <span className="truncate">{folder.split("/").join(" / ")}</span>
              <XIcon className="text-muted-foreground" />
            </Button>
          )}
          {aiHints.size > 0 && (
            <div className="flex h-8 items-center gap-2 rounded-lg border px-2.5">
              <Switch id="ai-only" size="sm" checked={aiOnly} onCheckedChange={setAiOnly} />
              <Label htmlFor="ai-only" className="flex items-center gap-1.5 text-sm font-normal">
                <SparklesIcon className="size-3.5 text-muted-foreground" /> Nur KI-Vorschläge
              </Label>
            </div>
          )}
        </div>
      </div>

      <FileTable rows={rows} action="delete" exportName="dateien" emptyDescription="Passe die Filter an, um Dateien zu sehen." />
    </div>
  );
}
