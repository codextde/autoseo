/**
 * Rank tracking constants, cost estimation, scheduling and scorecards.
 * Port of open-seo `shared/rank-tracking.ts` + client `rankTrackingScorecards.ts`. Pure + isomorphic.
 *
 * AutoSEO is self-hosted: estimates show the raw DataForSEO USD (open-seo's hosted 1.28 markup does not apply).
 */
import { MAX_TASKS_PER_POST } from "./serp";

export type RankDevices = "both" | "desktop" | "mobile";
export type ScheduleInterval = "daily" | "weekly" | "monthly" | "manual";
export type ScheduledInterval = Exclude<ScheduleInterval, "manual">;
export type RankCheckMethod = "live" | "queued";
export type ComparePeriod = "1d" | "7d" | "30d" | "90d";

/** Live API: first page (10 results) + each extra page. */
const LIVE_BASE_PAGE_COST_USD = 0.002;
const LIVE_EXTRA_PAGE_COST_USD = 0.0015;
/** Standard task queue (~30% of live). */
const QUEUED_BASE_PAGE_COST_USD = 0.0006;
const QUEUED_EXTRA_PAGE_COST_USD = 0.00045;

export const KEYWORDS_PER_BATCH = 10;
export const SECONDS_PER_BATCH = 6;
export const MAX_KEYWORDS_PER_CONFIG = 1000;
export const MAX_TRACKED_KEYWORD_LENGTH = 200;
export const MAX_CONFIGS_PER_PROJECT = 500;
export const CHECK_CONFIRM_THRESHOLD = 50;
export const DEFAULT_SERP_DEPTH = 40;
export const FILTER_BAR_MIN_DOMAINS = 6;
/** Poll cadence for queued tasks (minutes): cumulative 4/6/8/10/12/15, then live fallback. */
export const QUEUED_POLL_INTERVALS_MIN = [4, 2, 2, 2, 2, 3] as const;
export const TASK_GET_CONCURRENCY = 25;
export const TASK_GETS_PER_COLLECT = 500;
/** Scheduler budget: task units (keywords × devices) per tick. */
export const SCHEDULED_TASK_UNIT_BUDGET = 1000;
export const TICK_DEADLINE_MS = 3 * 60_000;
export const RANK_CHECK_STARTUP_GRACE_MS = 60_000;

export { MAX_TASKS_PER_POST };

export const roundUsd = (v: number) => Math.round(v * 1e5) / 1e5;

export function devicesCount(devices: RankDevices): number {
  return devices === "both" ? 2 : 1;
}

export function devicesList(devices: RankDevices): ("desktop" | "mobile")[] {
  return devices === "both" ? ["desktop", "mobile"] : [devices];
}

export function costPerSerpAtDepth(depth: number, method: RankCheckMethod): number {
  const pages = depth / 10;
  return method === "queued"
    ? QUEUED_BASE_PAGE_COST_USD + (pages - 1) * QUEUED_EXTRA_PAGE_COST_USD
    : LIVE_BASE_PAGE_COST_USD + (pages - 1) * LIVE_EXTRA_PAGE_COST_USD;
}

/** Per metered call rounding (live: 1 check per call; queued: ≤100 checks per task_post). */
export function estimateRankCheckCost(keywordCount: number, devices: RankDevices, depth: number, method: RankCheckMethod) {
  const totalChecks = keywordCount * devicesCount(devices);
  const perCall = method === "queued" ? MAX_TASKS_PER_POST : 1;
  let costUsd = 0;
  for (let offset = 0; offset < totalChecks; offset += perCall) {
    const checks = Math.min(perCall, totalChecks - offset);
    costUsd += roundUsd(checks * costPerSerpAtDepth(depth, method));
  }
  return { costUsd: roundUsd(costUsd), totalChecks };
}

export function checksPerMonth(interval: ScheduledInterval): number {
  return interval === "daily" ? 30 : interval === "weekly" ? 4 : 1;
}

