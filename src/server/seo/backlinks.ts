import "server-only";
import { z } from "zod";
import { assertCanRun, SeoError, type SeoContext } from "./context";
import { dfsLive, firstItems } from "./dfs";
import { buildCacheKey, cacheGet, cachePeek, cacheSet, CACHE_TTL } from "./cache";
import {
  BACKLINKS_DOMAIN_PAGES_PATH,
  BACKLINKS_HISTORY_PATH,
  BACKLINKS_REFERRING_DOMAINS_PATH,
  BACKLINKS_ROWS_PATH,
  BACKLINKS_ROWS_SORT_FIELDS,
  BACKLINKS_SUMMARY_PATH,
  buildBacklinksDateRange,
  buildBacklinksRowsApiFilters,
  buildCommonBacklinksPayload,
  buildOverviewResult,
  buildPageResult,
  buildReferringDomainsApiFilters,
  buildTopPagesApiFilters,
  combineFilters,
  mapBacklinksRows,
  mapReferringDomainsRows,
  mapTopPagesRows,
  normalizeBacklinksTarget,
  normalizeDrDomain,
  normalizeSpamOptions,
  REFERRING_DOMAINS_SORT_FIELDS,
  TOP_PAGES_SORT_FIELDS,
  type BacklinkApiItem,
  type BacklinkRow,
  type BacklinksHistoryItem,
  type BacklinksOverview,
  type BacklinksSummaryItem,
  type DomainPageSummaryApiItem,
  type NormalizedBacklinksTarget,
  type PageResult,
  type ReferringDomainApiItem,
  type ReferringDomainRow,
  type SpamOptions,
  type TopPageRow,
} from "./lib/backlinks";
import { assertFilterConditionBudget, buildBacklinksScopeFilter, countExpressionConditions, prependScopeClauses } from "./lib/filters";
import { BACKLINKS_PAGE_ESTIMATE_USD, estimateBacklinksOverview } from "./lib/costs";

function normalizeTarget(target: string, scope?: string): NormalizedBacklinksTarget {
  try {
    return normalizeBacklinksTarget(target, scope);
  } catch (err) {
    throw new SeoError("VALIDATION_ERROR", (err as Error).message);
  }
}

function targetCacheParams(ctx: SeoContext, t: NormalizedBacklinksTarget) {
  return { projectId: ctx.projectId, target: t.apiTarget, scope: t.scope, path: t.path, includeSubdomains: t.includeSubdomains };
}

function budget(n: number) {
  try {
    assertFilterConditionBudget(n);
  } catch (err) {
    throw new SeoError("VALIDATION_ERROR", (err as Error).message);
  }
}

/**
 * Latest stored backlinks overview for a target (domain / subdomains scope), read from the cache only —
 * never calls DataForSEO. Used by the project dashboard; `stale` when older than the cache TTL.
 */
export async function peekBacklinksOverview(
  ctx: Pick<SeoContext, "projectId">,
  target: string,
): Promise<{ overview: BacklinksOverview; capturedAt: Date; stale: boolean } | null> {
  const hits = await Promise.all(
    (["domain", "subdomains"] as const).map(async (scope) => {
      try {
        return await cachePeek<BacklinksOverview>(buildCacheKey("backlinks:overview", targetCacheParams(ctx as SeoContext, normalizeTarget(target, scope))));
      } catch {
        return null;
      }
    }),
  );
  const best = hits.filter((h) => h != null).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  return best ? { overview: best.value, capturedAt: best.createdAt, stale: best.stale } : null;
}

export const backlinksLookupInput = z.object({
  target: z.string().trim().min(1).max(500),
  scope: z.enum(["exact_url", "subfolder", "domain", "subdomains", "page"]).optional(),
});

/**
 * subfolder: two limit:1 backlinks/live calls (as_is → backlinks, one_per_domain → referring domains);
 * exact_url: summary only; domain/subdomains: summary + 1-year history in parallel. 6h cache.
 */
