/**
 * Monthly cost estimator (isomorphic) — reproduces open-seo's pricing-page logic, but reports
 * RAW provider cost (self-hosted instances pay DataForSEO / AI providers directly, no markup).
 *
 * Raw DataForSEO list prices used by open-seo (§22 "Pricing page logic"):
 * - rank check (standard queue, depth 40 = 4 SERP pages, 1 device): 0.0006 + (40/10 − 1) × 0.00045 per keyword
 * - keyword research (Labs keyword ideas/suggestions call):          0.039 per search
 * - local SERP (live Maps / Local Finder, 20 results):                0.002 + 0.0015 per SERP
 * - backlink profile (summary + 1-year history):                     0.024 + 0.000036 + (0.024 + 365 × 0.000036)
 * - AI citation scan (per AI platform):                              0.85 per scan
 *
 * Rank tracking line: scheduled runs per month = sites × checksPerWeek × WEEKS_PER_MONTH, each run checks
 * `keywordsPerSite` keywords → raw = runs × keywordsPerSite × rankCheckRaw. open-seo bills one credit batch
 * per run: credits = runs × creditsForRaw(keywordsPerSite × rankCheckRaw).
 */

export const WEEKS_PER_MONTH = 4.345;

export const RAW_COSTS = {
  rankCheck: 0.0006 + (40 / 10 - 1) * 0.00045,
  keywordSearch: 0.039,
  localSerp: 0.002 + 0.0015,
  backlinkProfile: 0.024 + 0.000036 + (0.024 + 365 * 0.000036),
  aiCitation: 0.85,
} as const;

/** open-seo hosted pricing (for comparison only): 28 % markup, 1 credit = $0.001. */
export const OPENSEO_MARKUP = 1.28;
export const CREDITS_PER_USD = 1000;

export const round5 = (v: number) => Math.round(v * 1e5) / 1e5;

/** open-seo `creditsForRaw(raw) = ceil(round5(raw × 1.28) × 1000)`. */
export function creditsForRaw(raw: number): number {
  return Math.ceil(round5(raw * OPENSEO_MARKUP) * CREDITS_PER_USD);
}

export type ChecksPerWeek = 0 | 1 | 7;

export type EstimatorInput = {
  sites: number;
  keywordsPerSite: number;
  /** Manual 0 / Weekly 1 / Daily 7 */
  checksPerWeek: ChecksPerWeek;
  keywordRuns: number;
  localSerps: number;
  backlinks: number;
  aiScans: number;
};

export const CHECK_FREQUENCIES: { value: ChecksPerWeek; label: string }[] = [
  { value: 0, label: "Manual" },
  { value: 1, label: "Weekly" },
  { value: 7, label: "Daily" },
];

export const ESTIMATOR_PRESETS: Record<"business" | "freelancer", { label: string; description: string; input: EstimatorInput }> = {
  business: {
    label: "Business",
    description: "One website, weekly rank checks and regular keyword research.",
    input: { sites: 1, keywordsPerSite: 50, checksPerWeek: 1, keywordRuns: 100, localSerps: 0, backlinks: 20, aiScans: 0 },
  },
  freelancer: {
    label: "Freelancer / agency",
    description: "15 client sites, weekly rank checks, local SEO and backlink audits.",
    input: { sites: 15, keywordsPerSite: 20, checksPerWeek: 1, keywordRuns: 370, localSerps: 200, backlinks: 30, aiScans: 0 },
  },
};

export type EstimateLineKey = "rank" | "keywords" | "local" | "backlinks" | "ai";

export type EstimateLine = {
  key: EstimateLineKey;
  label: string;
  /** Billable units per month (keyword checks, searches, SERPs, profiles, scans). */
  quantity: number;
  unit: string;
  unitCost: number;
  rawCost: number;
  /** open-seo hosted credits for this line (comparison). */
  credits: number;
};

