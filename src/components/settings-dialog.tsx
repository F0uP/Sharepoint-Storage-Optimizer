"use client";

import { useState, type FormEvent } from "react";
import { create } from "zustand";
import { toast } from "sonner";
import { CircleCheckIcon, CopyIcon, ExternalLinkIcon, EyeIcon, EyeOffIcon, LockKeyholeIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DesktopSettings } from "./desktop-settings";
import { GeneralSettings } from "./general-settings";
import { errorMessage } from "@/lib/actions";
import { verifyAiProvider } from "@/lib/ai";
import { AI_PROVIDERS, MODEL_PATTERN, PROVIDER_IDS, type ProviderId } from "@/lib/ai-config";
import { redirectUri } from "@/lib/msal";
import {
  authConfig,
  desktopBridge,
  GUID_PATTERN,
  saveSettings,
  TENANT_PATTERN,
  useSettings,
  type ServerConfig,
  type Settings,
} from "@/lib/settings";

export type SettingsTab = "microsoft" | "ai" | "general" | "desktop";

export const useSettingsDialog = create<{ open: boolean; tab: SettingsTab }>()(() => ({ open: false, tab: "microsoft" }));

export function openSettings(tab: SettingsTab = "microsoft") {
  useSettingsDialog.setState({ open: true, tab });
}

const closeSettings = () => useSettingsDialog.setState({ open: false });

const ENTRA_URL = "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade";

const KEY_FIELD = { openai: "openaiApiKey", gemini: "geminiApiKey" } as const satisfies Record<ProviderId, keyof Settings>;
const MODEL_FIELD = { openai: "openaiModel", gemini: "geminiModel" } as const satisfies Record<ProviderId, keyof Settings>;

type Patch = (patch: Partial<Settings>) => void;

export function SettingsDialog() {
  const { open, tab } = useSettingsDialog();
  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeSettings()}>
      <DialogContent className="flex max-h-[min(880px,92svh)] flex-col overflow-hidden sm:max-w-xl">
        {open && <SettingsForm initialTab={tab} />}
      </DialogContent>
    </Dialog>
  );
}

