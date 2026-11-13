"use client";

import { useEffect } from "react";
import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import { hasSeen, markSeen, useOnboarding } from "@/lib/onboarding";
import { useApp } from "@/lib/store";

const STEPS: DriveStep[] = [
  {
    element: '[data-tour="potential"]',
    popover: {
      title: "Dein Einsparpotenzial",
      description:
        "So viel Speicher lässt sich in dieser Site freigeben. Fang mit dem risikoarmen Teil an: Duplikate, Temp-Dateien und alte Versionen.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: '[data-tour="nav-optimize"]',
    popover: {
      title: "Optimierungen",
      description: "Automatisch erkannte Kategorien – Duplikate, Versionsverlauf, Teams-Aufnahmen, große Videos. Markieren, löschen, fertig.",
      side: "right",
    },
  },
  {
    element: '[data-tour="nav-ai"]',
    popover: {
      title: "KI-Analyse",
      description: "OpenAI oder Gemini bewerten die relevantesten Dateien und schlagen pro Datei vor, was weg kann – mit Begründung.",
      side: "right",
    },
  },
  {
    element: '[data-tour="nav-rules"]',
    popover: {
      title: "Regeln",
      description: "Wiederkehrendes Aufräumen als Profil speichern – z. B. „ZIP-Exporte älter als 3 Monate“ – und mit einem Klick anwenden.",
      side: "right",
    },
  },
  {
    element: '[data-tour="nav-history"]',
    popover: {
      title: "Verlauf & Rückgängig",
      description: "Jede Aktion wird protokolliert. Was im Papierkorb liegt, holst du hier mit einem Klick zurück.",
      side: "right",
    },
  },
  {
    element: '[data-tour="search"]',
    popover: {
      title: "Alles per Tastatur",
      description: "Mit Strg + K springst du zu Ansichten, Aktionen, Einstellungen und Dateien.",
      side: "bottom",
      align: "end",
    },
  },
  {
    element: '[data-tour="report"]',
    popover: {
      title: "Bericht",
      description: "Kennzahlen, Trend und erledigte Maßnahmen als PDF – für Vorgesetzte oder die IT.",
      side: "bottom",
      align: "end",
    },
  },
];

export function startWorkspaceTour() {
  // the tour starts on the overview, where all targets are visible
  useApp.getState().setView("overview");
  const tour = driver({
    steps: STEPS,
    popoverClass: "spo-tour",
    showProgress: true,
    progressText: "{{current}} von {{total}}",
    nextBtnText: "Weiter",
    prevBtnText: "Zurück",
    doneBtnText: "Los geht's",
    closeBtnLabel: "Tour beenden",
    stagePadding: 6,
    stageRadius: 10,
    overlayOpacity: 0.45,
    skipMissingElement: true,
    onDestroyed: () => markSeen("workspace"),
  });
  // wait one frame so the overview is rendered
  requestAnimationFrame(() => tour.drive());
}

/** Shows the tour the first time a site is opened; menus can restart it. */
export function WorkspaceTour() {
  const request = useOnboarding((s) => s.tourRequest);

  useEffect(() => {
    if (hasSeen("workspace")) return;
    const t = setTimeout(startWorkspaceTour, 700);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (request > 0) startWorkspaceTour();
  }, [request]);

  return null;
}
