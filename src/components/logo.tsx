import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <div className={cn("grid size-8 place-items-center rounded-lg bg-foreground text-background", className)}>
      <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
        <rect x="2" y="3" width="12" height="2.2" rx="1.1" fill="currentColor" />
        <rect x="2" y="6.9" width="8.5" height="2.2" rx="1.1" fill="currentColor" opacity="0.75" />
        <rect x="2" y="10.8" width="5" height="2.2" rx="1.1" fill="currentColor" opacity="0.5" />
      </svg>
    </div>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      <div className="leading-tight">
        <div className="text-sm font-semibold tracking-tight">Storage Optimizer</div>
        <div className="text-xs text-muted-foreground">für SharePoint</div>
      </div>
    </div>
  );
}
