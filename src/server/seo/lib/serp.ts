/**
 * Google organic SERP: payload builders (analysis + rank checks, live + queued) and result mapping.
 * Port of open-seo `server/lib/dataforseo/serp.ts`. Pure.
 */

export const SERP_LIVE_PATH = "/v3/serp/google/organic/live/advanced";
export const SERP_TASK_POST_PATH = "/v3/serp/google/organic/task_post";
export const SERP_TASKS_READY_PATH = "/v3/serp/google/organic/tasks_ready";
export const serpTaskGetPath = (taskId: string) => `/v3/serp/google/organic/task_get/advanced/${encodeURIComponent(taskId)}`;

/** Default depth for the SERP analysis panel (~5 credits); "Load top 100" re-crawls at 100. */
export const SERP_ANALYSIS_DEPTH = 20;
export const MAX_TASKS_PER_POST = 100;

/** DataForSEO bills SERPs in pages of 10; depth outside 10-100 is rejected. */
export function clampSerpDepth(depth: number): number {
  return Math.min(100, Math.max(10, depth));
}

export type SerpLiveItem = {
  type?: string | null;
  rank_group?: number | null;
  rank_absolute?: number | null;
  domain?: string | null;
  title?: string | null;
  url?: string | null;
  description?: string | null;
  breadcrumb?: string | null;
  etv?: number | null;
  estimated_paid_traffic_cost?: number | null;
  backlinks_info?: { referring_domains?: number | null; backlinks?: number | null } | null;
  rank_changes?: { previous_rank_absolute?: number | null; is_new?: boolean | null } | null;
};

export type SerpResultItem = {
  rank: number;
  title: string;
  url: string;
  domain: string;
  description: string;
  etv: number | null;
  estimatedPaidTrafficCost: number | null;
  referringDomains: number | null;
  backlinks: number | null;
  isNew: boolean;
  rankChange: number | null;
};

export type SerpAnalysisResult = {
  requestedKeyword: string;
  items: SerpResultItem[];
  /** Depth this snapshot was crawled at. */
  depth: number;
  reason?: "no_organic_results";
  fetchedAt: string;
};

export function buildSerpAnalysisTask(input: { keyword: string; locationCode: number; languageCode: string; depth?: number }) {
  return {
    keyword: input.keyword,
    location_code: input.locationCode,
    language_code: input.languageCode,
    device: "desktop",
    os: "windows",
    depth: clampSerpDepth(input.depth ?? SERP_ANALYSIS_DEPTH),
  };
}

/** Only organic items; rank = rank_group ?? rank_absolute. */
export function mapOrganicSerpItems(items: (SerpLiveItem | null | undefined)[]): SerpResultItem[] {
  return items
    .filter((i): i is SerpLiveItem => i?.type === "organic")
    .map((i) => ({
      rank: i.rank_group ?? i.rank_absolute ?? 0,
      title: i.title ?? "",
      url: i.url ?? "",
      domain: i.domain ?? "",
      description: i.description ?? "",
      etv: i.etv ?? null,
      estimatedPaidTrafficCost: i.estimated_paid_traffic_cost ?? null,
      referringDomains: i.backlinks_info?.referring_domains ?? null,
      backlinks: i.backlinks_info?.backlinks ?? null,
      isNew: false,
      rankChange: null,
    }));
}

/* ───────────────────────────── Rank checks ───────────────────────────── */

export type Device = "desktop" | "mobile";

export type RankCheckResult = {
  keywordId: string;
  keyword: string;
  position: number | null;
  url: string | null;
  serpFeatures: string[];
};

type RankLocation = { locationCode: number; languageCode: string; locationName?: string | null };

/** Stop crawling once the target is found (only pages crawled are billed). */
function stopCrawlOnTarget(domain: string) {
  return {
    stop_crawl_on_match: [{ match_value: domain, match_type: "with_subdomains" }],
    find_targets_in: ["organic"],
  };
}

function locationParams(loc: RankLocation) {
  return loc.locationName ? { location_name: loc.locationName } : { location_code: loc.locationCode };
}

export function buildRankCheckTask(
  input: RankLocation & { keyword: string; device: Device; targetDomain: string; depth: number },
): Record<string, unknown> {
  return {
    keyword: input.keyword,
    ...locationParams(input),
    language_code: input.languageCode,
    device: input.device,
    os: input.device === "desktop" ? "windows" : "android",
    depth: clampSerpDepth(input.depth),
    ...stopCrawlOnTarget(input.targetDomain),
  };
}

export function rankTaskTag(keywordId: string, device: Device) {
  return `${keywordId}:${device}`;
}

/** task_post payload (≤100 tasks) — same fields + `tag` "<keywordId>:<device>" to map results back. */
export function buildRankCheckTaskPostBody(
  input: RankLocation & { tasks: { keyword: string; keywordId: string; device: Device }[]; depth: number; targetDomain: string },
): Record<string, unknown>[] {
  if (input.tasks.length === 0 || input.tasks.length > MAX_TASKS_PER_POST) {
    throw new Error(`task_post accepts 1-${MAX_TASKS_PER_POST} tasks, got ${input.tasks.length}`);
  }
  return input.tasks.map((t) => ({
    ...buildRankCheckTask({ ...input, keyword: t.keyword, device: t.device }),
    tag: rankTaskTag(t.keywordId, t.device),
  }));
}

/**
 * First organic item whose domain equals the target or is a subdomain of it.
 * position = rank_group (organic-only rank) ?? rank_absolute. serpFeatures = unique item types.
 */
export function buildRankCheckResult(
  input: { keywordId: string; keyword: string; targetDomain: string },
  items: (SerpLiveItem | null | undefined)[],
): RankCheckResult {
  const target = input.targetDomain.toLowerCase();
  const list = items.filter((i): i is SerpLiveItem => i != null);
  const match = list.find((i) => {
    if (i.type !== "organic" || i.domain == null) return false;
    const d = i.domain.toLowerCase();
    return d === target || d.endsWith(`.${target}`);
  });
  return {
    keywordId: input.keywordId,
    keyword: input.keyword,
    position: match ? (match.rank_group ?? match.rank_absolute ?? null) : null,
    url: match?.url ?? null,
    serpFeatures: [...new Set(list.map((i) => i.type).filter((t): t is string => Boolean(t)))],
  };
}

/** DataForSEO task statuses meaning "still queued / in progress" for task_get. */
export const TASK_IN_PROGRESS_STATUS_CODES = new Set([20100, 40601, 40602]);

export function isNoResultsMessage(message: string | null | undefined): boolean {
  return message?.toLowerCase().includes("no search results") ?? false;
}
