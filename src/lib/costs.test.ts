import { describe, expect, it } from "vitest";
import { describeForecast, forecast, pricePerGb, yearlyCost } from "./costs";
import { formatCurrency } from "./format";
import { SITE_MAX_BYTES } from "./quota";
import type { Snapshot } from "./trend";

const GB = 1024 ** 3;
const NOW = Date.parse("2026-11-01T00:00:00Z");
const day = (n: number) => new Date(NOW - n * 864e5).toISOString();
const snap = (daysAgo: number, used: number, total = 1000 * GB): Snapshot => ({ at: day(daysAgo), used, total, deleted: 0 });

describe("costs", () => {
  it("prices storage per GB and month", () => {
    expect(yearlyCost(100 * GB, 0.2)).toBeCloseTo(240);
    expect(pricePerGb({ storagePricePerGb: "0,15" })).toBe(0.15);
    expect(pricePerGb({ storagePricePerGb: "abc" })).toBe(0.2);
    // Intl puts a non-breaking space before the currency sign
    expect(formatCurrency(1540).replace(/\s/g, " ")).toBe("1.540 €");
    expect(formatCurrency(12.5).replace(/\s/g, " ")).toBe("12,50 €");
  });
});

describe("forecast", () => {
  it("needs at least three readings over two weeks", () => {
    expect(forecast([snap(2, 500 * GB), snap(1, 501 * GB), snap(0, 502 * GB)], NOW)).toEqual({ status: "insufficient" });
    expect(describeForecast({ status: "insufficient" })).toContain("mindestens drei Scans");
  });

  it("extrapolates linear growth to the quota", () => {
    // +10 GB per 30 days, 100 GB left → about 10 months
    const trend = [snap(90, 870 * GB), snap(60, 880 * GB), snap(30, 890 * GB), snap(0, 900 * GB)];
    const f = forecast(trend, NOW);
    expect(f.status).toBe("growing");
    if (f.status !== "growing") return;
    expect(f.growthPerMonth / GB).toBeCloseTo(10.15, 1);
    expect(f.monthsLeft).toBeGreaterThan(9.5);
    expect(f.monthsLeft).toBeLessThan(10.5);
    expect(describeForecast(f)).toMatch(/^Voll in ca\. 10 Monaten \(.+ 2027\)\.$/);
  });

  it("recognises shrinking or full sites", () => {
    expect(forecast([snap(60, 900 * GB), snap(30, 850 * GB), snap(0, 800 * GB)], NOW).status).toBe("stable");
    expect(forecast([snap(60, 990 * GB), snap(30, 995 * GB), snap(0, 1000 * GB)], NOW).status).toBe("full");
  });

  it("predicts no date for sites without a limit of their own", () => {
    // automatic storage management: Graph reports the 25 TB maximum per site
    const pooled = [snap(90, 1700 * GB, SITE_MAX_BYTES), snap(45, 1750 * GB, SITE_MAX_BYTES), snap(0, 1800 * GB, SITE_MAX_BYTES)];
    const f = forecast(pooled, NOW);
    expect(f).toMatchObject({ status: "pooled" });
    expect(describeForecast(f)).toContain("gemeinsamen Speicher des Mandanten");
    // a site that hardly grows is stable either way
    expect(forecast([snap(60, 900 * GB, SITE_MAX_BYTES), snap(30, 900 * GB, SITE_MAX_BYTES), snap(0, 900 * GB, SITE_MAX_BYTES)], NOW).status).toBe("stable");
  });
});
