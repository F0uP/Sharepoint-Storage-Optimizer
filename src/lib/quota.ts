import type { Quota } from "./types";

/** The most a single SharePoint site can hold: 25 TB (SharePoint counts binary, 25 × 1024⁴ bytes). */
export const SITE_MAX_BYTES = 25 * 1024 ** 4;

/**
 * The storage limit of a site, or undefined when it has none of its own.
 *
 * With automatic storage management – the SharePoint default – sites get no individual limit, and Microsoft
 * Graph reports the 25 TB maximum per site as their quota. What actually limits them is the storage pool of
 * the whole tenant (1 TB + 10 GB per licence + purchased storage), which Graph does not expose. "4 % of 25 TB"
 * would suggest plenty of room while the tenant may already be nearly full.
 */
export function siteLimit(quota: Pick<Quota, "total"> | undefined): number | undefined {
  return quota && quota.total > 0 && quota.total < SITE_MAX_BYTES ? quota.total : undefined;
}

/** Share of the site's own limit in use, undefined when the site has no limit of its own. */
export function quotaUsage(quota: Pick<Quota, "total" | "used"> | undefined): number | undefined {
  const limit = siteLimit(quota);
  return limit && quota ? quota.used / limit : undefined;
}
