import { create } from "zustand";

/** Remembers which parts of the first-run introduction were shown (per browser / desktop profile). */
const KEY = "spo:onboarding";

type Step = "welcome" | "workspace";
type Flags = Partial<Record<Step, boolean>>;

function read(): Flags {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Flags;
  } catch {
    return {};
  }
}

export function hasSeen(step: Step): boolean {
  return Boolean(read()[step]);
}

export function markSeen(step: Step) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...read(), [step]: true }));
  } catch {
    // storage unavailable (private mode) – the introduction simply shows again next time
  }
}

export function resetOnboarding() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** Lets menus restart the introduction. */
export const useOnboarding = create<{ welcomeOpen: boolean; tourRequest: number }>()(() => ({
  welcomeOpen: false,
  tourRequest: 0,
}));

export function showWelcome() {
  useOnboarding.setState({ welcomeOpen: true });
}

export function requestTour() {
  useOnboarding.setState((s) => ({ tourRequest: s.tourRequest + 1 }));
}
