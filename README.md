# Storage Optimizer für SharePoint

Analysiert den Speicher von SharePoint-Sites direkt über die **Microsoft Graph API**, zeigt die größten Platzfresser
und gibt Speicher per Mehrfachauswahl frei – mit KI-Empfehlungen über **OpenAI** oder **Google Gemini**.

- **Übersicht** – Kontingent, Einsparpotenzial (davon risikoarm), Speicher nach Dateityp, größte Ordner, Datenalter, größte Dateien
- **Dateien** – alle Dateien nach Größe, Filter nach Typ (Videos, Bilder, …), Größe, Alter, Bibliothek, Suche, „Nur KI-Vorschläge“
- **Optimierungen** – automatisch erkannt: Duplikate (Inhalts-Hash), Versionsverlauf, große Videos, lange nicht genutzte
  Dateien, Archive & Installer, große Bilder/RAW, Temp-Dateien, KI-Löschempfehlungen, Papierkorb
- **KI-Analyse** – bewertet die ~700 relevantesten Dateien und schlägt pro Datei *Löschen, Versionen bereinigen,
  Archivieren, Komprimieren* oder *Prüfen* vor – mit Priorität und Begründung, Schnellauswahl „Hohe Priorität“,
  Ignorieren, direktem Löschen. Die Vorschläge erscheinen auch als Markierung in der Dateiliste und als eigene Optimierung.
  Übertragen werden nur Metadaten, keine Dateiinhalte.
- Mehrfachauswahl über Seiten hinweg (Shift-Klick für Bereiche, „Alle X auswählen“), Löschen in den Papierkorb oder endgültig
- **Befehlspalette** (<kbd>Strg</kbd>+<kbd>K</kbd>) für Navigation, Aktionen und Dateisuche
- **CSV-Export** jeder Liste oder Auswahl (Excel-kompatibel) – z. B. zur Abstimmung mit Kollegen vor dem Löschen
- Zähler „bereits freigegeben“ pro Sitzung, Scan- und KI-Ergebnisse bleiben nach einem Reload erhalten
- **Demo-Modus** mit Beispieldaten – funktioniert ohne Azure-Einrichtung

## Schnellstart

```bash
npm install
cp .env.example .env.local   # Werte eintragen, siehe unten
npm run dev                  # http://localhost:3000
```

Ohne Konfiguration läuft die App im Demo-Modus („Demo ansehen“).

## 1. Azure-App registrieren (einmalig, ca. 5 Minuten)

