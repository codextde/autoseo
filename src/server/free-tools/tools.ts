/**
 * Server definitions of the API-backed free tools (port of open-seo `web/src/routes/api/*`): input validation,
 * cache keys, billable call counts, exact DataForSEO endpoints + payloads, and result mapping.
 * Pure orchestration — the protection pipeline (public) and the in-app action both run these through `engine.ts`.
 */
import { z } from "zod";
import type { FreeToolSlug } from "@/features/free-tools/lib/registry";
import { countryLanguage } from "@/features/free-tools/lib/countries";
import type {
  BacklinkCheckResult,
  CompetitorAnalysisResult,
  DomainAgeResult,
  DomainAgeRow,
  DomainTraffic,
  GapRow,
  KeywordFinderResult,
  KeywordGeneratorResult,
  SpamCheckResult,
  TrafficCheckResult,
} from "@/features/free-tools/lib/types";
import { normalizeDomain, normalizeKeywordSeed } from "./domain";
import {
  itemsResultSchema,
  RANKED_KEYWORDS_ORDER,
  readGapRow,
  readKeywordIdea,
  readOrganicMetrics,
  readRankedKeyword,
  readRelevantPage,
  RELEVANT_PAGES_ORDER,
} from "./labs";
import type { DfsFetch } from "./providers";

/** Result cache TTLs in seconds (open-seo): success 24h / failure 120s; RDAP success 7d / failure 5 min. */
export const CACHE_TTL = {
  success: 86_400,
  failure: 120,
  rdapSuccess: 7 * 86_400,
  rdapFailure: 300,
} as const;

export type ProviderDeps = { dfs: DfsFetch; rdap: (domain: string) => Promise<DomainAgeRow> };

/** One independently cached piece of a tool run (e.g. one domain of a traffic comparison). */
export type ToolUnit = {
  key: string;
  /** Billable DataForSEO calls when this unit is not cached. */
  calls: number;
  ttl: (data: unknown) => number;
  failureTtl: number;
  fetch: (deps: ProviderDeps) => Promise<unknown>;
};

export type ToolPlan<R> = {
  units: ToolUnit[];
  combine: (values: unknown[]) => R;
  /** Generic, user-facing failure message (cached for `failureTtl`). */
  failureMessage: string;
};

export type ParseResult<P> = { ok: true; params: P } | { ok: false; error: string };

export type ServerTool<P = unknown, R = unknown> = {
  slug: FreeToolSlug;
  parse: (body: unknown) => ParseResult<P>;
  plan: (params: P) => ToolPlan<R>;
};

const TOKEN = z.string().max(4096).optional();

function firstIssue(err: z.ZodError, fallback = "Invalid request") {
  return err.issues[0]?.message ?? fallback;
}

/** Mirrors the app's backlinks defaults (open-seo `src/server/lib/dataforseo/backlinks.ts`). */
function commonBacklinksPayload(target: string) {
  return {
    target,
    include_subdomains: true,
    include_indirect_links: true,
    exclude_internal_backlinks: true,
    backlinks_status_type: "live",
    rank_scale: "one_hundred",
  };
}

const backlinkItemSchema = z.object({
  type: z.string().nullable().optional(),
  domain_from: z.string().nullable().optional(),
  url_from: z.string().nullable().optional(),
  url_to: z.string().nullable().optional(),
  anchor: z.string().nullable().optional(),
  dofollow: z.boolean().nullable().optional(),
  domain_from_rank: z.number().nullable().optional(),
  page_from_title: z.string().nullable().optional(),
  backlink_spam_score: z.number().nullable().optional(),
});

function backlinkItems(raw: unknown) {
  const items = itemsResultSchema.parse(raw ?? {}).items ?? [];
  return items.map((i) => backlinkItemSchema.parse(i)).filter((i) => i.type === "backlink" && i.url_from);
}

const nonEmpty = (s: string | null | undefined) => (s?.trim() ? s : null);

/* ───────────────────────────── Backlink Checker ───────────────────────────── */

const targetSchema = z.object({ target: z.string().trim().min(1, "Enter a domain").max(300), turnstileToken: TOKEN });

function parseTarget(body: unknown): ParseResult<{ domain: string }> {
  const parsed = targetSchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const domain = normalizeDomain(parsed.data.target);
  return domain ? { ok: true, params: { domain } } : { ok: false, error: "Enter a valid domain, like example.com" };
}

