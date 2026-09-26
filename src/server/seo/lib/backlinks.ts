/**
 * Backlinks API: target normalization, payloads, filters, sorting, row mappers and overview builder.
 * Port of open-seo `features/backlinks/services/*` + `lib/dataforseo/backlinks.ts` + `dataforseoBacklinksTarget.ts`. Pure.
 */
import {
  assertFilterConditionBudget,
  buildIncludeOrGroup,
  collectNumericRange,
  escapeLikeTerm,
  joinClauses,
  parseFilterTerms,
  type FilterClause,
} from "./filters";
import { SeoValidationError } from "./locations";
import { BACKLINKS_SUBFOLDER_FILTER_CONDITIONS, MAX_DATAFORSEO_FILTER_CONDITIONS, parseResearchTarget, type ResearchScope } from "./research-scope";

export const BACKLINKS_SUMMARY_PATH = "/v3/backlinks/summary/live";
export const BACKLINKS_HISTORY_PATH = "/v3/backlinks/history/live";
export const BACKLINKS_ROWS_PATH = "/v3/backlinks/backlinks/live";
export const BACKLINKS_REFERRING_DOMAINS_PATH = "/v3/backlinks/referring_domains/live";
export const BACKLINKS_DOMAIN_PAGES_PATH = "/v3/backlinks/domain_pages_summary/live";

export const DEFAULT_BACKLINKS_SPAM_THRESHOLD = 40;
export const BACKLINKS_PAGE_SIZES = [50, 100, 200] as const;
export type BacklinksTab = "backlinks" | "domains" | "pages";
export type SortOrder = "asc" | "desc";

export type NormalizedBacklinksTarget = {
  apiTarget: string;
  displayTarget: string;
  scope: ResearchScope;
  includeSubdomains: boolean;
  /** Subfolder scope only: normalized path for url_to/url prefix filters. */
  path: string;
};

/** Legacy scope `page` → exact_url. */
export function resolveBacklinksScope(scope: string | undefined): ResearchScope | undefined {
  if (!scope) return undefined;
  if (scope === "page") return "exact_url";
  if (scope === "exact_url" || scope === "subfolder" || scope === "domain" || scope === "subdomains") return scope;
  return undefined;
}

