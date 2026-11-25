import { siteLimit } from "./quota";
import type { Settings } from "./settings";
import type { Snapshot } from "./trend";

/**
 * Cost estimates and quota forecast. Prices differ per contract, so the price per GB and month is a
 * setting (default 0,20 €); all amounts are shown as estimates.
 */

const GB = 1024 ** 3;
const DAY = 864e5;
const MONTH_DAYS = 30.44;

export function pricePerGb(settings: Pick<Settings, "storagePricePerGb">): number {
  const n = Number(settings.storagePricePerGb.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : 0.2;
}

/** What the given amount of storage costs per year at the configured price. */
export function yearlyCost(bytes: number, price: number): number {
  return (bytes / GB) * price * 12;
}

export type Forecast =
  | { status: "insufficient" }
  | { status: "full"; growthPerMonth: number }
  | { status: "stable"; growthPerMonth: number }
  /** growing, but the site has no limit of its own – it fills the shared storage of the tenant */
  | { status: "pooled"; growthPerMonth: number }
  | { status: "growing"; growthPerMonth: number; monthsLeft: number; fullAt: string };

/**
 * Linear trend over the last 180 days (least squares). Needs at least 3 readings spanning two weeks –
 * fewer readings would turn noise into a prediction.
 */
export function forecast(trend: Snapshot[], now = Date.now()): Forecast {
  const recent = trend.filter((s) => now - Date.parse(s.at) <= 180 * DAY);
  if (recent.length < 3) return { status: "insufficient" };
  const first = Date.parse(recent[0].at);
  const last = recent[recent.length - 1];
  if (Date.parse(last.at) - first < 14 * DAY) return { status: "insufficient" };

  const xs = recent.map((s) => (Date.parse(s.at) - first) / DAY);
  const ys = recent.map((s) => s.used);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  xs.forEach((x, i) => {
    num += (x - mx) * (ys[i] - my);
    den += (x - mx) ** 2;
  });
  const perDay = den ? num / den : 0;
  const growthPerMonth = perDay * MONTH_DAYS;

  const limit = siteLimit(last);
  if (limit && last.used >= limit) return { status: "full", growthPerMonth };
  // less than ~50 MB per month counts as stable
  if (perDay <= (50 * 1024 ** 2) / MONTH_DAYS) return { status: "stable", growthPerMonth };
  if (!limit) return { status: "pooled", growthPerMonth };
  const days = (limit - last.used) / perDay;
  return {
    status: "growing",
    growthPerMonth,
    monthsLeft: days / MONTH_DAYS,
    fullAt: new Date(Date.parse(last.at) + days * DAY).toISOString(),
  };
}

const monthYear = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });

/** "voll in ca. 4 Monaten (März 2027)" */
export function describeForecast(f: Forecast): string {
  switch (f.status) {
    case "insufficient":
      return "Für eine Prognose braucht es mindestens drei Scans über zwei Wochen.";
    case "full":
      return "Das Kontingent ist bereits ausgeschöpft.";
    case "stable":
      return "Der Speicher wächst derzeit kaum.";
    case "pooled":
      return "Kein eigenes Site-Limit – das Wachstum geht vom gemeinsamen Speicher des Mandanten ab.";
    case "growing": {
      const months = Math.round(f.monthsLeft);
      const when = monthYear.format(new Date(f.fullAt));
      if (f.monthsLeft < 1) return `Voll in wenigen Wochen (${when}).`;
      if (months > 60) return "Bei diesem Wachstum reicht das Kontingent noch über fünf Jahre.";
      return `Voll in ca. ${months} ${months === 1 ? "Monat" : "Monaten"} (${when}).`;
    }
  }
}