export function estimateScheduledRankCheckCost(keywordCount: number, devices: RankDevices, depth: number, interval: ScheduledInterval) {
  const { costUsd } = estimateRankCheckCost(keywordCount, devices, depth, "queued");
  const perMonth = checksPerMonth(interval);
  return { scheduleInterval: interval, costUsd, checksPerMonth: perMonth, monthlyCostUsd: roundUsd(costUsd * perMonth) };
}

export function isScheduledInterval(i: ScheduleInterval): i is ScheduledInterval {
  return i !== "manual";
}

/** Manual-check confirmation: ~seconds = ceil(T / 10) * 6 */
export function estimateLiveCheckSeconds(totalChecks: number): number {
  return Math.ceil(totalChecks / KEYWORDS_PER_BATCH) * SECONDS_PER_BATCH;
}

function endOfMonthWithTime(source: Date, monthOffset = 0): Date {
  const d = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + monthOffset + 1, 0));
  d.setUTCHours(source.getUTCHours(), source.getUTCMinutes(), source.getUTCSeconds(), source.getUTCMilliseconds());
  return d;
}

/**
 * Next check time. With an anchor (previous nextCheckAt) advances by whole intervals (no drift);
 * otherwise picks a random 04–09 UTC hour/minute. Monthly = end of month.
 */
export function computeNextCheckAt(
  interval: ScheduledInterval,
  previousNextCheckAt?: Date | string | null,
  now: number = Date.now(),
  random: () => number = Math.random,
): Date {
  if (interval === "monthly") {
    if (previousNextCheckAt) {
      const anchor = new Date(previousNextCheckAt);
      let offset = 1;
      let next = endOfMonthWithTime(anchor, offset);
      while (next.getTime() <= now) {
        offset += 1;
        next = endOfMonthWithTime(anchor, offset);
      }
      return next;
    }
    const hour = 4 + Math.floor(random() * 6);
    const minute = Math.floor(random() * 60);
    const next = endOfMonthWithTime(new Date(now));
    next.setUTCHours(hour, minute, 0, 0);
    if (next.getTime() <= now) {
      const following = endOfMonthWithTime(next, 1);
      following.setUTCHours(hour, minute, 0, 0);
      return following;
    }
    return next;
  }
  const days = interval === "daily" ? 1 : 7;
  if (previousNextCheckAt) {
    const anchor = new Date(previousNextCheckAt).getTime();
    const ms = days * 86_400_000;
    const steps = Math.floor(Math.max(0, now - anchor) / ms) + 1;
    return new Date(anchor + steps * ms);
  }
  const next = new Date(now);
  next.setUTCDate(next.getUTCDate() + days);
  next.setUTCHours(4 + Math.floor(random() * 6), Math.floor(random() * 60), 0, 0);
  return next;
}

export function devicesLabel(devices: RankDevices): string {
  if (devices === "both") return "Desktop + Mobile";
  return devices === "desktop" ? "Desktop" : "Mobile";
}

export function scheduleLabel(interval: ScheduleInterval): string {
  return { daily: "Daily", weekly: "Weekly", monthly: "Monthly", manual: "Manual" }[interval];
}

export function defaultComparePeriod(interval: ScheduleInterval): ComparePeriod {
  return interval === "daily" ? "1d" : interval === "monthly" ? "30d" : "7d";
}

export const COMPARE_PERIOD_LABELS: Record<ComparePeriod, string> = {
  "1d": "vs yesterday",
  "7d": "vs last week",
  "30d": "vs last month",
  "90d": "vs 90 days ago",
};

export const COMPARE_PERIOD_DAYS: Record<ComparePeriod, number> = { "1d": 1, "7d": 7, "30d": 30, "90d": 90 };