export function normalizeBacklinksTarget(input: string, scope?: string): NormalizedBacklinksTarget {
  const trimmed = input.trim();
  const parsed = parseResearchTarget(trimmed, resolveBacklinksScope(scope));
  if (!parsed.ok) throw new SeoValidationError(parsed.message);
  const t = parsed.target;
  if (t.scope !== "exact_url") {
    return {
      apiTarget: t.hostname,
      displayTarget: t.scope === "subfolder" ? t.display : t.hostname,
      scope: t.scope,
      includeSubdomains: t.scope === "subdomains",
      path: t.scope === "subfolder" ? t.path : "",
    };
  }
  if (/[?#]/.test(trimmed)) throw new SeoValidationError("Page URLs with query strings or fragments are not supported");
  const protocol = /^http:\/\//i.test(trimmed) ? "http" : "https";
  const pageUrl = `${protocol}://${t.urlHostname}${t.path || "/"}`;
  return { apiTarget: pageUrl, displayTarget: pageUrl, scope: "exact_url", includeSubdomains: true, path: "" };
}

export function buildCommonBacklinksPayload(input: { target: string; includeSubdomains?: boolean }) {
  return {
    target: input.target,
    include_subdomains: input.includeSubdomains ?? true,
    include_indirect_links: true,
    exclude_internal_backlinks: true,
    backlinks_status_type: "live",
    rank_scale: "one_hundred",
  };
}

export type SpamOptions = { hideSpam?: boolean; spamThreshold?: number };

/** Default hideSpam = true (MCP); the web UI passes hideSpam:false unless the user enables the toggle. */
export function normalizeSpamOptions(o?: SpamOptions): { hideSpam: boolean; spamThreshold: number } {
  const hideSpam = o?.hideSpam ?? true;
  const raw = o?.spamThreshold ?? DEFAULT_BACKLINKS_SPAM_THRESHOLD;
  const threshold = Number.isFinite(raw) ? Math.min(100, Math.max(0, raw)) : DEFAULT_BACKLINKS_SPAM_THRESHOLD;
  return { hideSpam, spamThreshold: threshold };
}

/** Appends the spam condition with a single top-level "and". */
export function combineFilters(userFilters: unknown[] | undefined, spamCondition: unknown[] | undefined): unknown[] | undefined {
  const merged: unknown[] = [];
  if (userFilters && userFilters.length > 0) merged.push(...userFilters);
  if (spamCondition) {
    if (merged.length > 0) merged.push("and");
    merged.push(spamCondition);
  }
  return merged.length > 0 ? merged : undefined;
}

/* ───────────────────────────── Filters & sorting ───────────────────────────── */

export type BacklinksRowsFilters = {
  include?: string;
  exclude?: string;
  minDomainRank?: number;
  maxDomainRank?: number;
  minLinkAuthority?: number;
  maxLinkAuthority?: number;
  minSpamScore?: number;
  maxSpamScore?: number;
  linkType?: "dofollow" | "nofollow";
  hideLost?: boolean;
  hideBroken?: boolean;
  /** Row expansion (one-per-domain view). */
  domainFrom?: string;
};

export type ReferringDomainsFilters = {
  include?: string;
  exclude?: string;
  minBacklinks?: number;
  maxBacklinks?: number;
  minRank?: number;
  maxRank?: number;
  minSpamScore?: number;
  maxSpamScore?: number;
};

export type TopPagesFilters = {
  include?: string;
  exclude?: string;
  minBacklinks?: number;
  maxBacklinks?: number;
  minReferringDomains?: number;
  maxReferringDomains?: number;
  minRank?: number;
  maxRank?: number;
};

export const BACKLINKS_ROWS_SORT_FIELDS = { rank: "rank", domainRank: "domain_from_rank", spamScore: "backlink_spam_score", firstSeen: "first_seen" } as const;
export const REFERRING_DOMAINS_SORT_FIELDS = {
  domain: "domain",
  backlinks: "backlinks",
  referringPages: "referring_pages",
  rank: "rank",
  spamScore: "backlinks_spam_score",
  firstSeen: "first_seen",
  brokenBacklinks: "broken_backlinks",
} as const;
export const TOP_PAGES_SORT_FIELDS = { backlinks: "backlinks", referringDomains: "referring_domains", rank: "rank", brokenBacklinks: "broken_backlinks" } as const;

export type BacklinksRowsSortField = keyof typeof BACKLINKS_ROWS_SORT_FIELDS;
export type ReferringDomainsSortField = keyof typeof REFERRING_DOMAINS_SORT_FIELDS;
export type TopPagesSortField = keyof typeof TOP_PAGES_SORT_FIELDS;

export const DEFAULT_BACKLINKS_SORT: Record<BacklinksTab, { sort: string; order: SortOrder }> = {
  backlinks: { sort: "firstSeen", order: "desc" },
  domains: { sort: "backlinks", order: "desc" },
  pages: { sort: "backlinks", order: "desc" },
};

function excludeConditions(out: FilterClause[], field: string, exclude: string | undefined) {
  for (const t of parseFilterTerms(exclude)) out.push([field, "not_ilike", `%${escapeLikeTerm(t)}%`]);
}

function finish(includeField: string, include: string | undefined, conditions: FilterClause[]): unknown[] {
  const group = buildIncludeOrGroup(includeField, include);
  assertFilterConditionBudget(conditions.length + (group?.conditionCount ?? 0));
  return joinClauses(group ? [group.clause, ...conditions] : conditions, "and");
}

export function buildBacklinksRowsApiFilters(f: BacklinksRowsFilters): unknown[] {
  const c: FilterClause[] = [];
  excludeConditions(c, "url_from", f.exclude);
  collectNumericRange(c, "domain_from_rank", f.minDomainRank, f.maxDomainRank);
  collectNumericRange(c, "rank", f.minLinkAuthority, f.maxLinkAuthority);
  collectNumericRange(c, "backlink_spam_score", f.minSpamScore, f.maxSpamScore);
  if (f.linkType) c.push(["dofollow", "=", f.linkType === "dofollow"]);
  if (f.hideLost) c.push(["is_lost", "=", false]);
  if (f.hideBroken) c.push(["is_broken", "=", false]);
  if (f.domainFrom) c.push(["domain_from", "=", f.domainFrom]);
  return finish("url_from", f.include, c);
}

export function buildReferringDomainsApiFilters(f: ReferringDomainsFilters): unknown[] {
  const c: FilterClause[] = [];
  excludeConditions(c, "domain", f.exclude);
  collectNumericRange(c, "backlinks", f.minBacklinks, f.maxBacklinks);
  collectNumericRange(c, "rank", f.minRank, f.maxRank);
  collectNumericRange(c, "backlinks_spam_score", f.minSpamScore, f.maxSpamScore);
  return finish("domain", f.include, c);
}

export function buildTopPagesApiFilters(f: TopPagesFilters): unknown[] {
  const c: FilterClause[] = [];
  excludeConditions(c, "url", f.exclude);
  collectNumericRange(c, "backlinks", f.minBacklinks, f.maxBacklinks);
  collectNumericRange(c, "referring_domains", f.minReferringDomains, f.maxReferringDomains);
  collectNumericRange(c, "rank", f.minRank, f.maxRank);
  return finish("url", f.include, c);
}

/** Filter budget per tab: default 8; subfolder scope 8 − 4 − (pages ? 0 : 1 for the spam slot). */
export function backlinksFilterBudget(scope: ResearchScope, tab: BacklinksTab): number {
  if (scope !== "subfolder") return MAX_DATAFORSEO_FILTER_CONDITIONS;
  return MAX_DATAFORSEO_FILTER_CONDITIONS - BACKLINKS_SUBFOLDER_FILTER_CONDITIONS - (tab === "pages" ? 0 : 1);
}

/* ───────────────────────────── Raw items + mappers ───────────────────────────── */

export type BacklinksSummaryItem = {
  rank?: number | null;
  backlinks?: number | null;
  referring_pages?: number | null;
  referring_domains?: number | null;
  broken_backlinks?: number | null;
  broken_pages?: number | null;
  new_backlinks?: number | null;
  lost_backlinks?: number | null;
  new_reffering_domains?: number | null;
  lost_reffering_domains?: number | null;
  new_referring_domains?: number | null;
  lost_referring_domains?: number | null;
  backlinks_spam_score?: number | null;
  info?: { target_spam_score?: number | null } | null;
};

export type BacklinksHistoryItem = BacklinksSummaryItem & { date?: string | null };

export type BacklinkApiItem = {
  domain_from?: string | null;
  url_from?: string | null;
  url_to?: string | null;
  anchor?: string | null;
  item_type?: string | null;
  dofollow?: boolean | null;
  rank?: number | null;
  domain_from_rank?: number | null;
  page_from_rank?: number | null;
  backlinks_spam_score?: number | null;
  backlink_spam_score?: number | null;
  first_seen?: string | null;
  last_visited?: string | null;
  lost_date?: string | null;
  is_lost?: boolean | null;
  is_broken?: boolean | null;
  links_count?: number | null;
  rel_attributes?: string[] | null;
  attributes?: string[] | null;
};

export type ReferringDomainApiItem = {
  domain?: string | null;
  backlinks?: number | null;
  referring_pages?: number | null;
  rank?: number | null;
  first_seen?: string | null;
  broken_backlinks?: number | null;
  broken_pages?: number | null;
  backlinks_spam_score?: number | null;
};

export type DomainPageSummaryApiItem = {
  page?: string | null;
  url?: string | null;
  backlinks?: number | null;
  referring_domains?: number | null;
  rank?: number | null;
  broken_backlinks?: number | null;
};

export type BacklinkRow = ReturnType<typeof mapBacklinksRows>[number];
export type ReferringDomainRow = ReturnType<typeof mapReferringDomainsRows>[number];
export type TopPageRow = ReturnType<typeof mapTopPagesRows>[number];

export function mapBacklinksRows(rows: BacklinkApiItem[]) {
  return rows.map((i) => ({
    domainFrom: i.domain_from ?? null,
    urlFrom: i.url_from ?? null,
    urlTo: i.url_to ?? null,
    anchor: i.anchor ?? null,
    itemType: i.item_type ?? null,
    isDofollow: i.dofollow ?? null,
    relAttributes: i.rel_attributes ?? i.attributes ?? [],
    rank: i.rank ?? null,
    domainFromRank: i.domain_from_rank ?? null,
    pageFromRank: i.page_from_rank ?? null,
    spamScore: i.backlink_spam_score ?? i.backlinks_spam_score ?? null,
    firstSeen: i.first_seen ?? null,
    lastSeen: i.lost_date ?? i.last_visited ?? null,
    isLost: i.is_lost ?? Boolean(i.lost_date),
    isBroken: i.is_broken ?? false,
    linksCount: i.links_count ?? null,
  }));
}

export function mapReferringDomainsRows(rows: ReferringDomainApiItem[]) {
  return rows.map((i) => ({
    domain: i.domain ?? null,
    backlinks: i.backlinks ?? null,
    referringPages: i.referring_pages ?? null,
    rank: i.rank ?? null,
    spamScore: i.backlinks_spam_score ?? null,
    firstSeen: i.first_seen ?? null,
    brokenBacklinks: i.broken_backlinks ?? null,
    brokenPages: i.broken_pages ?? null,
  }));
}

export function mapTopPagesRows(rows: DomainPageSummaryApiItem[]) {
  return rows.map((i) => ({
    page: i.page ?? i.url ?? null,
    backlinks: i.backlinks ?? null,
    referringDomains: i.referring_domains ?? null,
    rank: i.rank ?? null,
    brokenBacklinks: i.broken_backlinks ?? null,
  }));
}

export type BacklinksSummary = {
  rank: number | null;
  backlinks: number | null;
  referringPages: number | null;
  referringDomains: number | null;
  brokenBacklinks: number | null;
  brokenPages: number | null;
  backlinksSpamScore: number | null;
  targetSpamScore: number | null;
  newBacklinks: number | null;
  lostBacklinks: number | null;
  newReferringDomains: number | null;
  lostReferringDomains: number | null;
};

export type BacklinksOverview = {
  target: string;
  displayTarget: string;
  scope: ResearchScope;
  summary: BacklinksSummary;
  trends: { date: string; backlinks: number | null; referringDomains: number | null; rank: number | null }[];
  newLostTrends: {
    date: string;
    newBacklinks: number | null;
    lostBacklinks: number | null;
    newReferringDomains: number | null;
    lostReferringDomains: number | null;
  }[];
  fetchedAt: string;
};

/** history/live date range: date_to = yesterday UTC, date_from = date_to − 1 year. */
export function buildBacklinksDateRange(now: Date): { dateFrom: string; dateTo: string } {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const from = new Date(Date.UTC(to.getUTCFullYear() - 1, to.getUTCMonth(), to.getUTCDate()));
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { dateFrom: fmt(from), dateTo: fmt(to) };
}

export function buildOverviewResult(args: {
  target: NormalizedBacklinksTarget;
  now: Date;
  summary: BacklinksSummaryItem;
  history: BacklinksHistoryItem[];
}): BacklinksOverview {
  const s = args.summary;
  const history = args.history
    .map((i) => ({
      date: i.date ? i.date.slice(0, 10) : null,
      backlinks: i.backlinks ?? null,
      referringDomains: i.referring_domains ?? null,
      rank: i.rank ?? null,
      newBacklinks: i.new_backlinks ?? null,
      lostBacklinks: i.lost_backlinks ?? null,
      newReferringDomains: i.new_referring_domains ?? i.new_reffering_domains ?? null,
      lostReferringDomains: i.lost_referring_domains ?? i.lost_reffering_domains ?? null,
    }))
    .filter((i): i is typeof i & { date: string } => i.date !== null);
  return {
    target: args.target.apiTarget,
    displayTarget: args.target.displayTarget,
    scope: args.target.scope,
    summary: {
      rank: s.rank ?? null,
      backlinks: s.backlinks ?? null,
      referringPages: s.referring_pages ?? null,
      referringDomains: s.referring_domains ?? null,
      brokenBacklinks: s.broken_backlinks ?? null,
      brokenPages: s.broken_pages ?? null,
      backlinksSpamScore: s.backlinks_spam_score ?? null,
      targetSpamScore: s.info?.target_spam_score ?? null,
      newBacklinks: s.new_backlinks ?? null,
      lostBacklinks: s.lost_backlinks ?? null,
      newReferringDomains: s.new_referring_domains ?? s.new_reffering_domains ?? null,
      lostReferringDomains: s.lost_referring_domains ?? s.lost_reffering_domains ?? null,
    },
    trends: history.map((h) => ({ date: h.date, backlinks: h.backlinks, referringDomains: h.referringDomains, rank: h.rank })),
    newLostTrends: history.map((h) => ({
      date: h.date,
      newBacklinks: h.newBacklinks,
      lostBacklinks: h.lostBacklinks,
      newReferringDomains: h.newReferringDomains,
      lostReferringDomains: h.lostReferringDomains,
    })),
    fetchedAt: args.now.toISOString(),
  };
}

export type PageResult<T> = { rows: T[]; totalCount: number | null; hasMore: boolean; page: number; pageSize: number; fetchedAt: string };

export function buildPageResult<T>(input: { page: number; pageSize: number }, offset: number, rows: T[], totalCount: number | null): PageResult<T> {
  const hasMore = totalCount != null ? offset + rows.length < totalCount : rows.length === input.pageSize;
  return { rows, totalCount, hasMore, page: input.page, pageSize: input.pageSize, fetchedAt: new Date().toISOString() };
}

/** Ahrefs free DR: lowercase, strip scheme/www/path; null for invalid input. */
export function normalizeDrDomain(value: string): string | null {
  const d = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0] ?? "";
  if (!d || !d.includes(".") || !/^[a-z\d.-]+$/.test(d)) return null;
  return d;
}
