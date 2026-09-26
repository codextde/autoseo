import "server-only";
import { eq } from "drizzle-orm";
import {
  seoKeywordMetrics,
  seoRankConfigs,
  seoRankKeywords,
  seoRankRuns,
  seoRankSnapshots,
  seoSavedKeywords,
  seoSavedKeywordTagAssignments,
  seoSavedKeywordTags,
  type SeoMonthlySearch,
} from "@/server/db/schema";
import { newId } from "@/server/db/schema/_helpers";
import { projectMarket } from "@/server/seo/lib/locations";
import type { TagColorKey } from "@/server/seo/lib/tags";
import { chunks, type DemoModule, type DemoModuleCtx } from "./context";

/**
 * Demo data for the SEO module: saved keywords (+ tags, per-project metrics) and one manual rank
 * tracker with ~60 days of desktop/mobile position snapshots. Insert-only — no DataForSEO calls.
 *
 * Not generated: domain overview / backlinks cache rows. The SEO module validates research targets
 * and rejects the reserved `.example` TLD of the fictional demo brands, so those pages could never
 * request (or read the cache for) stridewell.example; caching keyword research would be keyed
 * instance-wide and leak invented metrics into real projects.
 */

type Intent = "informational" | "commercial" | "transactional" | "navigational";
type KwDef = { kw: string; vol: number; kd: number; cpc: number; intent: Intent; tags: string[]; path: string };

const TAGS: { name: string; color: TagColorKey }[] = [
  { name: "Running shoes", color: "emerald" },
  { name: "Trail", color: "lime" },
  { name: "Sustainability", color: "sky" },
  { name: "Deals", color: "amber" },
  { name: "Brand", color: "violet" },
  { name: "Guides", color: "slate" },
  { name: "Apparel", color: "rose" },
  { name: "Comparisons", color: "fuchsia" },
];

