"use client";

import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  FileKey2Icon,
  KeyRoundIcon,
  Trash2Icon,
  UserRoundIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { errorMessage } from "@/lib/actions";
import { checkAppAccess, type AccessReport } from "@/lib/auth";
import { describeCertificate, downloadCertificate, generateCertificate, type CertificateInfo } from "@/lib/certificate";
import { EMAIL_PATTERN, GUID_PATTERN, TENANT_PATTERN, type AccessCheck } from "@/lib/entra";
import { formatDate } from "@/lib/format";
import { redirectUri } from "@/lib/msal";
import type { ServerConfig, Settings } from "@/lib/settings";
import { cn } from "@/lib/utils";

type Patch = (patch: Partial<Settings>) => void;

const ENTRA_URL = "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade";
const appBlade = (clientId: string, blade: "CallAnAPI" | "Credentials") =>
  `https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/~/${blade}/appId/${clientId}/isMSAApp~/false`;

export interface MicrosoftErrors {
  clientId?: string;
  tenantId?: string;
  credential?: string;
  mailSender?: string;
}

/** Format errors always, missing required values only once the user tried to save. */
export function validateMicrosoft(draft: Settings, { required }: { required: boolean }): MicrosoftErrors {
  const app = draft.azureAuthMode === "app";
  const clientId = draft.azureClientId.trim();
  const tenantId = draft.azureTenantId.trim();
  const sender = draft.mailSender.trim();
  const errors: MicrosoftErrors = {};
  if (clientId && !GUID_PATTERN.test(clientId)) errors.clientId = "Die Client-ID ist eine GUID, z. B. 3f2b8c1e-…-9a4d.";
  else if (required && app && !clientId) errors.clientId = "Für den App-Zugriff ist die Client-ID nötig.";
  if (tenantId && !TENANT_PATTERN.test(tenantId)) errors.tenantId = "Erwartet wird eine GUID oder eine Domain.";
  else if (required && app && !tenantId) errors.tenantId = "Für den App-Zugriff ist die Tenant-ID nötig.";
  if (required && app && !draft.azureClientSecret.trim() && !draft.azureCertificate.trim()) {
    errors.credential = "Hinterlege ein Client-Secret oder ein Zertifikat.";
  }
  if (sender && !EMAIL_PATTERN.test(sender)) errors.mailSender = "Keine gültige E-Mail-Adresse.";
  return errors;
}

export function MicrosoftSettings({
  draft,
  patch,
  server,
  errors,
}: {
  draft: Settings;
  patch: Patch;
  server: ServerConfig;
  errors: MicrosoftErrors;
}) {
  const app = draft.azureAuthMode === "app";
  const usesPreset = !app && !draft.azureClientId && Boolean(server.azureClientId);

  return (
    <FieldGroup>
      <Field>
        <FieldLabel id="auth-mode-label">Zugriff</FieldLabel>
        <ToggleGroup
          type="single"
          variant="outline"
          value={app ? "app" : "user"}
          onValueChange={(v) => v && patch({ azureAuthMode: v === "app" ? "app" : "" })}
          aria-labelledby="auth-mode-label"
          className="w-full"
        >
          <ToggleGroupItem value="user" className="flex-1">
            <UserRoundIcon /> Benutzeranmeldung
          </ToggleGroupItem>
          <ToggleGroupItem value="app" className="flex-1">
            <KeyRoundIcon /> App-Zugriff
          </ToggleGroupItem>
        </ToggleGroup>
        <FieldDescription>
          {app
            ? "Ohne Anmeldung: Die App greift mit Client-Secret oder Zertifikat auf alle Sites zu. Ein Administrator stimmt den Berechtigungen einmalig zu."
            : "Jede Person meldet sich mit ihrem Microsoft-Konto an und sieht genau das, was sie auch in SharePoint sieht."}
        </FieldDescription>
      </Field>

      <Field data-invalid={Boolean(errors.clientId) || undefined}>
        <FieldLabel htmlFor="azure-client-id">Anwendungs-ID (Client-ID)</FieldLabel>
        <Input
          id="azure-client-id"
          value={draft.azureClientId}
          onChange={(e) => patch({ azureClientId: e.target.value })}
          placeholder={(!app && server.azureClientId) || "00000000-0000-0000-0000-000000000000"}
          aria-invalid={Boolean(errors.clientId) || undefined}
          autoComplete="off"
          spellCheck={false}
          className="font-mono text-[13px]"
        />
        {errors.clientId ? (
          <FieldError>{errors.clientId}</FieldError>
        ) : usesPreset ? (
          <FieldDescription>Leer – die Vorgabe des Servers wird verwendet.</FieldDescription>
        ) : null}
      </Field>

      <Field data-invalid={Boolean(errors.tenantId) || undefined}>
        <FieldLabel htmlFor="azure-tenant-id">
          Verzeichnis-ID (Tenant-ID) {!app && <span className="font-normal text-muted-foreground">optional</span>}
        </FieldLabel>
        <Input
          id="azure-tenant-id"
          value={draft.azureTenantId}
          onChange={(e) => patch({ azureTenantId: e.target.value })}
          placeholder={usesPreset && server.azureTenantId ? server.azureTenantId : "contoso.onmicrosoft.com oder GUID"}
          aria-invalid={Boolean(errors.tenantId) || undefined}
          autoComplete="off"
          spellCheck={false}
          className="font-mono text-[13px]"
        />
        {errors.tenantId ? (
          <FieldError>{errors.tenantId}</FieldError>
        ) : (
          <FieldDescription>
            {app ? "Der Tenant, auf den die App zugreift." : "Leer lassen, wenn die App für mehrere Organisationen registriert ist."}
          </FieldDescription>
        )}
      </Field>

      {app ? <AppAccessFields draft={draft} patch={patch} errors={errors} /> : <UserSignInFields hasClientId={Boolean(draft.azureClientId || server.azureClientId)} />}
    </FieldGroup>
  );
}