const backlinkChecker: ServerTool<{ domain: string }, BacklinkCheckResult> = {
  slug: "backlink-checker",
  parse: parseTarget,
  plan: ({ domain }) => ({
    failureMessage: "Backlink check failed. Please try again.",
    units: [
      {
        key: domain,
        calls: 2, // summary/live + backlinks/live
        ttl: () => CACHE_TTL.success,
        failureTtl: CACHE_TTL.failure,
        fetch: async ({ dfs }) => {
          const common = commonBacklinksPayload(domain);
          const [summaryRaw, backlinksRaw] = await Promise.all([
            dfs("/v3/backlinks/summary/live", common),
            // Strongest linking domains first, like Ahrefs' free checker.
            dfs("/v3/backlinks/backlinks/live", { ...common, limit: 15, mode: "one_per_domain", order_by: ["domain_from_rank,desc"] }),
          ]);
          const summary = z
            .object({ rank: z.number().nullable().optional(), backlinks: z.number().nullable().optional(), referring_domains: z.number().nullable().optional(), broken_backlinks: z.number().nullable().optional() })
            .parse(summaryRaw ?? {});
          const result: BacklinkCheckResult = {
            target: domain,
            summary: {
              rank: summary.rank ?? null,
              backlinks: summary.backlinks ?? null,
              referringDomains: summary.referring_domains ?? null,
              brokenBacklinks: summary.broken_backlinks ?? null,
            },
            topBacklinks: backlinkItems(backlinksRaw).map((i) => ({
              domainFrom: i.domain_from ?? null,
              urlFrom: i.url_from ?? null,
              urlTo: i.url_to ?? null,
              pageTitle: nonEmpty(i.page_from_title),
              anchor: nonEmpty(i.anchor),
              dofollow: i.dofollow ?? null,
              domainRank: i.domain_from_rank ?? null,
            })),
          };
          return result;
        },
      },
    ],
    combine: ([v]) => v as BacklinkCheckResult,
  }),
};

/* ───────────────────────────── Spam Score Checker ───────────────────────────── */

const spamScoreChecker: ServerTool<{ domain: string }, SpamCheckResult> = {
  slug: "spam-score-checker",
  parse: parseTarget,
  plan: ({ domain }) => ({
    failureMessage: "Spam score check failed. Please try again.",
    units: [
      {
        key: domain,
        calls: 2,
        ttl: () => CACHE_TTL.success,
        failureTtl: CACHE_TTL.failure,
        fetch: async ({ dfs }) => {
          const common = commonBacklinksPayload(domain);
          const [summaryRaw, backlinksRaw] = await Promise.all([
            dfs("/v3/backlinks/summary/live", common),
            dfs("/v3/backlinks/backlinks/live", { ...common, limit: 10, mode: "one_per_domain", order_by: ["backlink_spam_score,desc"] }),
          ]);
          const summary = z
            .object({
              rank: z.number().nullable().optional(),
              backlinks: z.number().nullable().optional(),
              referring_domains: z.number().nullable().optional(),
              backlinks_spam_score: z.number().nullable().optional(),
              info: z.object({ target_spam_score: z.number().nullable().optional() }).nullable().optional(),
            })
            .parse(summaryRaw ?? {});
          const result: SpamCheckResult = {
            target: domain,
            spamScore: summary.backlinks_spam_score ?? null,
            targetSpamScore: summary.info?.target_spam_score ?? null,
            rank: summary.rank ?? null,
            backlinks: summary.backlinks ?? null,
            referringDomains: summary.referring_domains ?? null,
            worstBacklinks: backlinkItems(backlinksRaw).map((i) => ({
              domainFrom: i.domain_from ?? null,
              urlFrom: i.url_from ?? null,
              anchor: nonEmpty(i.anchor),
              dofollow: i.dofollow ?? null,
              domainRank: i.domain_from_rank ?? null,
              spamScore: i.backlink_spam_score ?? null,
            })),
          };
          return result;
        },
      },
    ],
    combine: ([v]) => v as SpamCheckResult,
  }),
};

/* ───────────────────────────── Website Traffic Checker ───────────────────────────── */

type Market = { locationCode: number; language: string };

function parseMarket(locationCode: number): Market | null {
  const language = countryLanguage(locationCode);
  return language ? { locationCode, language } : null;
}

