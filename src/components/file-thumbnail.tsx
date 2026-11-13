"use client";

import { useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CATEGORY_META } from "@/lib/file-types";
import { useThumbnail } from "@/lib/thumbnails";
import { cn } from "@/lib/utils";
import type { SpFile } from "@/lib/types";

/** Small preview with a larger one on hover; falls back to the file type icon. */
export function FileThumbnail({ file, className }: { file: SpFile; className?: string }) {
  const url = useThumbnail(file);
  const [failed, setFailed] = useState(false);
  const meta = CATEGORY_META[file.category];
  const Icon = meta.icon;

  if (!url || failed) {
    return (
      <div className={cn("grid size-8 shrink-0 place-items-center rounded-md bg-muted/70", className)} title={meta.label}>
        <Icon className="size-4" style={{ color: meta.color }} />
      </div>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* eslint-disable-next-line @next/next/no-img-element -- pre-authenticated SharePoint URLs, not optimizable */}
        <img
          src={url}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className={cn("size-8 shrink-0 rounded-md bg-muted object-cover ring-1 ring-foreground/5", className)}
        />
      </TooltipTrigger>
      <TooltipContent side="right" className="p-1">
        {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
        <img src={url} alt={`Vorschau: ${file.name}`} className="max-h-56 max-w-72 rounded-sm object-contain" />
      </TooltipContent>
    </Tooltip>
  );
}