/** Trim, lowercase unless matchCase, dedupe (request + existing), cap at remaining capacity. */
export function normalizeTrackedKeywords(raw: string[], existing: Iterable<string>, matchCase: boolean, available: number): string[] {
  const existingSet = new Set(existing);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    if (out.length >= available) break;
    const t = r.trim();
    const n = matchCase ? t : t.toLowerCase();
    if (!n || seen.has(n) || existingSet.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/** Normalize a tracker domain: lowercase, strip protocol/path/query/fragment/trailing slash/www. */
export function normalizeTrackerDomain(domain: string): string {
  let d = domain.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "");
  d = d.replace(/[/?#].*$/, "");
  d = d.replace(/\/+$/, "");
  d = d.replace(/^www\./, "");
  return d;
}

/* ───────────────────────────── Scorecards ───────────────────────────── */

export const CTR_BY_POSITION = [
  0, 0.28, 0.15, 0.1, 0.07, 0.05, 0.04, 0.033, 0.028, 0.024, 0.021, 0.018, 0.016, 0.014, 0.012, 0.011, 0.01, 0.009, 0.008, 0.007,
  0.006,
];

export function ctrForPosition(pos: number | null | undefined): number {
  if (pos == null || pos < 1) return 0;
  return CTR_BY_POSITION[pos] ?? 0.005;
}

export type ScorecardRow = { searchVolume: number | null; position: number | null; previousPosition: number | null };

function visibilityOf(rows: ScorecardRow[], key: "position" | "previousPosition"): number | null {
  const withVolume = rows.filter((r) => (r.searchVolume ?? 0) > 0);
  const totalVolume = withVolume.reduce((s, r) => s + (r.searchVolume ?? 0), 0);
  if (totalVolume === 0) return null;
  const weighted = withVolume.reduce((s, r) => s + (r.searchVolume ?? 0) * ctrForPosition(r[key]), 0);
  return (weighted / (totalVolume * 0.28)) * 100;
}

export type Scorecards = {
  visibility: number | null;
  visibilityDelta: number | null;
  ranking: number;
  rankingDelta: number;
  top3: number;
  top10: number;
  improved: number;
  declined: number;
};

export function computeScorecards(rows: ScorecardRow[]): Scorecards {
  const visibility = visibilityOf(rows, "position");
  const previousVisibility = visibilityOf(rows, "previousPosition");
  const ranking = rows.filter((r) => r.position != null).length;
  const previousRanking = rows.filter((r) => r.previousPosition != null).length;
  let improved = 0;
  let declined = 0;
  for (const r of rows) {
    const c = classifyMovement(r.position, r.previousPosition);
    if (c === "improved" || c === "new") improved++;
    else if (c === "declined" || c === "lost") declined++;
  }
  return {
    visibility,
    visibilityDelta: visibility != null && previousVisibility != null ? visibility - previousVisibility : null,
    ranking,
    rankingDelta: ranking - previousRanking,
    top3: rows.filter((r) => r.position != null && r.position <= 3).length,
    top10: rows.filter((r) => r.position != null && r.position <= 10).length,
    improved,
    declined,
  };
}

export type Movement = "none" | "new" | "lost" | "improved" | "declined" | "same";

export function classifyMovement(position: number | null, previous: number | null): Movement {
  if (position == null && previous == null) return "none";
  if (position == null) return "lost";
  if (previous == null) return "new";
  const diff = previous - position;
  if (diff > 0) return "improved";
  if (diff < 0) return "declined";
  return "same";
}

/** CSV "Change" cell: prev − current, or "new"/"lost"; empty when unranked both times. */
export function changeCell(position: number | null, previous: number | null): string | number {
  const m = classifyMovement(position, previous);
  if (m === "none") return "";
  if (m === "new") return "new";
  if (m === "lost") return "lost";
  return (previous ?? 0) - (position ?? 0);
}

/** SERP feature short labels (others hidden). */
export const SERP_FEATURE_LABELS: Record<string, string> = {
  featured_snippet: "FS",
  people_also_ask: "PAA",
  ai_overview: "AI",
  local_pack: "Local",
  knowledge_panel: "KP",
  video: "Video",
  images: "Img",
  shopping: "Shop",
  top_stories: "News",
};

/** Position distribution buckets for the overview chart. */
export const POSITION_BUCKETS = [
  { key: "top3", label: "Top 3", color: "#16a34a" },
  { key: "top4to10", label: "4–10", color: "#2563eb" },
  { key: "top11to20", label: "11–20", color: "#f59e0b" },
  { key: "notRanking", label: "Not in top 20", color: "#6b7280" },
] as const;