export async function getBacklinksOverview(ctx: SeoContext, raw: z.input<typeof backlinksLookupInput>): Promise<BacklinksOverview & { cached: boolean }> {
  const input = backlinksLookupInput.parse(raw);
  const t = normalizeTarget(input.target, input.scope);
  const key = buildCacheKey("backlinks:overview", targetCacheParams(ctx, t));
  const cached = await cacheGet<BacklinksOverview>(key);
  if (cached) return { ...cached.value, cached: true };
  assertCanRun(ctx);
  const now = new Date();
  let overview: BacklinksOverview;
  if (t.scope === "subfolder") {
    const filters = buildBacklinksScopeFilter("url_to", t).clauses;
    const call = (mode: string) =>
      dfsLive<{ items?: BacklinkApiItem[] | null; total_count?: number | null }>(
        ctx,
        BACKLINKS_ROWS_PATH,
        { ...buildCommonBacklinksPayload({ target: t.apiTarget, includeSubdomains: t.includeSubdomains }), limit: 1, mode, filters, order_by: ["rank,desc"] },
        { feature: "backlinks", estimatedCostUsd: 0.02 },
      );
    // Sequenced (not parallel) like open-seo.
    const all = firstItems(await call("as_is"));
    const perDomain = firstItems(await call("one_per_domain"));
    overview = {
      target: t.apiTarget,
      displayTarget: t.displayTarget,
      scope: "subfolder",
      summary: {
        rank: null,
        backlinks: all.totalCount,
        referringPages: null,
        referringDomains: perDomain.totalCount,
        brokenBacklinks: null,
        brokenPages: null,
        backlinksSpamScore: null,
        targetSpamScore: null,
        newBacklinks: null,
        lostBacklinks: null,
        newReferringDomains: null,
        lostReferringDomains: null,
      },
      trends: [],
      newLostTrends: [],
      fetchedAt: now.toISOString(),
    };
  } else {
    const range = buildBacklinksDateRange(now);
    const [summaryTask, historyTask] = await Promise.all([
      dfsLive<BacklinksSummaryItem>(ctx, BACKLINKS_SUMMARY_PATH, buildCommonBacklinksPayload({ target: t.apiTarget, includeSubdomains: t.includeSubdomains }), {
        feature: "backlinks",
        estimatedCostUsd: estimateBacklinksOverview(t.scope) / 2,
      }),
      // history/live only accepts a hostname and has no include_subdomains → always subdomain-inclusive.
      t.scope === "exact_url"
        ? Promise.resolve(null)
        : dfsLive<{ items?: BacklinksHistoryItem[] | null }>(
            ctx,
            BACKLINKS_HISTORY_PATH,
            { target: t.apiTarget, date_from: range.dateFrom, date_to: range.dateTo, rank_scale: "one_hundred" },
            { feature: "backlinks", estimatedCostUsd: estimateBacklinksOverview(t.scope) / 2 },
          ),
    ]);
    overview = buildOverviewResult({
      target: t,
      now,
      summary: summaryTask.result[0] ?? {},
      history: (historyTask?.result[0]?.items ?? []).filter((i): i is BacklinksHistoryItem => i != null),
    });
  }
  await cacheSet(key, "backlinks:overview", ctx.projectId, overview, CACHE_TTL.backlinks);
  return { ...overview, cached: false };
}

const n = z.number().finite().optional();
const pageBase = {
  page: z.number().int().positive().default(1),
  pageSize: z.union([z.literal(50), z.literal(100), z.literal(200)]).default(100),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  /** Web UI: spam is a user filter (default false). MCP default true (threshold 40). */
  hideSpam: z.boolean().default(false),
  spamThreshold: z.number().min(0).max(100).optional(),
};

export const backlinksRowsInput = backlinksLookupInput.extend({
  ...pageBase,
  sortField: z.enum(Object.keys(BACKLINKS_ROWS_SORT_FIELDS) as [keyof typeof BACKLINKS_ROWS_SORT_FIELDS, ...(keyof typeof BACKLINKS_ROWS_SORT_FIELDS)[]]).default("firstSeen"),
  mode: z.enum(["one_per_domain", "as_is"]).default("one_per_domain"),
  filters: z
    .object({
      include: z.string().max(500).optional(),
      exclude: z.string().max(500).optional(),
      minDomainRank: n,
      maxDomainRank: n,
      minLinkAuthority: n,
      maxLinkAuthority: n,
      minSpamScore: n,
      maxSpamScore: n,
      linkType: z.enum(["dofollow", "nofollow"]).optional(),
      hideLost: z.boolean().optional(),
      hideBroken: z.boolean().optional(),
      domainFrom: z.string().max(253).optional(),
    })
    .default({}),
});

async function pagedCall<TItem, TRow>(
  ctx: SeoContext,
  prefix: string,
  cacheParams: Record<string, unknown>,
  path: string,
  payload: Record<string, unknown>,
  page: { page: number; pageSize: number },
  map: (items: TItem[]) => TRow[],
): Promise<PageResult<TRow> & { cached: boolean }> {
  const key = buildCacheKey(prefix, cacheParams);
  const cached = await cacheGet<PageResult<TRow>>(key);
  if (cached) return { ...cached.value, cached: true };
  assertCanRun(ctx);
  const offset = (page.page - 1) * page.pageSize;
  const task = await dfsLive<{ items?: TItem[] | null; total_count?: number | null }>(ctx, path, { ...payload, limit: page.pageSize, offset }, {
    feature: "backlinks",
    estimatedCostUsd: BACKLINKS_PAGE_ESTIMATE_USD,
  });
  const { items, totalCount } = firstItems(task);
  const result = buildPageResult(page, offset, map(items), totalCount);
  await cacheSet(key, prefix, ctx.projectId, result, CACHE_TTL.backlinks);
  return { ...result, cached: false };
}

