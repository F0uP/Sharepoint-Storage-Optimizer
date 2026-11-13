"use client";

import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Settings } from "@/lib/settings";

type Patch = (patch: Partial<Settings>) => void;

export function GeneralSettings({ draft, patch }: { draft: Settings; patch: Patch }) {
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="storage-price">Speicherpreis</FieldLabel>
        <InputGroup className="max-w-56">
          <InputGroupInput
            id="storage-price"
            inputMode="decimal"
            value={draft.storagePricePerGb.replace(".", ",")}
            onChange={(e) => patch({ storagePricePerGb: e.target.value.replace(",", ".") })}
            className="tabular"
          />
          <InputGroupAddon align="inline-end">
            <InputGroupText>€ pro GB und Monat</InputGroupText>
          </InputGroupAddon>
        </InputGroup>
        <FieldDescription>
          Grundlage für die Kostenschätzung. Zusätzlicher SharePoint-Speicher wird pro GB und Monat abgerechnet – trage den
          Preis aus deinem Vertrag ein.
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="inactive-months">Site gilt als inaktiv nach</FieldLabel>
        <Select value={draft.inactiveMonths} onValueChange={(v) => patch({ inactiveMonths: v })}>
          <SelectTrigger id="inactive-months" className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="6">6 Monaten ohne Änderung</SelectItem>
            <SelectItem value="12">12 Monaten ohne Änderung</SelectItem>
            <SelectItem value="24">2 Jahren ohne Änderung</SelectItem>
            <SelectItem value="36">3 Jahren ohne Änderung</SelectItem>
          </SelectContent>
        </Select>
        <FieldDescription>Inaktive Sites schlägt die Gesamtanalyse zum Archivieren vor.</FieldDescription>
      </Field>
    </FieldGroup>
  );
}
