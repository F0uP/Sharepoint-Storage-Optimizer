import { describe, expect, it } from "vitest";
import { quotaUsage, siteLimit, SITE_MAX_BYTES } from "./quota";

const GB = 1024 ** 3;

describe("siteLimit", () => {
  it("uses the limit an admin set for the site", () => {
    expect(siteLimit({ total: 1024 * GB })).toBe(1024 * GB);
    expect(quotaUsage({ total: 1000 * GB, used: 900 * GB })).toBeCloseTo(0.9);
  });

  it("does not treat the 25 TB maximum per site as a limit (automatic storage management)", () => {
    // what Graph reports for every site when the tenant manages site storage automatically
    expect(SITE_MAX_BYTES).toBe(27_487_790_694_400);
    expect(siteLimit({ total: SITE_MAX_BYTES })).toBeUndefined();
    expect(quotaUsage({ total: SITE_MAX_BYTES, used: 1.75 * 1024 * GB })).toBeUndefined();
    // larger values have been seen, too – no site can use them
    expect(siteLimit({ total: 31_457_280 * GB })).toBeUndefined();
  });

  it("has nothing to compare against without a quota", () => {
    expect(siteLimit(undefined)).toBeUndefined();
    expect(siteLimit({ total: 0 })).toBeUndefined();
    expect(quotaUsage(undefined)).toBeUndefined();
  });
});