/** {brand} is replaced by the (lower-case) demo brand name. */
const KEYWORDS: KwDef[] = [
  { kw: "running shoes", vol: 246000, kd: 84, cpc: 1.45, intent: "commercial", tags: ["Running shoes"], path: "/collections/running-shoes" },
  { kw: "best running shoes", vol: 165000, kd: 78, cpc: 2.1, intent: "commercial", tags: ["Running shoes"], path: "/blog/best-running-shoes" },
  { kw: "running shoes for women", vol: 90500, kd: 71, cpc: 1.62, intent: "commercial", tags: ["Running shoes"], path: "/collections/womens-running-shoes" },
  { kw: "running shoes for men", vol: 74000, kd: 70, cpc: 1.58, intent: "commercial", tags: ["Running shoes"], path: "/collections/mens-running-shoes" },
  { kw: "best running shoes for beginners", vol: 22200, kd: 52, cpc: 1.95, intent: "commercial", tags: ["Running shoes", "Guides"], path: "/blog/best-running-shoes-for-beginners" },
  { kw: "cushioned running shoes", vol: 14800, kd: 47, cpc: 1.72, intent: "commercial", tags: ["Running shoes"], path: "/collections/max-cushion" },
  { kw: "running shoes for flat feet", vol: 27100, kd: 49, cpc: 1.35, intent: "commercial", tags: ["Running shoes"], path: "/blog/running-shoes-for-flat-feet" },
  { kw: "wide running shoes", vol: 12100, kd: 38, cpc: 1.41, intent: "commercial", tags: ["Running shoes"], path: "/collections/wide-fit" },
  { kw: "marathon running shoes", vol: 9900, kd: 44, cpc: 1.88, intent: "commercial", tags: ["Running shoes"], path: "/collections/race-day" },
  { kw: "carbon plate running shoes", vol: 6600, kd: 41, cpc: 2.3, intent: "commercial", tags: ["Running shoes"], path: "/products/stridewell-pacejet-carbon" },
  { kw: "lightweight running shoes", vol: 8100, kd: 39, cpc: 1.5, intent: "commercial", tags: ["Running shoes"], path: "/collections/lightweight" },
  { kw: "running shoes for plantar fasciitis", vol: 18100, kd: 45, cpc: 1.6, intent: "commercial", tags: ["Running shoes"], path: "/blog/running-shoes-for-plantar-fasciitis" },
  { kw: "stability running shoes", vol: 12100, kd: 43, cpc: 1.55, intent: "commercial", tags: ["Running shoes"], path: "/collections/stability" },
  { kw: "zero drop running shoes", vol: 4400, kd: 27, cpc: 1.15, intent: "commercial", tags: ["Running shoes"], path: "/blog/zero-drop-running-shoes" },
  { kw: "trail running shoes", vol: 60500, kd: 66, cpc: 1.4, intent: "commercial", tags: ["Trail"], path: "/collections/trail" },
  { kw: "best trail running shoes", vol: 33100, kd: 61, cpc: 1.85, intent: "commercial", tags: ["Trail"], path: "/blog/best-trail-running-shoes" },
  { kw: "waterproof trail running shoes", vol: 8100, kd: 36, cpc: 1.62, intent: "commercial", tags: ["Trail"], path: "/collections/trail-gtx" },
  { kw: "trail running shoes women", vol: 14800, kd: 42, cpc: 1.44, intent: "commercial", tags: ["Trail"], path: "/collections/womens-trail" },
  { kw: "hydration vest running", vol: 5400, kd: 28, cpc: 1.1, intent: "commercial", tags: ["Trail", "Apparel"], path: "/products/stridewell-flowvest-8l" },
  { kw: "sustainable running shoes", vol: 3600, kd: 24, cpc: 1.25, intent: "commercial", tags: ["Sustainability"], path: "/sustainability" },
  { kw: "recycled running shoes", vol: 1300, kd: 18, cpc: 1.05, intent: "commercial", tags: ["Sustainability"], path: "/collections/recycled" },
  { kw: "eco friendly sneakers", vol: 9900, kd: 33, cpc: 1.12, intent: "commercial", tags: ["Sustainability"], path: "/blog/eco-friendly-sneakers" },
  { kw: "vegan running shoes", vol: 4400, kd: 22, cpc: 0.98, intent: "commercial", tags: ["Sustainability"], path: "/collections/vegan" },
  { kw: "running shoes sale", vol: 27100, kd: 58, cpc: 0.85, intent: "transactional", tags: ["Deals"], path: "/collections/sale" },
  { kw: "cheap running shoes", vol: 18100, kd: 46, cpc: 0.72, intent: "transactional", tags: ["Deals"], path: "/collections/sale" },
  { kw: "running shoes under 100", vol: 6600, kd: 35, cpc: 0.95, intent: "transactional", tags: ["Deals"], path: "/collections/under-100" },
  { kw: "running shoes black friday", vol: 12100, kd: 40, cpc: 0.88, intent: "transactional", tags: ["Deals"], path: "/pages/black-friday" },
  { kw: "{brand}", vol: 8100, kd: 12, cpc: 0.45, intent: "navigational", tags: ["Brand"], path: "/" },
  { kw: "{brand} running shoes", vol: 2900, kd: 9, cpc: 0.62, intent: "navigational", tags: ["Brand"], path: "/collections/running-shoes" },
  { kw: "{brand} cloudrun review", vol: 880, kd: 8, cpc: 0.4, intent: "informational", tags: ["Brand"], path: "/products/stridewell-cloudrun-4" },
  { kw: "{brand} vs velocita", vol: 590, kd: 11, cpc: 0.55, intent: "commercial", tags: ["Brand", "Comparisons"], path: "/blog/stridewell-vs-velocita" },
  { kw: "{brand} return policy", vol: 320, kd: 3, cpc: 0, intent: "navigational", tags: ["Brand"], path: "/returns" },
  { kw: "how to choose running shoes", vol: 12100, kd: 35, cpc: 0.8, intent: "informational", tags: ["Guides"], path: "/guides/how-to-choose-running-shoes" },
  { kw: "how often to replace running shoes", vol: 8100, kd: 22, cpc: 0.35, intent: "informational", tags: ["Guides"], path: "/blog/when-to-replace-running-shoes" },
  { kw: "running shoe size guide", vol: 5400, kd: 19, cpc: 0.42, intent: "informational", tags: ["Guides"], path: "/size-guide" },
  { kw: "heel to toe drop explained", vol: 1900, kd: 16, cpc: 0.2, intent: "informational", tags: ["Guides"], path: "/guides/heel-to-toe-drop" },
  { kw: "half marathon training plan", vol: 40500, kd: 48, cpc: 0.6, intent: "informational", tags: ["Guides"], path: "/guides/half-marathon-training-plan" },
  { kw: "running socks", vol: 22200, kd: 41, cpc: 0.95, intent: "commercial", tags: ["Apparel"], path: "/collections/socks" },
  { kw: "running shorts with pockets", vol: 6600, kd: 29, cpc: 0.9, intent: "commercial", tags: ["Apparel"], path: "/collections/shorts" },
  { kw: "running jacket waterproof", vol: 9900, kd: 38, cpc: 1.2, intent: "commercial", tags: ["Apparel"], path: "/collections/jackets" },
];

