import { describe, expect, it } from "vitest";
import { ageInYears, formatBytes, formatNumber, formatPercent } from "./format";

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [512, "512 B"],
    [1024, "1 KB"],
    [1536, "1,5 KB"],
    [10 * 1024 ** 2, "10 MB"],
    [1.5 * 1024 ** 3, "1,5 GB"],
    [250 * 1024 ** 3, "250 GB"],
    [2 * 1024 ** 4, "2 TB"],
  ])("%d → %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });

  it("treats negative and invalid values as zero", () => {
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
  });

  it("respects explicit fraction digits", () => {
    expect(formatBytes(1.56 * 1024 ** 3, 0)).toBe("2 GB");
  });
});

describe("number helpers", () => {
  it("uses German separators", () => {
    expect(formatNumber(1234567)).toBe("1.234.567");
    expect(formatPercent(0.856)).toBe("86 %");
  });

  it("computes age in years relative to a reference time", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(ageInYears("2024-01-01T00:00:00Z", now)).toBeCloseTo(2, 1);
  });
});
