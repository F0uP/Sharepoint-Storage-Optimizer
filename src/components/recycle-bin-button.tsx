"use client";

import { useState } from "react";
import { Trash2Icon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { emptyRecycleBinAction } from "@/lib/actions";
import { formatBytes } from "@/lib/format";
import { useApp } from "@/lib/store";

export function RecycleBinButton({ size = "sm", variant = "outline" }: { size?: "sm" | "default"; variant?: "outline" | "default" }) {
  const deleted = useApp((s) => s.scan?.quota?.deleted ?? 0);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    await emptyRecycleBinAction();
    setBusy(false);
    setOpen(false);
  }

  return (
    <>
      <Button size={size} variant={variant} disabled={deleted <= 0} onClick={() => setOpen(true)}>
        <Trash2Icon /> Papierkorb leeren
      </Button>
      <AlertDialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader className="flex flex-row items-start gap-4 text-left">
            <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-destructive/10 text-destructive">
              <Trash2Icon className="size-5" />
            </div>
            <div className="space-y-1">
              <AlertDialogTitle>Papierkorb endgültig leeren?</AlertDialogTitle>
              <AlertDialogDescription>
                {formatBytes(deleted)} werden freigegeben. Gelöschte Elemente können danach nicht mehr wiederhergestellt
                werden – auch nicht aus dem endgültigen Papierkorb (Stufe 2).
              </AlertDialogDescription>
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Abbrechen</AlertDialogCancel>
            <Button className="bg-destructive text-white hover:bg-destructive/90" onClick={run} disabled={busy}>
              {busy && <Spinner />} Endgültig leeren
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