async function fetchDomainTraffic(dfs: DfsFetch, domain: string, market: Market): Promise<DomainTraffic> {
  const base = { target: domain, location_code: market.locationCode, language_code: market.language };
  const [overviewRaw, keywordsRaw, pagesRaw] = await Promise.all([
    dfs("/v3/dataforseo_labs/google/domain_rank_overview/live", { ...base, limit: 1 }),
    dfs("/v3/dataforseo_labs/google/ranked_keywords/live", { item_types: ["organic"], ...base, limit: 5, order_by: RANKED_KEYWORDS_ORDER }),
    dfs("/v3/dataforseo_labs/google/relevant_pages/live", { ...base, limit: 5, order_by: RELEVANT_PAGES_ORDER }),
  ]);
  const overviewItems = itemsResultSchema.parse(overviewRaw ?? {}).items ?? [];
  const pages = itemsResultSchema.parse(pagesRaw ?? {});
  return {
    domain,
    ...readOrganicMetrics(overviewItems[0] ?? {}),
    topKeywords: (itemsResultSchema.parse(keywordsRaw ?? {}).items ?? []).map(readRankedKeyword),
    topPages: (pages.items ?? []).map(readRelevantPage),
    totalPages: pages.total_count ?? null,
  };
}

const trafficSchema = z.object({
  target: z.string().trim().min(1, "Enter a domain").max(300),
  compare: z.string().trim().max(300).optional(),
  locationCode: z.number().int(),
  turnstileToken: TOKEN,
});

type TrafficParams = { domains: string[]; market: Market };

const websiteTrafficChecker: ServerTool<TrafficParams, TrafficCheckResult> = {
  slug: "website-traffic-checker",
  parse: (body) => {
    const parsed = trafficSchema.safeParse(body);
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
    const market = parseMarket(parsed.data.locationCode);
    if (!market) return { ok: false, error: "Pick a supported country" };
    const target = normalizeDomain(parsed.data.target);
    if (!target) return { ok: false, error: "Enter a valid domain, like example.com" };
    const compareInput = parsed.data.compare?.trim();
    const compare = compareInput ? normalizeDomain(compareInput) : null;
    if (compareInput && !compare) return { ok: false, error: "Enter a valid domain to compare, like example.com" };
    return { ok: true, params: { domains: compare && compare !== target ? [target, compare] : [target], market } };
  },
  plan: ({ domains, market }) => ({
    failureMessage: "Traffic check failed. Please try again.",
    // Three calls per domain (overview + keywords + pages); only uncached domains are charged, so compare mode costs 3 or 6.
    units: domains.map((domain) => ({
      key: `organic-v2|${domain}|${market.locationCode}`,
      calls: 3,
      ttl: () => CACHE_TTL.success,
      failureTtl: CACHE_TTL.failure,
      fetch: ({ dfs }) => fetchDomainTraffic(dfs, domain, market),
    })),
    combine: (values) => ({
      locationCode: market.locationCode,
      primary: values[0] as DomainTraffic,
      comparison: (values[1] as DomainTraffic | undefined) ?? null,
    }),
  }),
};

/* ───────────────────────────── Competitor Analysis ───────────────────────────── */

const competitorSchema = z.object({
  competitor: z.string().trim().min(1, "Enter a competitor domain").max(300),
  yourDomain: z.string().trim().max(300).optional(),
  locationCode: z.number().int(),
  turnstileToken: TOKEN,
});

type CompetitorParams = { competitor: string; yourDomain: string | null; market: Market };

/**
 * Keywords the competitor ranks for and you don't (`intersections:false` = target1-only). Own try/catch: the gap is
 * the one optional part of the report, so a failure must not throw away the lists we already paid for.
 * Returns null when the lookup failed and [] when it genuinely found nothing.
 */