/** Monthly seasonality of running searches (Jan resolutions, spring races, Black Friday). */
const SEASON = [1.28, 1.12, 1.08, 1.1, 1.05, 0.96, 0.9, 0.88, 0.94, 0.92, 1.04, 0.86];

/** Keywords in the rank tracker + position profile (start → end over the window; null = not in top depth). */
const RANK_PROFILE: { kw: string; from: number | null; to: number | null }[] = [
  { kw: "{brand}", from: 1, to: 1 },
  { kw: "{brand} running shoes", from: 1, to: 1 },
  { kw: "{brand} cloudrun review", from: 3, to: 2 },
  { kw: "{brand} vs velocita", from: 6, to: 2 },
  { kw: "{brand} return policy", from: 1, to: 1 },
  { kw: "running shoes", from: 34, to: 24 },
  { kw: "best running shoes", from: 27, to: 17 },
  { kw: "running shoes for women", from: 22, to: 15 },
  { kw: "running shoes for men", from: 25, to: 19 },
  { kw: "best running shoes for beginners", from: 14, to: 6 },
  { kw: "cushioned running shoes", from: 9, to: 4 },
  { kw: "running shoes for flat feet", from: 18, to: 11 },
  { kw: "wide running shoes", from: 7, to: 3 },
  { kw: "marathon running shoes", from: 16, to: 12 },
  { kw: "carbon plate running shoes", from: null, to: 28 },
  { kw: "lightweight running shoes", from: 12, to: 9 },
  { kw: "stability running shoes", from: 11, to: 13 },
  { kw: "trail running shoes", from: 38, to: 31 },
  { kw: "best trail running shoes", from: null, to: 36 },
  { kw: "waterproof trail running shoes", from: 21, to: 14 },
  { kw: "sustainable running shoes", from: 4, to: 2 },
  { kw: "recycled running shoes", from: 2, to: 1 },
  { kw: "eco friendly sneakers", from: 13, to: 8 },
  { kw: "vegan running shoes", from: 8, to: 5 },
  { kw: "running shoes sale", from: 31, to: 26 },
  { kw: "running shoes under 100", from: 19, to: 23 },
  { kw: "how to choose running shoes", from: 10, to: 5 },
  { kw: "how often to replace running shoes", from: 6, to: 4 },
  { kw: "running shoe size guide", from: 5, to: 3 },
  { kw: "half marathon training plan", from: null, to: 38 },
];

const SERP_FEATURE_POOL = ["people_also_ask", "ai_overview", "images", "video", "shopping", "featured_snippet", "top_stories", "related_searches"] as const;

function brandify(kw: string, brand: string) {
  return kw.replace("{brand}", brand.toLowerCase());
}

async function clear(ctx: DemoModuleCtx) {
  const { tx, projectId } = ctx;
  await tx.delete(seoRankConfigs).where(eq(seoRankConfigs.projectId, projectId));
  await tx.delete(seoSavedKeywords).where(eq(seoSavedKeywords.projectId, projectId));
  await tx.delete(seoSavedKeywordTags).where(eq(seoSavedKeywordTags.projectId, projectId));
  await tx.delete(seoKeywordMetrics).where(eq(seoKeywordMetrics.projectId, projectId));
}