function spamKey(o: SpamOptions) {
  const s = normalizeSpamOptions(o);
  return { hideSpam: String(s.hideSpam), ...(s.hideSpam ? { spamThreshold: String(s.spamThreshold) } : {}) };
}

export async function getBacklinksRows(ctx: SeoContext, raw: z.input<typeof backlinksRowsInput>): Promise<PageResult<BacklinkRow> & { cached: boolean }> {
  const input = backlinksRowsInput.parse(raw);
  const t = normalizeTarget(input.target, input.scope);
  const scope = buildBacklinksScopeFilter("url_to", t);
  let user: unknown[];
  try {
    user = buildBacklinksRowsApiFilters(input.filters);
  } catch (err) {
    throw new SeoError("VALIDATION_ERROR", (err as Error).message);
  }
  const spam = normalizeSpamOptions({ hideSpam: input.hideSpam, spamThreshold: input.spamThreshold });
  budget(scope.conditionCount + countExpressionConditions(user) + (spam.hideSpam ? 1 : 0));
  const filters = combineFilters(prependScopeClauses(scope, user), spam.hideSpam ? ["backlink_spam_score", "<=", spam.spamThreshold] : undefined);
  return pagedCall<BacklinkApiItem, BacklinkRow>(
    ctx,
    "backlinks:rows-page",
    {
      ...targetCacheParams(ctx, t),
      page: input.page,
      pageSize: input.pageSize,
      sortField: input.sortField,
      sortOrder: input.sortOrder,
      filters: input.filters,
      mode: input.mode,
      ...spamKey(spam),
    },
    BACKLINKS_ROWS_PATH,
    {
      ...buildCommonBacklinksPayload({ target: t.apiTarget, includeSubdomains: t.includeSubdomains }),
      order_by: [`${BACKLINKS_ROWS_SORT_FIELDS[input.sortField]},${input.sortOrder}`],
      mode: input.mode,
      filters,
    },
    input,
    mapBacklinksRows,
  );
}

export const referringDomainsInput = backlinksLookupInput.extend({
  ...pageBase,
  sortField: z
    .enum(Object.keys(REFERRING_DOMAINS_SORT_FIELDS) as [keyof typeof REFERRING_DOMAINS_SORT_FIELDS, ...(keyof typeof REFERRING_DOMAINS_SORT_FIELDS)[]])
    .default("backlinks"),
  filters: z
    .object({
      include: z.string().max(500).optional(),
      exclude: z.string().max(500).optional(),
      minBacklinks: n,
      maxBacklinks: n,
      minRank: n,
      maxRank: n,
      minSpamScore: n,
      maxSpamScore: n,
    })
    .default({}),
});

export async function getReferringDomains(
  ctx: SeoContext,
  raw: z.input<typeof referringDomainsInput>,
): Promise<PageResult<ReferringDomainRow> & { cached: boolean }> {
  const input = referringDomainsInput.parse(raw);
  const t = normalizeTarget(input.target, input.scope);
  if (t.scope === "subfolder") {
    throw new SeoError(
      "VALIDATION_ERROR",
      "Referring domains can't be broken down for a subfolder — use the Backlinks tab, or switch to Domain or Subdomains scope.",
    );
  }
  let user: unknown[];
  try {
    user = buildReferringDomainsApiFilters(input.filters);
  } catch (err) {
    throw new SeoError("VALIDATION_ERROR", (err as Error).message);
  }
  const spam = normalizeSpamOptions({ hideSpam: input.hideSpam, spamThreshold: input.spamThreshold });
  budget(countExpressionConditions(user) + (spam.hideSpam ? 1 : 0));
  const filters = combineFilters(user, spam.hideSpam ? ["backlinks_spam_score", "<=", spam.spamThreshold] : undefined);
  return pagedCall<ReferringDomainApiItem, ReferringDomainRow>(
    ctx,
    "backlinks:referring-domains-page",
    {
      ...targetCacheParams(ctx, t),
      page: input.page,
      pageSize: input.pageSize,
      sortField: input.sortField,
      sortOrder: input.sortOrder,
      filters: input.filters,
      ...spamKey(spam),
    },
    BACKLINKS_REFERRING_DOMAINS_PATH,
    {
      ...buildCommonBacklinksPayload({ target: t.apiTarget, includeSubdomains: t.includeSubdomains }),
      order_by: [`${REFERRING_DOMAINS_SORT_FIELDS[input.sortField]},${input.sortOrder}`],
      filters,
    },
    input,
    mapReferringDomainsRows,
  );
}