/* ------------------------------------------------------------ sign-in mode */

function UserSignInFields({ hasClientId }: { hasClientId: boolean }) {
  const uri = redirectUri();
  // expanded on first setup; afterwards the user decides (must not collapse while typing)
  const [guideOpen, setGuideOpen] = useState(!hasClientId);

  async function copy() {
    try {
      await navigator.clipboard.writeText(uri);
      toast.success("Umleitungs-URI kopiert");
    } catch {
      toast.error("Kopieren nicht möglich");
    }
  }

  return (
    <>
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

      <details className="rounded-lg border bg-muted/40 px-4 py-3 text-sm" open={guideOpen} onToggle={(e) => setGuideOpen(e.currentTarget.open)}>
        <summary className="cursor-pointer font-medium select-none marker:text-muted-foreground">So legst du die App-Registrierung an</summary>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-muted-foreground marker:text-xs">
          <li>Entra Admin Center öffnen → App-Registrierungen → Neue Registrierung.</li>
          <li>Plattform „Single-Page-Anwendung“ mit der Umleitungs-URI von oben hinzufügen.</li>
          <li>
            API-Berechtigungen (delegiert) für Microsoft Graph: <Code>User.Read</Code>, <Code>Sites.Read.All</Code>,{" "}
            <Code>Files.ReadWrite.All</Code>. Optional: SharePoint <Code>AllSites.Manage</Code> für Versionen, Papierkorb und
            Wiederherstellen, Graph <Code>Mail.Send</Code> zum Benachrichtigen.
          </li>
          <li>Anwendungs-ID und Verzeichnis-ID aus der Übersicht hier eintragen.</li>
          <li>
            Lässt deine Organisation Benutzer nicht selbst zustimmen, klickt ein Administrator einmal auf
            „Administratorzustimmung erteilen“ – danach braucht niemand mehr Adminrechte.
          </li>
        </ol>
        <Button asChild variant="link" size="sm" className="mt-2 h-auto px-0">
          <a href={ENTRA_URL} target="_blank" rel="noreferrer">
            Entra Admin Center öffnen <ExternalLinkIcon />
          </a>
        </Button>
      </details>
    </>
  );
}

const Code = ({ children }: { children: ReactNode }) => <code className="font-mono text-xs text-foreground">{children}</code>;

/* --------------------------------------------------------------- app mode */

