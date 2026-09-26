/** Isomorphic constants/labels for the optimize module (Tasks, Content, Fact Check). */

export const TASK_CATEGORY_LIST = [
  "technical",
  "content",
  "visibility",
  "competitor",
  "offsite",
  "reputation",
  "setup",
] as const;
export type TaskCategoryKey = (typeof TASK_CATEGORY_LIST)[number];

export const TASK_CATEGORY_META: Record<
  TaskCategoryKey,
  { label: string; owner: string; description: string; color: string }
> = {
  technical: {
    label: "Technical",
    owner: "Web / Dev team",
    description: "Crawl access, rendering, structured data and site health issues that block AI engines.",
    color: "var(--chart-4)",
  },
  content: {
    label: "Content",
    owner: "Content team",
    description: "Prompts and questions your pages don't address yet.",
    color: "var(--chart-1)",
  },
  visibility: {
    label: "Visibility",
    owner: "SEO / GEO lead",
    description: "Prompts where AI answers don't mention your brand.",
    color: "var(--chart-2)",
  },
  competitor: {
    label: "Competitor",
    owner: "Marketing",
    description: "Gaps and head-to-head comparisons competitors win.",
    color: "var(--chart-5)",
  },
  offsite: {
    label: "Offsite",
    owner: "PR / Outreach",
    description: "Forum threads, review sites and publishers AI cites for competitors but not for you.",
    color: "var(--chart-3)",
  },
  reputation: {
    label: "Reputation",
    owner: "Brand / Comms",
    description: "Claims and criticism about your brand that AI repeats.",
    color: "var(--chart-6)",
  },
  setup: {
    label: "Setup",
    owner: "Workspace admin",
    description: "Tracking configuration gaps that limit what we can measure.",
    color: "var(--chart-7)",
  },
};

export const TASK_STATUS_META = {
  open: { label: "Open" },
  in_progress: { label: "In Progress" },
  done: { label: "Done" },
  dismissed: { label: "Dismissed" },
} as const;
export type TaskStatusKey = keyof typeof TASK_STATUS_META;

export const TASKS_EMPTY_TEXT =
  "We analyze your prompt visibility, citations, competitors, crawl access and Search Console data — and turn the findings into prioritized, evidence-backed tasks.";

/* ─────────────── Integrations ─────────────── */

export const PM_PROVIDER_KEYS = ["linear", "jira", "asana", "clickup", "trello", "monday", "notion", "awork", "webhook"] as const;
export type PmProviderKey = (typeof PM_PROVIDER_KEYS)[number];

export const CMS_PROVIDER_KEYS = ["wordpress", "webflow", "shopify_cms", "framer"] as const;
export type CmsProviderKey = (typeof CMS_PROVIDER_KEYS)[number];

/** Aliases accepted in `?connect=` links from the integrations catalog. */
export const PROVIDER_ALIASES: Record<string, string> = {
  shopify: "shopify_cms",
  shopify_blog: "shopify_cms",
  "monday.com": "monday",
  mondaycom: "monday",
  zapier: "webhook",
  n8n: "webhook",
  make: "webhook",
  jira_cloud: "jira",
};

export const PROVIDER_LABELS: Record<string, string> = {
  linear: "Linear",
  jira: "Jira Cloud",
  asana: "Asana",
  clickup: "ClickUp",
  trello: "Trello",
  monday: "monday.com",
  notion: "Notion",
  awork: "awork",
  webhook: "Webhook (Zapier, n8n, Make)",
  wordpress: "WordPress",
  webflow: "Webflow",
  shopify_cms: "Shopify",
  framer: "Framer",
};

/* ─────────────── Content ─────────────── */

export const CONTENT_STATUS_META = {
  published: { label: "Published" },
  generating: { label: "Generating" },
  draft: { label: "Draft" },
  in_review: { label: "In review" },
  failed: { label: "Failed" },
} as const;

/* ─────────────── Fact check ─────────────── */

export const FC_VERDICT_META = {
  pending: { label: "Pending", description: "Collected, not checked yet" },
  matched: { label: "Matches label", description: "The statement is backed by the reference documents" },
  off_label: { label: "Off-label", description: "Claims a use, population or indication the label does not cover" },
  contradicted: { label: "Contradicted", description: "The label says something different" },
  unsupported: { label: "Unsupported", description: "The label does not contain evidence for the claim" },
  outdated: { label: "Outdated", description: "Matches an older version of the label" },
  needs_review: { label: "Needs review", description: "Not a deviation — ambiguous, needs a human decision" },
} as const;
export type FcVerdictKey = keyof typeof FC_VERDICT_META;
export const FC_DEVIATION_KEYS = ["off_label", "contradicted", "unsupported", "outdated"] as const;
export const FC_SEVERITIES = ["critical", "major", "minor"] as const;

/** Default regulator per market (used to prefill "DE · EMA", "US · FDA"). */
const EU = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"];
export function defaultRegulator(country: string): string {
  const c = country.toUpperCase();
  const map: Record<string, string> = {
    US: "FDA",
    UK: "MHRA",
    GB: "MHRA",
    CH: "Swissmedic",
    CA: "Health Canada",
    AU: "TGA",
    NZ: "Medsafe",
    JP: "PMDA",
    CN: "NMPA",
    KR: "MFDS",
    IN: "CDSCO",
    BR: "ANVISA",
    MX: "COFEPRIS",
    NO: "EMA",
    IS: "EMA",
    LI: "EMA",
    SG: "HSA",
    ZA: "SAHPRA",
    AE: "MOHAP",
    SA: "SFDA",
    TR: "TITCK",
  };
  if (map[c]) return map[c]!;
  if (EU.includes(c)) return "EMA";
  return "Local authority";
}