async function fetchKeywordGap(dfs: DfsFetch, competitor: string, yourDomain: string, base: Record<string, unknown>): Promise<GapRow[] | null> {
  try {
    const raw = await dfs("/v3/dataforseo_labs/google/domain_intersection/live", {
      ...base,
      target1: competitor,
      target2: yourDomain,
      intersections: false,
      item_types: ["organic"],
      limit: 20,
    });
    return (itemsResultSchema.parse(raw ?? {}).items ?? []).map(readGapRow).sort((a, b) => (b.traffic ?? 0) - (a.traffic ?? 0));
  } catch (err) {
    console.error("[free-tools] competitor keyword gap failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

const competitorAnalysis: ServerTool<CompetitorParams, CompetitorAnalysisResult> = {
  slug: "competitor-analysis",
  parse: (body) => {
    const parsed = competitorSchema.safeParse(body);
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
    const market = parseMarket(parsed.data.locationCode);
    if (!market) return { ok: false, error: "Pick a supported country" };
    const competitor = normalizeDomain(parsed.data.competitor);
    if (!competitor) return { ok: false, error: "Enter a valid competitor domain, like example.com" };
    const yourInput = parsed.data.yourDomain?.trim();
    const yourDomain = yourInput ? normalizeDomain(yourInput) : null;
    if (yourInput && !yourDomain) return { ok: false, error: "Enter a valid domain of your own, like example.com" };
    if (yourDomain && yourDomain === competitor) return { ok: false, error: "Enter two different domains to compare" };
    return { ok: true, params: { competitor, yourDomain, market } };
  },
  plan: ({ competitor, yourDomain, market }) => ({
    failureMessage: "Competitor analysis failed. Please try again.",
    units: [
      {
        key: `organic-v2|${competitor}|${yourDomain ?? "-"}|${market.locationCode}`,
        // ranked_keywords + relevant_pages, plus two domain_rank_overview + one domain_intersection with your domain.
        calls: yourDomain ? 5 : 2,
        // A failed gap lookup isn't worth a day of caching — short so a retry can fill it in.
        ttl: (data) => ((data as CompetitorAnalysisResult).gapFailed ? CACHE_TTL.failure : CACHE_TTL.success),
        failureTtl: CACHE_TTL.failure,
        fetch: async ({ dfs }) => {
          const base = { location_code: market.locationCode, language_code: market.language };
          const [keywordsRaw, pagesRaw] = await Promise.all([
            dfs("/v3/dataforseo_labs/google/ranked_keywords/live", {
              item_types: ["organic"],
              ...base,
              target: competitor,
              limit: 20,
              order_by: RANKED_KEYWORDS_ORDER,
            }),
            dfs("/v3/dataforseo_labs/google/relevant_pages/live", { ...base, target: competitor, limit: 10, order_by: RELEVANT_PAGES_ORDER }),
          ]);
          const keywords = itemsResultSchema.parse(keywordsRaw ?? {});
          const pages = itemsResultSchema.parse(pagesRaw ?? {});
          const result: CompetitorAnalysisResult = {
            competitor,
            yourDomain,
            locationCode: market.locationCode,
            keywords: (keywords.items ?? []).map(readRankedKeyword),
            totalKeywords: keywords.total_count ?? null,
            pages: (pages.items ?? []).map(readRelevantPage),
            totalPages: pages.total_count ?? null,
            comparison: null,
            gap: null,
            gapFailed: false,
          };
          if (yourDomain) {
            const [theirs, yours] = await Promise.all([
              dfs("/v3/dataforseo_labs/google/domain_rank_overview/live", { ...base, target: competitor, limit: 1 }),
              dfs("/v3/dataforseo_labs/google/domain_rank_overview/live", { ...base, target: yourDomain, limit: 1 }),
            ]);
            result.comparison = {
              competitor: readOrganicMetrics((itemsResultSchema.parse(theirs ?? {}).items ?? [])[0] ?? {}),
              you: readOrganicMetrics((itemsResultSchema.parse(yours ?? {}).items ?? [])[0] ?? {}),
            };
            result.gap = await fetchKeywordGap(dfs, competitor, yourDomain, base);
            result.gapFailed = result.gap === null;
          }
          return result;
        },
      },
    ],
    combine: ([v]) => v as CompetitorAnalysisResult,
  }),
};

/* ───────────────────────────── Competitor Keyword Finder ───────────────────────────── */

const finderSchema = z.object({ target: z.string().trim().min(1).max(300), locationCode: z.number().int(), turnstileToken: TOKEN });

const competitorKeywordFinder: ServerTool<{ domain: string; market: Market }, KeywordFinderResult> = {
  slug: "competitor-keyword-finder",
  parse: (body) => {
    const parsed = finderSchema.safeParse(body);
    if (!parsed.success) return { ok: false, error: "Enter a valid domain and country" };
    const market = parseMarket(parsed.data.locationCode);
    if (!market) return { ok: false, error: "Pick a supported country" };
    const domain = normalizeDomain(parsed.data.target);
    return domain ? { ok: true, params: { domain, market } } : { ok: false, error: "Enter a valid domain" };
  },
  plan: ({ domain, market }) => ({
    failureMessage: "We couldn't load keywords. Please try again.",
    units: [
      {
        key: `${domain}|${market.locationCode}`,
        calls: 1,
        ttl: () => CACHE_TTL.success,
        failureTtl: CACHE_TTL.failure,
        fetch: async ({ dfs }) => {
          const raw = await dfs("/v3/dataforseo_labs/google/ranked_keywords/live", {
            item_types: ["organic"],
            target: domain,
            order_by: RANKED_KEYWORDS_ORDER,
            location_code: market.locationCode,
            language_code: market.language,
            limit: 20,
          });
          const result: KeywordFinderResult = {
            target: domain,
            locationCode: market.locationCode,
            keywords: (itemsResultSchema.parse(raw ?? {}).items ?? []).map(readRankedKeyword),
          };
          return result;
        },
      },
    ],
    combine: ([v]) => v as KeywordFinderResult,
  }),
};

/* ───────────────────────────── Keyword Generator ───────────────────────────── */

const generatorSchema = z.object({ keyword: z.string().trim().min(1).max(100), locationCode: z.number().int(), turnstileToken: TOKEN });

const keywordGenerator: ServerTool<{ keyword: string; market: Market }, KeywordGeneratorResult> = {
  slug: "keyword-generator",
  parse: (body) => {
    const parsed = generatorSchema.safeParse(body);
    if (!parsed.success) return { ok: false, error: "Enter a valid topic and country" };
    const market = parseMarket(parsed.data.locationCode);
    if (!market) return { ok: false, error: "Pick a supported country" };
    return { ok: true, params: { keyword: normalizeKeywordSeed(parsed.data.keyword), market } };
  },
  plan: ({ keyword, market }) => ({
    failureMessage: "We couldn't load keywords. Please try again.",
    units: [
      {
        key: `core-v2|${keyword}|${market.locationCode}`,
        calls: 1,
        ttl: () => CACHE_TTL.success,
        failureTtl: CACHE_TTL.failure,
        fetch: async ({ dfs }) => {
          const raw = await dfs("/v3/dataforseo_labs/google/keyword_suggestions/live", {
            keyword,
            include_seed_keyword: false,
            include_serp_info: false,
            include_clickstream_data: false,
            exact_match: false,
            ignore_synonyms: true,
            location_code: market.locationCode,
            language_code: market.language,
            limit: 20,
          });
          const result: KeywordGeneratorResult = {
            keyword,
            locationCode: market.locationCode,
            keywords: (itemsResultSchema.parse(raw ?? {}).items ?? []).map(readKeywordIdea),
          };
          return result;
        },
      },
    ],
    combine: ([v]) => v as KeywordGeneratorResult,
  }),
};

/* ───────────────────────────── Domain Age Checker (RDAP, no DataForSEO) ───────────────────────────── */

export const MAX_AGE_DOMAINS = 10;

const ageSchema = z.object({
  domains: z
    .array(z.string().trim().min(1).max(300))
    .min(1, "Enter at least one domain")
    .max(MAX_AGE_DOMAINS, `Enter up to ${MAX_AGE_DOMAINS} domains`),
  turnstileToken: TOKEN,
});

const domainAgeChecker: ServerTool<{ domains: string[] }, DomainAgeResult> = {
  slug: "domain-age-checker",
  parse: (body) => {
    const parsed = ageSchema.safeParse(body);
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
    const domains = [...new Set(parsed.data.domains.map(normalizeDomain).filter((d): d is string => d !== null))];
    if (domains.length === 0) return { ok: false, error: "Enter at least one valid domain, like example.com" };
    return { ok: true, params: { domains } };
  },
  plan: ({ domains }) => ({
    failureMessage: "Domain age lookup failed. Please try again.",
    // Only successful lookups are cached for a week; a failed row briefly so a flaky registry isn't hammered.
    units: domains.map((domain) => ({
      key: domain,
      calls: 0,
      ttl: (row) => ((row as DomainAgeRow).error ? CACHE_TTL.rdapFailure : CACHE_TTL.rdapSuccess),
      failureTtl: CACHE_TTL.rdapFailure,
      fetch: ({ rdap }) => rdap(domain),
    })),
    combine: (values) => ({ rows: values as DomainAgeRow[] }),
  }),
};

/** API-backed tools (the SERP simulator runs entirely in the browser). */
export const SERVER_TOOLS: Partial<Record<FreeToolSlug, ServerTool>> = {
  "backlink-checker": backlinkChecker as ServerTool,
  "spam-score-checker": spamScoreChecker as ServerTool,
  "website-traffic-checker": websiteTrafficChecker as ServerTool,
  "competitor-analysis": competitorAnalysis as ServerTool,
  "competitor-keyword-finder": competitorKeywordFinder as ServerTool,
  "keyword-generator": keywordGenerator as ServerTool,
  "domain-age-checker": domainAgeChecker as ServerTool,
};

export function getServerTool(slug: string): ServerTool | null {
  // Own-property lookup: "constructor" / "__proto__" must not resolve to Object.prototype members.
  return Object.hasOwn(SERVER_TOOLS, slug) ? (SERVER_TOOLS as Record<string, ServerTool>)[slug]! : null;
}