function AppAccessFields({ draft, patch, errors }: { draft: Settings; patch: Patch; errors: MicrosoftErrors }) {
  const [reveal, setReveal] = useState(false);
  const clientId = draft.azureClientId.trim();
  const [guideOpen, setGuideOpen] = useState(!draft.azureClientSecret && !draft.azureCertificate);

  return (
    <>
      <Field data-invalid={Boolean(errors.credential) || undefined}>
        <FieldLabel htmlFor="azure-client-secret">Client-Secret</FieldLabel>
        <InputGroup>
          <InputGroupInput
            id="azure-client-secret"
            type={reveal ? "text" : "password"}
            value={draft.azureClientSecret}
            onChange={(e) => patch({ azureClientSecret: e.target.value })}
            placeholder={draft.azureCertificate ? "Optional – das Zertifikat genügt" : "Wert des geheimen Clientschlüssels"}
            aria-invalid={Boolean(errors.credential) || undefined}
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-[13px]"
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton size="icon-xs" onClick={() => setReveal((r) => !r)} aria-label={reveal ? "Secret verbergen" : "Secret anzeigen"}>
              {reveal ? <EyeOffIcon /> : <EyeIcon />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        {errors.credential ? (
          <FieldError>{errors.credential}</FieldError>
        ) : (
          <FieldDescription>Der „Wert“ aus „Zertifikate & Geheimnisse“ – nicht die Geheimnis-ID.</FieldDescription>
        )}
      </Field>

      <CertificateField value={draft.azureCertificate} onChange={(pem) => patch({ azureCertificate: pem })} />

      <Field data-invalid={Boolean(errors.mailSender) || undefined}>
        <FieldLabel htmlFor="mail-sender">
          Absender-Postfach <span className="font-normal text-muted-foreground">optional</span>
        </FieldLabel>
        <Input
          id="mail-sender"
          type="email"
          value={draft.mailSender}
          onChange={(e) => patch({ mailSender: e.target.value })}
          placeholder="speicher@contoso.com"
          aria-invalid={Boolean(errors.mailSender) || undefined}
          autoComplete="off"
          spellCheck={false}
        />
        {errors.mailSender ? (
          <FieldError>{errors.mailSender}</FieldError>
        ) : (
          <FieldDescription>Von hier gehen die Mails an Dateibesitzer raus (Anwendungsberechtigung Mail.Send).</FieldDescription>
        )}
      </Field>

      <AccessCheckPanel draft={draft} />

      <details className="rounded-lg border bg-muted/40 px-4 py-3 text-sm" open={guideOpen} onToggle={(e) => setGuideOpen(e.currentTarget.open)}>
        <summary className="cursor-pointer font-medium select-none marker:text-muted-foreground">So richtest du den App-Zugriff ein</summary>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-muted-foreground marker:text-xs">
          <li>Entra Admin Center → App-Registrierungen → deine App (oder „Neue Registrierung“).</li>
          <li>
            API-Berechtigungen → Microsoft Graph → <strong className="font-medium text-foreground">Anwendungsberechtigungen</strong>:{" "}
            <Code>Sites.Read.All</Code>, <Code>Files.ReadWrite.All</Code>. Optional: <Code>Mail.Send</Code>,{" "}
            <Code>Sites.Archive.All</Code>.
          </li>
          <li>
            Für Versionen, Papierkorb und Versionslimits zusätzlich SharePoint → Anwendungsberechtigungen →{" "}
            <Code>Sites.FullControl.All</Code> und unter „Zertifikate & Geheimnisse“ die .cer-Datei von oben hochladen.
          </li>
          <li>
            Einmalig „Administratorzustimmung erteilen“ – das darf nur ein Administrator (Globaler Administrator oder
            Administrator für privilegierte Rollen). Danach läuft alles ohne Anmeldung.
          </li>
          <li>Zertifikate & Geheimnisse → Neuer geheimer Clientschlüssel → den Wert hier als Client-Secret eintragen.</li>
        </ol>
        <div className="mt-2 flex flex-wrap gap-x-4">
          {GUID_PATTERN.test(clientId) ? (
            <>
              <Button asChild variant="link" size="sm" className="h-auto px-0">
                <a href={appBlade(clientId, "CallAnAPI")} target="_blank" rel="noreferrer">
                  API-Berechtigungen öffnen <ExternalLinkIcon />
                </a>
              </Button>
              <Button asChild variant="link" size="sm" className="h-auto px-0">
                <a href={appBlade(clientId, "Credentials")} target="_blank" rel="noreferrer">
                  Zertifikate & Geheimnisse öffnen <ExternalLinkIcon />
                </a>
              </Button>
            </>
          ) : (
            <Button asChild variant="link" size="sm" className="h-auto px-0">
              <a href={ENTRA_URL} target="_blank" rel="noreferrer">
                Entra Admin Center öffnen <ExternalLinkIcon />
              </a>
            </Button>
          )}
        </div>
      </details>
    </>
  );
}

function CertificateField({ value, onChange }: { value: string; onChange(pem: string): void }) {
  const [parsed, setParsed] = useState<{ for: string; info: CertificateInfo | null } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [paste, setPaste] = useState<string | null>(null);

  useEffect(() => {
    if (!value) return;
    let cancelled = false;
    describeCertificate(value).then((info) => !cancelled && setParsed({ for: value, info }));
    return () => {
      cancelled = true;
    };
  }, [value]);

  const info = value && parsed?.for === value ? parsed.info : null;
  const reading = Boolean(value) && parsed?.for !== value;

  async function generate() {
    setGenerating(true);
    try {
      onChange(await generateCertificate());
      toast.success("Zertifikat erzeugt", { description: "Lade die .cer-Datei in Entra hoch und speichere dann die Einstellungen." });
    } catch (e) {
      toast.error("Zertifikat konnte nicht erzeugt werden", { description: errorMessage(e) });
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Field>
      <FieldLabel>
        Zertifikat <span className="font-normal text-muted-foreground">für Versionen, Papierkorb und Versionslimits</span>
      </FieldLabel>
      {value ? (
        <div className="rounded-lg border p-3" data-testid="app-certificate">
          {reading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="size-3.5" /> Zertifikat wird gelesen …
            </p>
          ) : info ? (
            <div className="flex items-start gap-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
                <FileKey2Icon className="size-4" />
              </div>
              <div className="min-w-0 flex-1 text-sm">
                <div className="truncate font-medium">{info.subject.replace(/^CN=/, "")}</div>
                <div className="mt-0.5 font-mono text-[11px] break-all text-muted-foreground">{info.thumbprint}</div>
                <div className={cn("mt-0.5 text-xs", info.expired ? "text-destructive" : "text-muted-foreground")}>
                  {info.expired ? "Abgelaufen am" : "Gültig bis"} {formatDate(info.validTo)}
                  {!info.hasKey && " · privater Schlüssel fehlt"}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-destructive">Kein lesbares Zertifikat im PEM-Format.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {info && (
              <Button type="button" size="sm" variant="outline" onClick={() => downloadCertificate(info.certPem)}>
                <DownloadIcon /> .cer für Entra herunterladen
              </Button>
            )}
            <Button type="button" size="sm" variant="ghost" onClick={() => onChange("")}>
              <Trash2Icon /> Entfernen
            </Button>
          </div>
        </div>
      ) : paste !== null ? (
        <div className="space-y-2">
          <Textarea
            aria-label="Zertifikat im PEM-Format"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={5}
            placeholder={"-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----\n-----BEGIN PRIVATE KEY-----\n…"}
            className="font-mono text-[11px]"
            spellCheck={false}
          />
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" disabled={!paste.includes("-----BEGIN")} onClick={() => onChange(paste.trim())}>
              Übernehmen
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPaste(null)}>
              Abbrechen
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={generate} disabled={generating}>
            {generating ? <Spinner /> : <FileKey2Icon />} Zertifikat erzeugen
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setPaste("")}>
            Eigenes einfügen (PEM)
          </Button>
        </div>
      )}
      <FieldDescription>
        SharePoint akzeptiert für diese Funktionen keinen App-Zugriff per Client-Secret. Das Zertifikat wird hier erzeugt, der private
        Schlüssel bleibt auf diesem Gerät.
      </FieldDescription>
    </Field>
  );
}