export type Estimate = {
  lines: EstimateLine[];
  rawTotal: number;
  /** Total incl. the configured agency markup (Admin → Limits & Budgets). */
  withMarkup: number;
  markupPercent: number;
  /** open-seo hosted equivalent (1.28 markup, credit rounding) in credits and USD. */
  hostedCredits: number;
  hostedUsd: number;
  scheduledRunsPerMonth: number;
};

const clampInt = (n: number, max: number) => (Number.isFinite(n) ? Math.max(0, Math.min(max, Math.round(n))) : 0);

export function sanitizeInput(input: Partial<EstimatorInput>): EstimatorInput {
  const checks = input.checksPerWeek === 7 || input.checksPerWeek === 1 ? input.checksPerWeek : 0;
  return {
    sites: clampInt(input.sites ?? 0, 10_000),
    keywordsPerSite: clampInt(input.keywordsPerSite ?? 0, 100_000),
    checksPerWeek: checks,
    keywordRuns: clampInt(input.keywordRuns ?? 0, 1_000_000),
    localSerps: clampInt(input.localSerps ?? 0, 1_000_000),
    backlinks: clampInt(input.backlinks ?? 0, 1_000_000),
    aiScans: clampInt(input.aiScans ?? 0, 1_000_000),
  };
}

export function estimateMonthlyCost(raw: Partial<EstimatorInput>, markupPercent = 0): Estimate {
  const input = sanitizeInput(raw);
  const markup = Number.isFinite(markupPercent) ? Math.max(0, markupPercent) : 0;
  const scheduledRunsPerMonth = input.sites * input.checksPerWeek * WEEKS_PER_MONTH;
  const rankChecks = scheduledRunsPerMonth * input.keywordsPerSite;

  const lines: EstimateLine[] = [
    {
      key: "rank",
      label: "Rank tracking",
      quantity: rankChecks,
      unit: "keyword checks",
      unitCost: RAW_COSTS.rankCheck,
      rawCost: rankChecks * RAW_COSTS.rankCheck,
      credits: scheduledRunsPerMonth * (input.keywordsPerSite > 0 ? creditsForRaw(input.keywordsPerSite * RAW_COSTS.rankCheck) : 0),
    },
    {
      key: "keywords",
      label: "Keyword research",
      quantity: input.keywordRuns,
      unit: "searches",
      unitCost: RAW_COSTS.keywordSearch,
      rawCost: input.keywordRuns * RAW_COSTS.keywordSearch,
      credits: input.keywordRuns * creditsForRaw(RAW_COSTS.keywordSearch),
    },
    {
      key: "local",
      label: "Local SERPs",
      quantity: input.localSerps,
      unit: "local SERPs",
      unitCost: RAW_COSTS.localSerp,
      rawCost: input.localSerps * RAW_COSTS.localSerp,
      credits: input.localSerps * creditsForRaw(RAW_COSTS.localSerp),
    },
    {
      key: "backlinks",
      label: "Backlink profiles",
      quantity: input.backlinks,
      unit: "profiles",
      unitCost: RAW_COSTS.backlinkProfile,
      rawCost: input.backlinks * RAW_COSTS.backlinkProfile,
      credits: input.backlinks * creditsForRaw(RAW_COSTS.backlinkProfile),
    },
    {
      key: "ai",
      label: "AI citation scans",
      quantity: input.aiScans,
      unit: "platform scans",
      unitCost: RAW_COSTS.aiCitation,
      rawCost: input.aiScans * RAW_COSTS.aiCitation,
      credits: input.aiScans * creditsForRaw(RAW_COSTS.aiCitation),
    },
  ];

  const rawTotal = lines.reduce((n, l) => n + l.rawCost, 0);
  const hostedCredits = lines.reduce((n, l) => n + l.credits, 0);
  return {
    lines,
    rawTotal,
    withMarkup: rawTotal * (1 + markup / 100),
    markupPercent: markup,
    hostedCredits,
    hostedUsd: hostedCredits / CREDITS_PER_USD,
    scheduledRunsPerMonth,
  };
}