export const topPagesInput = backlinksLookupInput.extend({
  page: pageBase.page,
  pageSize: pageBase.pageSize,
  sortOrder: pageBase.sortOrder,
  sortField: z.enum(Object.keys(TOP_PAGES_SORT_FIELDS) as [keyof typeof TOP_PAGES_SORT_FIELDS, ...(keyof typeof TOP_PAGES_SORT_FIELDS)[]]).default("backlinks"),
  filters: z
    .object({
      include: z.string().max(500).optional(),
      exclude: z.string().max(500).optional(),
      minBacklinks: n,
      maxBacklinks: n,
      minReferringDomains: n,
      maxReferringDomains: n,
      minRank: n,
      maxRank: n,
    })
    .default({}),
});

export async function getBacklinksTopPages(ctx: SeoContext, raw: z.input<typeof topPagesInput>): Promise<PageResult<TopPageRow> & { cached: boolean }> {
  const input = topPagesInput.parse(raw);
  const t = normalizeTarget(input.target, input.scope);
  const scope = buildBacklinksScopeFilter("url", t);
  let user: unknown[];
  try {
    user = buildTopPagesApiFilters(input.filters);
  } catch (err) {
    throw new SeoError("VALIDATION_ERROR", (err as Error).message);
  }
  budget(scope.conditionCount + countExpressionConditions(user));
  const filters = prependScopeClauses(scope, user);
  return pagedCall<DomainPageSummaryApiItem, TopPageRow>(
    ctx,
    "backlinks:top-pages-page",
    { ...targetCacheParams(ctx, t), page: input.page, pageSize: input.pageSize, sortField: input.sortField, sortOrder: input.sortOrder, filters: input.filters },
    BACKLINKS_DOMAIN_PAGES_PATH,
    {
      ...buildCommonBacklinksPayload({ target: t.apiTarget, includeSubdomains: t.includeSubdomains }),
      order_by: [`${TOP_PAGES_SORT_FIELDS[input.sortField]},${input.sortOrder}`],
      filters: filters.length ? filters : undefined,
    },
    input,
    mapTopPagesRows,
  );
}

/* ───────────────────────────── Ahrefs free Domain Rating (opt-in, not billed) ───────────────────────────── */

const AHREFS_DR_URL = "https://api.ahrefs.com/v3/public/domain-rating-free";
const AHREFS_CONCURRENCY = 20;

async function fetchAhrefsDr(domain: string): Promise<number | null> {
  try {
    // Fixed public host; `domain` is validated to a bare hostname (no SSRF surface).
    const res = await fetch(`${AHREFS_DR_URL}?target=${encodeURIComponent(domain)}`, { signal: AbortSignal.timeout(5000), cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as { domain_rating?: { domain_rating?: number | null } | null };
    const dr = json.domain_rating?.domain_rating;
    return typeof dr === "number" && dr > 0 ? dr : null;
  } catch {
    return null;
  }
}

/** ≤100 domains per call; normalized (lowercase, no www); duplicates fan out; DR 0 → null; 24h cache incl. negatives. */
export async function getAhrefsDomainRatings(domains: string[]): Promise<Record<string, number | null>> {
  const list = z.array(z.string().max(253)).max(100).parse(domains);
  const byNormalized = new Map<string, string[]>();
  for (const original of list) {
    const d = normalizeDrDomain(original);
    if (!d) continue;
    byNormalized.set(d, [...(byNormalized.get(d) ?? []), original]);
  }
  const out: Record<string, number | null> = {};
  const todo: string[] = [];
  for (const d of byNormalized.keys()) {
    const cached = await cacheGet<{ dr: number | null }>(`ahrefs-dr:${d}`);
    if (cached) for (const o of byNormalized.get(d)!) out[o] = cached.value.dr;
    else todo.push(d);
  }
  for (let i = 0; i < todo.length; i += AHREFS_CONCURRENCY) {
    const batch = todo.slice(i, i + AHREFS_CONCURRENCY);
    const results = await Promise.all(batch.map(fetchAhrefsDr));
    await Promise.all(
      batch.map(async (d, j) => {
        const dr = results[j] ?? null;
        for (const o of byNormalized.get(d)!) out[o] = dr;
        await cacheSet(`ahrefs-dr:${d}`, "ahrefs-dr", null, { dr }, CACHE_TTL.ahrefsDr);
      }),
    );
  }
  return out;
}
