import type { FreeToolSlug } from "@/features/free-tools/lib/registry";

/**
 * Spend controls for the public free tools (open-seo `spend.ts`). Kept away from the marketing registry on purpose:
 * a copy edit to a tool's name or blurb must not be able to move a spend ceiling.
 *
 * Numbers count BILLABLE DATAFORSEO CALLS PER UTC DAY, not tool runs — one traffic check is three calls, one
 * competitor analysis with your own domain is five. `null` = the tool makes no paid call at all.
 * The instance-wide ceilings (all tools, per visitor, USD) come from Admin → Free SEO tools (`freeTools` settings).
 */
export const DATAFORSEO_CALLS_PER_DAY = {
  "backlink-checker": 1000,
  "competitor-keyword-finder": 2000,
  "keyword-generator": 2000,
  "website-traffic-checker": 3000,
  "competitor-analysis": 2500,
  "spam-score-checker": 600,
  "domain-age-checker": null,
  "serp-simulator": null,
} as const satisfies Record<FreeToolSlug, number | null>;

export type PaidToolSlug = {
  [K in FreeToolSlug]: (typeof DATAFORSEO_CALLS_PER_DAY)[K] extends number ? K : never;
}[FreeToolSlug];

/**
 * Conservative USD reserved per call, in millionths, at the tools' fixed result limits. No refunds: failed or
 * partially completed upstream requests stay reserved. Revisit when provider pricing or row limits change.
 */
export const RESERVED_MICRO_USD_PER_CALL: Record<PaidToolSlug, number> = {
  "backlink-checker": 25_000,
  "competitor-keyword-finder": 15_000,
  "keyword-generator": 15_000,
  "website-traffic-checker": 15_000,
  "competitor-analysis": 15_000,
  "spam-score-checker": 25_000,
};

export function isPaidTool(slug: FreeToolSlug): slug is PaidToolSlug {
  return DATAFORSEO_CALLS_PER_DAY[slug] !== null;
}

/** Estimated USD of `calls` billable calls for a paid tool (used for budget checks + UI hints). */
export function estimatedCostUsd(slug: PaidToolSlug, calls: number): number {
  return (RESERVED_MICRO_USD_PER_CALL[slug] * calls) / 1_000_000;
}