1. [Entra Admin Center](https://entra.microsoft.com) → **App-Registrierungen** → **Neue Registrierung**
   - Name: z. B. `Storage Optimizer`
   - Kontotypen: *Nur Konten in diesem Organisationsverzeichnis*
   - Umleitungs-URI: Plattform **Single-Page-Anwendung (SPA)**, URI `http://localhost:3000/auth/redirect`
     (für andere Hosts zusätzlich `https://<host>/auth/redirect`)
2. **API-Berechtigungen** → *Berechtigung hinzufügen* → **Delegiert**:

   | API | Berechtigung | Wofür |
   | --- | --- | --- |
   | Microsoft Graph | `User.Read` | Anmeldung |
   | Microsoft Graph | `Sites.Read.All` | Sites & Bibliotheken auflisten, Dateien scannen |
   | Microsoft Graph | `Files.ReadWrite.All` | Dateien löschen |
   | SharePoint | `AllSites.Manage` | *optional:* Versionen bereinigen, Papierkorb leeren |

   Keine davon erfordert zwingend Admin-Zustimmung – je nach Tenant-Richtlinie kann sie aber nötig sein.
3. *Anwendungs-(Client-)ID* und *Verzeichnis-(Mandanten-)ID* in `.env.local` eintragen:

```env
AZURE_CLIENT_ID=00000000-0000-0000-0000-000000000000
AZURE_TENANT_ID=00000000-0000-0000-0000-000000000000
```

Die App arbeitet immer **mit den Rechten des angemeldeten Benutzers** – sie sieht und löscht nur, was dieser auch in
SharePoint darf. Für das Leeren des endgültigen Papierkorbs (Stufe 2) sind Websitesammlungs-Adminrechte nötig.

## 2. KI verbinden (optional)

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.4-mini

GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.8-flash

AI_PROVIDER=openai   # bevorzugter Anbieter, wenn beide gesetzt sind
```

Ein Anbieter genügt. Sind beide konfiguriert, lässt sich der Anbieter in der KI-Analyse auswählen.
Die Keys bleiben serverseitig (Next.js Route Handler) und werden nie an den Browser gesendet. Beide Anbieter
liefern strukturierte Ausgaben gegen dasselbe Zod-Schema (OpenAI Structured Outputs bzw. Gemini `responseJsonSchema`).

## Wichtig zum Speicher in SharePoint

- **Papierkorb zählt mit.** Gelöschte Dateien belegen bis zu 93 Tage weiter das Kontingent. Für sofortige Wirkung
  „Endgültig löschen“ wählen oder anschließend den Papierkorb leeren.
- **Versionen sind oft der größte versteckte Posten.** Der Versions-Scan prüft die größten Dateien und Office-Dokumente;
  beim Bereinigen bleibt die aktuelle Version immer erhalten, alte Versionen werden endgültig gelöscht.
- Scan-Ergebnisse werden lokal im Browser (IndexedDB) zwischengespeichert – „Neu scannen“ holt den aktuellen Stand.

## Tests

```bash
npm run test           # Unit- & Komponententests (Vitest)
npm run test:coverage  # mit Coverage-Report in ./coverage
npm run build && npm run test:e2e   # End-to-End (Playwright, Demo-Modus)
npm run check          # Lint + Typecheck + Tests
```

Lokal ohne heruntergeladenes Chromium: `PW_CHANNEL=msedge npm run test:e2e` nutzt das installierte Edge.
Die E2E-Tests fangen die KI-Route ab – es werden keine API-Keys benötigt.

## CI/CD (GitHub Actions)

| Workflow | Auslöser | Inhalt |
| --- | --- | --- |
| `ci.yml` | Push auf `main`, Pull Requests | Lint, Typecheck (TS 7), Unit-/Komponententests mit Coverage, Produktions-Build, Playwright-E2E |
| `release.yml` | grüner CI-Lauf auf `main`, Tags `v*` | Docker-Image nach `ghcr.io/<owner>/<repo>` (`edge` bzw. `1.2.3` / `latest`) |
| `dependabot.yml` | wöchentlich | hält npm-Pakete und Actions auf dem neuesten Stand |

Release erstellen: `git tag v1.0.0 && git push --tags`.

## Docker

```bash
docker run -p 3000:3000 \
  -e AZURE_CLIENT_ID=... -e AZURE_TENANT_ID=... \
  -e OPENAI_API_KEY=... -e GEMINI_API_KEY=... \
  ghcr.io/<owner>/<repo>:latest
```

Alle Einstellungen werden zur Laufzeit gelesen – dasselbe Image funktioniert für jeden Tenant.
Die Redirect-URI `https://<host>/auth/redirect` muss in der App-Registrierung eingetragen sein.

## Technik

| Bereich | Eingesetzt |
| --- | --- |
| Framework | Next.js 16 (App Router, Turbopack, Cache Components, Standalone-Output), React 19 |
| Sprache | TypeScript 7 (`tsc`), plus `@typescript/typescript6` als API für ESLint (offizielles Parallel-Setup) |
| UI | Tailwind CSS 4, shadcn/ui (Radix), cmdk, lucide-react, sonner, next-themes (Hell/Dunkel) |
| Tabelle | TanStack Table v9 (Sortierung, Pagination, Mehrfach- & Bereichsauswahl) |
| Diagramme | Recharts 3 über shadcn Charts, farbfehlsichtigkeits-geprüfte Palette |
| Auth | MSAL Browser/React v5 (Popup-Login, PKCE), Konfiguration zur Laufzeit über `/api/config` |
| Daten | Microsoft Graph Client (Delta-Query für vollständige Inventur, JSON-Batching, Retry bei Drosselung) |
| SharePoint REST | Proxy-Route `/api/sharepoint` für Versionen & Papierkorb (umgeht CORS, nur `*.sharepoint.com`) |
| KI | OpenAI SDK v7 (Responses API) und Google Gen AI SDK v3, gemeinsames Zod-4-Schema |
| State | Zustand, idb-keyval; CSV über Papa Parse |
| Tests | Vitest 5 + Testing Library (jsdom), Playwright |

```
src/
  app/            Layout, Seite, Login-Redirect, API-Routen (ai/analyze, sharepoint, config)
  components/     App-Shell, Sidebar, Dateitabelle, Dialoge, Befehlspalette, Ansichten (views/), Diagramme
  lib/            graph.ts (Graph API), demo.ts, analysis.ts (Regeln), ai.ts, actions.ts, store.ts, csv.ts
  lib/server/     KI-Anbieter (OpenAI, Gemini), Prompt – nur serverseitig
e2e/              Playwright-Tests
tests/            Test-Setup und Fabriken
```