const CHECK_ICON: Record<AccessCheck["state"], ReactNode> = {
  ok: <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-success" />,
  missing: <CircleXIcon className="mt-0.5 size-4 shrink-0 text-destructive" />,
  off: <CircleDashedIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />,
};

function AccessCheckPanel({ draft }: { draft: Settings }) {
  const credentials = {
    clientId: draft.azureClientId.trim(),
    tenantId: draft.azureTenantId.trim(),
    clientSecret: draft.azureClientSecret.trim(),
    certificate: draft.azureCertificate.trim(),
    mailSender: draft.mailSender.trim(),
  };
  const signature = JSON.stringify(credentials);
  const [state, setState] = useState<{ for: string; busy: boolean; report?: AccessReport; error?: string } | null>(null);
  const result = state?.for === signature ? state : null;
  const complete =
    GUID_PATTERN.test(credentials.clientId) && TENANT_PATTERN.test(credentials.tenantId) && Boolean(credentials.clientSecret || credentials.certificate);

  async function run() {
    setState({ for: signature, busy: true });
    try {
      setState({ for: signature, busy: false, report: await checkAppAccess(credentials) });
    } catch (e) {
      setState({ for: signature, busy: false, error: errorMessage(e) });
    }
  }

  return (
    <div className="rounded-xl border p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">Verbindung prüfen</div>
          <div className="text-xs text-pretty text-muted-foreground">
            {result?.report
              ? [result.report.app && `App „${result.report.app}“`, result.report.host].filter(Boolean).join(" · ") || "Token erhalten"
              : "Holt ein Token und zeigt, was die App darf – ohne zu speichern."}
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={run} disabled={!complete || result?.busy}>
          {result?.busy && <Spinner />}
          Prüfen
        </Button>
      </div>
      {result?.error && <p className="mt-3 border-t pt-3 text-sm text-pretty text-destructive">{result.error}</p>}
      {result?.report && (
        <ul className="mt-3 space-y-2.5 border-t pt-3" aria-label="Ergebnis der Prüfung">
          {result.report.checks.map((check) => (
            <li key={check.id} className="flex items-start gap-2.5 text-sm" data-state={check.state}>
              {CHECK_ICON[check.state]}
              <div className="min-w-0">
                <div>{check.label}</div>
                <div className="text-xs text-pretty break-words text-muted-foreground">{check.hint}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