async function insert(ctx: DemoModuleCtx): Promise<Record<string, number>> {
  const { tx, projectId, now } = ctx;
  const market = projectMarket({ country: ctx.country, language: ctx.language });
  const origin = `https://${ctx.domain}`;
  const nowMs = now.getTime();
  const DAY = 86_400_000;
  const rng = ctx.rng("seo.keywords");

  /* ── tags ── */
  const tagRows = TAGS.map((t, i) => ({
    id: newId("skt"),
    projectId,
    name: t.name,
    normalizedName: t.name.toLocaleLowerCase(),
    color: t.color,
    createdAt: new Date(nowMs - (80 - i) * DAY),
  }));
  const tagId = new Map(tagRows.map((t) => [t.name, t.id]));

  /* ── saved keywords + metrics ── */
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const savedRows: (typeof seoSavedKeywords.$inferInsert)[] = [];
  const linkRows: (typeof seoSavedKeywordTagAssignments.$inferInsert)[] = [];
  const metricRows: (typeof seoKeywordMetrics.$inferInsert)[] = [];
  KEYWORDS.forEach((k, i) => {
    const keyword = brandify(k.kw, ctx.brandName);
    const id = newId("skw");
    const createdAt = new Date(nowMs - (75 - Math.floor(i * 1.6)) * DAY - rng.int(0, 20) * 3_600_000);
    savedRows.push({ id, projectId, keyword, locationCode: market.locationCode, languageCode: market.languageCode, createdAt });
    for (const t of k.tags) linkRows.push({ savedKeywordId: id, tagId: tagId.get(t)!, createdAt });
    // Last 12 complete months, newest first (DataForSEO order).
    const monthly: SeoMonthlySearch[] = [];
    for (let m = 1; m <= 12; m++) {
      const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - m, 1));
      const season = SEASON[d.getUTCMonth()]!;
      const deals = k.tags.includes("Deals") && d.getUTCMonth() === 10 ? 1.9 : 1;
      const v = k.vol * season * deals * (1 + rng.gaussian(0, 0.06));
      monthly.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, searchVolume: Math.max(10, Math.round(v / 10) * 10) });
    }
    metricRows.push({
      projectId,
      keyword,
      locationCode: market.locationCode,
      languageCode: market.languageCode,
      searchVolume: k.vol,
      cpc: k.cpc || null,
      competition: Math.round(Math.min(1, Math.max(0.02, k.kd / 100 + rng.gaussian(0, 0.12))) * 100) / 100,
      keywordDifficulty: k.kd,
      intent: k.intent,
      monthlySearches: monthly,
      fetchedAt: new Date(nowMs - rng.int(1, 6) * DAY),
    });
  });

  /* ── rank tracker ── */
  const configId = newId("rkc");
  const byKw = new Map(KEYWORDS.map((k) => [k.kw, k]));
  const rankKeywords = RANK_PROFILE.map((r, i) => {
    const def = byKw.get(r.kw)!;
    const fr = ctx.rng(`seo.rank.features.${r.kw}`);
    const featureProb = (f: (typeof SERP_FEATURE_POOL)[number]) =>
      f === "people_also_ask" ? 0.85 : f === "ai_overview" ? (def.intent === "informational" ? 0.8 : 0.55) : f === "shopping" ? (def.intent === "informational" ? 0.1 : 0.7) : 0.3;
    const features = ["organic", ...SERP_FEATURE_POOL.filter((f) => fr.bool(featureProb(f)))];
    return {
      row: {
        id: newId("rkk"),
        configId,
        keyword: brandify(r.kw, ctx.brandName),
        matchCase: false,
        searchVolume: def.vol,
        keywordDifficulty: def.kd,
        cpc: def.cpc || null,
        metricsFetchedAt: new Date(nowMs - 62 * DAY + i * 60_000),
        createdAt: new Date(nowMs - 62 * DAY + i * 60_000),
      },
      profile: r,
      def,
      features,
    };
  });

  const runRng = ctx.rng("seo.rank.runs");
  const runs: (typeof seoRankRuns.$inferInsert)[] = [];
  const snapshots: (typeof seoRankSnapshots.$inferInsert)[] = [];
  const posRng = ctx.rng("seo.rank.positions");
  const DEPTH = 40;
  const startOffset = 60;
  let dayOff = startOffset;
  let lastCompleted: Date | null = null;
  while (dayOff >= 0) {
    const startedAt = new Date(nowMs - dayOff * DAY - runRng.int(1, 5) * 3_600_000);
    if (startedAt.getTime() > nowMs) break;
    const completedAt = new Date(startedAt.getTime() + runRng.int(90, 260) * 1000);
    const runId = newId("rkr");
    const t = 1 - dayOff / startOffset;
    runs.push({
      id: runId,
      configId,
      projectId,
      status: "completed",
      trigger: "manual",
      method: "live",
      phase: "done",
      collectRound: 0,
      keywordsTotal: rankKeywords.length,
      keywordsChecked: rankKeywords.length,
      isSubsetRun: false,
      keywordIds: null,
      errorMessage: null,
      costUsd: Math.round(rankKeywords.length * 2 * 0.002 * 10000) / 10000,
      stats: {},
      startedAt,
      completedAt,
    });
    lastCompleted = completedAt;
    for (const k of rankKeywords) {
      const { from, to } = k.profile;
      let desktop: number | null;
      if (from == null && to == null) desktop = null;
      else {
        const a = from ?? DEPTH + 8;
        const b = to ?? DEPTH + 8;
        const expected = a + (b - a) * t;
        const noise = posRng.gaussian(0, Math.max(0.4, expected * 0.08));
        desktop = Math.max(1, Math.round(expected + noise));
        if (desktop > DEPTH) desktop = null;
      }
      let mobile: number | null = desktop == null ? null : Math.max(1, desktop + Math.round(posRng.gaussian(0.6, 1.1)));
      if (mobile != null && mobile > DEPTH) mobile = null;
      if (desktop == null && k.profile.to != null && t > 0.8 && posRng.bool(0.3)) mobile = DEPTH - posRng.int(0, 3);
      for (const [device, position] of [
        ["desktop", desktop],
        ["mobile", mobile],
      ] as const) {
        snapshots.push({
          runId,
          trackingKeywordId: k.row.id,
          keyword: k.row.keyword,
          device,
          position,
          url: position == null ? null : `${origin}${k.def.path}`,
          serpFeatures: k.features.filter((f) => f === "organic" || posRng.bool(0.93)),
          checkedAt: new Date(startedAt.getTime() + posRng.int(5, 200) * 1000),
        });
      }
    }
    dayOff -= runRng.int(2, 3);
  }

  const config: typeof seoRankConfigs.$inferInsert = {
    id: configId,
    projectId,
    domain: ctx.domain,
    locationCode: market.locationCode,
    languageCode: market.languageCode,
    locationName: null,
    devices: "both",
    serpDepth: DEPTH,
    scheduleInterval: "manual",
    isActive: true,
    lastCheckedAt: lastCompleted,
    nextCheckAt: null,
    lastSkipReason: null,
    createdBy: ctx.userId,
    createdAt: new Date(nowMs - 62 * DAY),
    updatedAt: lastCompleted ?? new Date(nowMs - 62 * DAY),
  };

  await tx.insert(seoSavedKeywordTags).values(tagRows);
  for (const part of chunks(savedRows)) await tx.insert(seoSavedKeywords).values(part);
  for (const part of chunks(linkRows)) await tx.insert(seoSavedKeywordTagAssignments).values(part);
  for (const part of chunks(metricRows, 500)) await tx.insert(seoKeywordMetrics).values(part);
  await tx.insert(seoRankConfigs).values(config);
  await tx.insert(seoRankKeywords).values(rankKeywords.map((k) => k.row));
  for (const part of chunks(runs)) await tx.insert(seoRankRuns).values(part);
  for (const part of chunks(snapshots)) await tx.insert(seoRankSnapshots).values(part);

  return {
    savedKeywords: savedRows.length,
    keywordTags: tagRows.length,
    keywordMetrics: metricRows.length,
    rankConfigs: 1,
    rankKeywords: rankKeywords.length,
    rankRuns: runs.length,
    rankSnapshots: snapshots.length,
  };
}

export default { name: "seo", clear, insert } satisfies DemoModule;