function SettingsForm({ initialTab }: { initialTab: SettingsTab }) {
  const saved = useSettings((s) => s.settings);
  const server = useSettings((s) => s.server);
  const [draft, setDraft] = useState(saved);
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [saving, setSaving] = useState(false);
  const patch: Patch = (p) => setDraft((d) => ({ ...d, ...p }));

  const clientIdInvalid = draft.azureClientId.trim() !== "" && !GUID_PATTERN.test(draft.azureClientId.trim());
  const tenantInvalid = draft.azureTenantId.trim() !== "" && !TENANT_PATTERN.test(draft.azureTenantId.trim());
  const modelInvalid = PROVIDER_IDS.some((id) => {
    const model = draft[MODEL_FIELD[id]].trim();
    return model !== "" && !MODEL_PATTERN.test(model);
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (clientIdInvalid || tenantInvalid) return setTab("microsoft");
    if (modelInvalid) return setTab("ai");
    setSaving(true);
    try {
      const before = authConfig({ settings: saved, server });
      const next = await saveSettings(draft);
      const after = authConfig({ settings: next, server });
      if (before.clientId !== after.clientId || before.tenantId !== after.tenantId) {
        toast.success("Gespeichert – die Anmeldung wird neu geladen.");
        // MSAL is configured once per page load
        setTimeout(() => window.location.reload(), 700);
        return;
      }
      toast.success("Einstellungen gespeichert");
      closeSettings();
    } catch (error) {
      toast.error("Speichern fehlgeschlagen", { description: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-5" noValidate>
      <DialogHeader className="text-left">
        <DialogTitle>Einstellungen</DialogTitle>
        <DialogDescription className="flex items-start gap-1.5">
          <LockKeyholeIcon className="mt-0.5 size-3.5 shrink-0" />
          {desktopBridge()
            ? "Wird nur auf diesem Gerät gespeichert – verschlüsselt mit dem Schlüsselspeicher des Betriebssystems."
            : "Wird nur in diesem Browser gespeichert. Keine Konfigurationsdatei nötig."}
        </DialogDescription>
      </DialogHeader>

      <Tabs value={tab} onValueChange={(v) => setTab(v as SettingsTab)} className="min-h-0 flex-1 gap-0">
        <TabsList className="w-full shrink-0">
          <TabsTrigger value="microsoft">Microsoft 365</TabsTrigger>
          <TabsTrigger value="ai">KI-Anbieter</TabsTrigger>
          <TabsTrigger value="general">Allgemein</TabsTrigger>
          {desktopBridge() && <TabsTrigger value="desktop">Desktop</TabsTrigger>}
        </TabsList>
        {/* only the content scrolls – header, tabs and buttons stay in place */}
        <div className="-mx-4 mt-4 min-h-0 flex-1 overflow-y-auto px-4 pb-1">
          <TabsContent value="microsoft">
            <MicrosoftSection draft={draft} patch={patch} server={server} clientIdInvalid={clientIdInvalid} tenantInvalid={tenantInvalid} />
          </TabsContent>
          <TabsContent value="ai">
            <AiSection draft={draft} patch={patch} server={server} />
          </TabsContent>
          <TabsContent value="general">
            <GeneralSettings draft={draft} patch={patch} />
          </TabsContent>
          {desktopBridge() && (
            <TabsContent value="desktop">
              <DesktopSettings draft={draft} patch={patch} />
            </TabsContent>
          )}
        </div>
      </Tabs>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={closeSettings}>
          Abbrechen
        </Button>
        <Button type="submit" disabled={saving}>
          {saving && <Spinner />}
          Speichern
        </Button>
      </DialogFooter>
    </form>
  );
}

function MicrosoftSection({
  draft,
  patch,
  server,
  clientIdInvalid,
  tenantInvalid,
}: {
  draft: Settings;
  patch: Patch;
  server: ServerConfig;
  clientIdInvalid: boolean;
  tenantInvalid: boolean;
}) {
  const uri = redirectUri();
  const usesPreset = !draft.azureClientId && Boolean(server.azureClientId);
  // expanded on first setup; afterwards the user decides (must not collapse while typing)
  const [guideOpen, setGuideOpen] = useState(!draft.azureClientId && !server.azureClientId);

  async function copy() {
    try {
      await navigator.clipboard.writeText(uri);
      toast.success("Umleitungs-URI kopiert");
    } catch {
      toast.error("Kopieren nicht möglich");
    }
  }

  return (
    <FieldGroup>
      <p className="text-sm text-pretty text-muted-foreground">
        Der Zugriff auf SharePoint läuft über eine eigene App-Registrierung in Microsoft Entra ID. Sie ist einmalig in wenigen
        Minuten angelegt.
      </p>

      <Field data-invalid={clientIdInvalid || undefined}>
        <FieldLabel htmlFor="azure-client-id">Anwendungs-ID (Client-ID)</FieldLabel>
        <Input
          id="azure-client-id"
          value={draft.azureClientId}
          onChange={(e) => patch({ azureClientId: e.target.value })}
          placeholder={server.azureClientId || "00000000-0000-0000-0000-000000000000"}
          aria-invalid={clientIdInvalid || undefined}
          autoComplete="off"
          spellCheck={false}
          className="font-mono text-[13px]"
        />
        {clientIdInvalid ? (
          <FieldError>Die Client-ID ist eine GUID, z. B. 3f2b8c1e-…-9a4d.</FieldError>
        ) : usesPreset ? (
          <FieldDescription>Leer – die Vorgabe des Servers wird verwendet.</FieldDescription>
        ) : null}
      </Field>

      <Field data-invalid={tenantInvalid || undefined}>
        <FieldLabel htmlFor="azure-tenant-id">
          Verzeichnis-ID (Tenant-ID) <span className="font-normal text-muted-foreground">optional</span>
        </FieldLabel>
        <Input
          id="azure-tenant-id"
          value={draft.azureTenantId}
          onChange={(e) => patch({ azureTenantId: e.target.value })}
          placeholder={usesPreset && server.azureTenantId ? server.azureTenantId : "contoso.onmicrosoft.com oder GUID"}
          aria-invalid={tenantInvalid || undefined}
          autoComplete="off"
          spellCheck={false}
          className="font-mono text-[13px]"
        />
        {tenantInvalid ? (
          <FieldError>Erwartet wird eine GUID oder eine Domain.</FieldError>
        ) : (
          <FieldDescription>Leer lassen, wenn die App für mehrere Organisationen registriert ist.</FieldDescription>
        )}
      </Field>

      <Field>
        <FieldLabel htmlFor="redirect-uri">Umleitungs-URI</FieldLabel>
        <InputGroup>
          <InputGroupInput id="redirect-uri" value={uri} readOnly className="font-mono text-[13px]" />
          <InputGroupAddon align="inline-end">
            <InputGroupButton size="icon-xs" onClick={copy} aria-label="Umleitungs-URI kopieren">
              <CopyIcon />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        <FieldDescription>In der App-Registrierung unter Plattform „Single-Page-Anwendung“ eintragen.</FieldDescription>
      </Field>

      <details
        className="rounded-lg border bg-muted/40 px-4 py-3 text-sm"
        open={guideOpen}
        onToggle={(e) => setGuideOpen(e.currentTarget.open)}
      >
        <summary className="cursor-pointer font-medium select-none marker:text-muted-foreground">So legst du die App-Registrierung an</summary>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-muted-foreground marker:text-xs">
          <li>Entra Admin Center öffnen → App-Registrierungen → Neue Registrierung.</li>
          <li>Plattform „Single-Page-Anwendung“ mit der Umleitungs-URI von oben hinzufügen.</li>
          <li>
            API-Berechtigungen (delegiert) für Microsoft Graph: <code className="font-mono text-xs text-foreground">User.Read</code>,{" "}
            <code className="font-mono text-xs text-foreground">Sites.Read.All</code>, <code className="font-mono text-xs text-foreground">Files.ReadWrite.All</code>.
            Optional: SharePoint <code className="font-mono text-xs text-foreground">AllSites.Manage</code> für Versionen, Papierkorb
            und Wiederherstellen, Graph <code className="font-mono text-xs text-foreground">Mail.Send</code> zum Benachrichtigen.
          </li>
          <li>Anwendungs-ID und Verzeichnis-ID aus der Übersicht hier eintragen.</li>
        </ol>
        <Button asChild variant="link" size="sm" className="mt-2 h-auto px-0">
          <a href={ENTRA_URL} target="_blank" rel="noreferrer">
            Entra Admin Center öffnen <ExternalLinkIcon />
          </a>
        </Button>
      </details>
    </FieldGroup>
  );
}

function AiSection({ draft, patch, server }: { draft: Settings; patch: Patch; server: ServerConfig }) {
  const available = PROVIDER_IDS.filter((id) => draft[KEY_FIELD[id]] || server.aiProviders.some((p) => p.id === id));

  return (
    <FieldGroup>
      <p className="text-sm text-pretty text-muted-foreground">
        Für die KI-Analyse genügt ein Schlüssel von OpenAI oder Google Gemini. Übertragen werden nur Metadaten wie Pfad, Größe und
        Datum – keine Dateiinhalte.
      </p>
      {PROVIDER_IDS.map((id) => (
        <ProviderFields key={id} id={id} draft={draft} patch={patch} preset={server.aiProviders.find((p) => p.id === id)} />
      ))}
      {available.length > 1 && (
        <Field orientation="horizontal" className="justify-between">
          <FieldLabel htmlFor="ai-default">Standard-Anbieter</FieldLabel>
          <Select value={draft.aiProvider || available[0]} onValueChange={(v) => patch({ aiProvider: v as ProviderId })}>
            <SelectTrigger id="ai-default" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {available.map((id) => (
                <SelectItem key={id} value={id}>
                  {AI_PROVIDERS[id].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
    </FieldGroup>
  );
}

type Check = { for: string; state: "checking" | "ok" | "error"; message: string };

function ProviderFields({
  id,
  draft,
  patch,
  preset,
}: {
  id: ProviderId;
  draft: Settings;
  patch: Patch;
  preset?: { model: string };
}) {
  const meta = AI_PROVIDERS[id];
  const key = draft[KEY_FIELD[id]].trim();
  const model = draft[MODEL_FIELD[id]].trim();
  const modelInvalid = model !== "" && !MODEL_PATTERN.test(model);
  const [reveal, setReveal] = useState(false);
  const [check, setCheck] = useState<Check | null>(null);
  // A result only applies to the key/model it was made for
  const signature = `${key}|${model}`;
  const result = check?.for === signature ? check : null;

  async function verify() {
    setCheck({ for: signature, state: "checking", message: "" });
    try {
      const res = await verifyAiProvider({ provider: id, apiKey: key || undefined, model: model || undefined });
      setCheck({ for: signature, state: "ok", message: res.model });
    } catch (error) {
      setCheck({ for: signature, state: "error", message: errorMessage(error) });
    }
  }

  const status = key ? "Eigener Schlüssel" : preset ? "Server-Vorgabe" : "Nicht eingerichtet";

  return (
    <FieldSet className="gap-4 rounded-xl border p-4">
      <div className="flex items-center justify-between gap-2">
        <FieldLegend variant="label" className="mb-0">
          {meta.label}
        </FieldLegend>
        <Badge variant={key || preset ? "secondary" : "outline"} className="font-normal">
          {status}
        </Badge>
      </div>

      <Field data-invalid={result?.state === "error" || undefined}>
        <FieldLabel htmlFor={`${id}-key`}>API-Schlüssel</FieldLabel>
        <div className="flex gap-2">
          <InputGroup>
            <InputGroupInput
              id={`${id}-key`}
              type={reveal ? "text" : "password"}
              value={draft[KEY_FIELD[id]]}
              onChange={(e) => patch({ [KEY_FIELD[id]]: e.target.value })}
              placeholder={preset ? "Server-Vorgabe wird verwendet" : meta.keyPlaceholder}
              autoComplete="off"
              spellCheck={false}
              className="font-mono text-[13px]"
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton size="icon-xs" onClick={() => setReveal((r) => !r)} aria-label={reveal ? "Schlüssel verbergen" : "Schlüssel anzeigen"}>
                {reveal ? <EyeOffIcon /> : <EyeIcon />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <Button
            type="button"
            variant="outline"
            onClick={verify}
            disabled={(!key && !preset) || modelInvalid || result?.state === "checking"}
          >
            {result?.state === "checking" && <Spinner />}
            Prüfen
          </Button>
        </div>
        {result?.state === "ok" ? (
          <p className="flex items-center gap-1.5 text-xs text-success">
            <CircleCheckIcon className="size-3.5" /> Verbindung erfolgreich · {result.message}
          </p>
        ) : result?.state === "error" ? (
          <FieldError>{result.message}</FieldError>
        ) : (
          <FieldDescription>
            Schlüssel erstellen unter{" "}
            <a href={meta.keyUrl} target="_blank" rel="noreferrer" className="underline-offset-4">
              {new URL(meta.keyUrl).host}
            </a>
          </FieldDescription>
        )}
      </Field>

      <Field data-invalid={modelInvalid || undefined}>
        <FieldLabel htmlFor={`${id}-model`}>Modell</FieldLabel>
        <Input
          id={`${id}-model`}
          value={draft[MODEL_FIELD[id]]}
          onChange={(e) => patch({ [MODEL_FIELD[id]]: e.target.value })}
          placeholder={key ? meta.defaultModel : (preset?.model ?? meta.defaultModel)}
          disabled={!key}
          autoComplete="off"
          spellCheck={false}
          className="font-mono text-[13px]"
        />
        {modelInvalid ? (
          <FieldError>Ungültiger Modellname.</FieldError>
        ) : (
          <FieldDescription>{key ? `Leer lassen für ${meta.defaultModel}.` : "Wählbar mit eigenem Schlüssel."}</FieldDescription>
        )}
      </Field>
    </FieldSet>
  );
}
