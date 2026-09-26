import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { projects, seoLocalRuns, type SeoLocalTool } from "@/server/db/schema";
import { enqueueJob } from "@/server/jobs/queue";
import { rateLimit } from "@/server/rate-limit";
import { assertCanRun, SeoError, systemSeoContext, type SeoContext } from "./context";
import { dfsGetTask, dfsLive, dfsTaskPost, toSeoError } from "./dfs";
import { buildCacheKey, cacheGet, cacheSet, CACHE_TTL } from "./cache";
import {
  BUSINESS_LISTING_FIELDS,
  BUSINESS_LISTINGS_CATEGORIES_PATH,
  BUSINESS_LISTINGS_SEARCH_PATH,
  BUSINESS_UPDATE_ROW_FIELDS,
  buildBusinessSearchTask,
  buildLocalSerpRequest,
  buildRankGridPoints,
  buildReviewsTaskPost,
  buildUpdatesTaskPost,
  businessIdentifierKeyword,
  businessLocationParams,
  businessTaskGetPath,
  businessTaskPostPath,
  combinedQuestionItems,
  estimateLocalRunCost,
  formatBusinessDataCoordinate,
  formatLocalSerpCoordinate,
  LOCAL_COST_HINTS,
  LOCAL_SERP_FIELDS,
  MAPS_SERP_PATH,
  matchGridItem,
  MY_BUSINESS_INFO_PATH,
  pickRowFields,
  QUESTIONS_ANSWERS_PATH,
  RANK_GRID_CONCURRENCY,
  RANK_GRID_DEPTH,
  rankGridZoom,
  readPath,
  resolveBusinessIdentifier,
  REVIEW_ROW_FIELDS,
  summarizeGrid,
  type BusinessTaskEndpoint,
  type GridPointResult,
} from "./lib/local";
import { TASK_IN_PROGRESS_STATUS_CODES, isNoResultsMessage } from "./lib/serp";

export const LOCAL_RUN_JOB = "seo.local-run";
export const LOCAL_COLLECT_JOB = "seo.local-collect";
/** Collect delays for queued business tasks (reviews / posts), seconds. */
const COLLECT_DELAYS_S = [5, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 300];

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
const identifier = {
  businessName: z.string().trim().min(1).max(200).optional(),
  cid: z.string().trim().min(1).max(64).optional(),
  placeId: z.string().trim().min(1).max(256).optional(),
};
const businessNear = z.object({ latitude: lat, longitude: lng, radiusKm: z.number().min(0.2).max(199).optional() });
const languageCode = z.string().min(2).max(8).optional();

export const LOCAL_TOOL_SCHEMAS = {
  business_search: z.object({
    query: z.string().trim().min(1).max(200).optional(),
    near: z.object({ latitude: lat, longitude: lng, radiusKm: z.number().min(1).max(100_000).default(10) }),
    categories: z.array(z.string().min(1).max(120)).max(10).optional(),
    minRating: z.number().min(1).max(5).optional(),
    minReviews: z.number().int().min(0).optional(),
    isClaimed: z.boolean().optional(),
    sortBy: z.enum(["relevance", "rating", "reviews"]).default("relevance"),
    limit: z.number().int().min(1).max(50).default(20),
    offset: z.number().int().min(0).max(1000).default(0),
  }),
  local_serp: z.object({
    keyword: z.string().trim().min(1).max(200),
    near: z.object({ latitude: lat, longitude: lng, zoom: z.number().int().min(4).max(18).optional() }),
    searchType: z.enum(["maps", "local_finder"]).default("maps"),
    device: z.enum(["desktop", "mobile"]).default("mobile"),
    depth: z.number().int().min(1).max(100).default(20),
    languageCode,
  }),
  rank_grid: z
    .object({
      keyword: z.string().trim().min(1).max(120),
      target: z.object({ cid: identifier.cid, placeId: identifier.placeId, name: z.string().trim().min(1).max(200).optional() }),
      center: z.object({ latitude: lat, longitude: lng }),
      gridSize: z.union([z.literal(3), z.literal(5)]).default(3),
      spacingKm: z.number().min(0.25).max(10).default(2),
      device: z.enum(["desktop", "mobile"]).default("mobile"),
      zoom: z.number().int().min(4).max(18).optional(),
      languageCode,
    })
    .refine((v) => v.target.cid || v.target.placeId || v.target.name, { message: "Target needs at least one of CID, place ID or name." }),
  business_profile: z.object({ ...identifier, near: businessNear.optional(), locationCode: z.number().int().positive().optional(), languageCode }),
  reviews: z.object({
    ...identifier,
    near: businessNear.optional(),
    locationCode: z.number().int().positive().optional(),
    languageCode,
    depth: z.number().int().min(10).max(200).default(20),
    sortBy: z.enum(["newest", "highest_rating", "lowest_rating", "relevant"]).default("newest"),
    includeOtherSources: z.boolean().default(false),
  }),
  questions: z.object({ ...identifier, near: businessNear, depth: z.number().int().min(1).max(100).default(20), languageCode }),
  posts: z.object({
    ...identifier,
    near: businessNear.optional(),
    locationCode: z.number().int().positive().optional(),
    languageCode,
    depth: z.number().int().min(10).max(100).default(10),
  }),
} as const;

export type LocalRunTool = keyof typeof LOCAL_TOOL_SCHEMAS;
export { estimateLocalRunCost };
export type LocalToolInput<T extends LocalRunTool> = z.input<(typeof LOCAL_TOOL_SCHEMAS)[T]>;
export type LocalRun = typeof seoLocalRuns.$inferSelect;

function identifierLabel(i: { businessName?: string; cid?: string; placeId?: string }) {
  return i.businessName ?? (i.cid ? `CID ${i.cid}` : i.placeId ? `Place ${i.placeId}` : "business");
}

function labelFor(tool: LocalRunTool, input: Record<string, unknown>): string {
  const get = <K extends string>(k: K) => input[k] as string | undefined;
  switch (tool) {
    case "business_search":
      return get("query") ?? ((input.categories as string[] | undefined)?.join(", ") || "Businesses nearby");
    case "local_serp":
    case "rank_grid":
      return get("keyword") ?? "Local SERP";
    default:
      return identifierLabel(input as { businessName?: string; cid?: string; placeId?: string });
  }
}

/** Validates, stores a queued run and enqueues its job. */
export async function createLocalRun<T extends LocalRunTool>(ctx: SeoContext, tool: T, raw: LocalToolInput<T>): Promise<LocalRun> {
  assertCanRun(ctx, "run Local SEO tools");
  const parsed = LOCAL_TOOL_SCHEMAS[tool].safeParse(raw);
  if (!parsed.success) throw new SeoError("VALIDATION_ERROR", parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "));
  const input = parsed.data as Record<string, unknown>;
  if (tool === "business_profile" || tool === "reviews" || tool === "questions" || tool === "posts") {
    try {
      resolveBusinessIdentifier(input);
    } catch (err) {
      throw toSeoError(err);
    }
  }
  const [run] = await db
    .insert(seoLocalRuns)
    .values({ projectId: ctx.projectId, tool, label: labelFor(tool, input).slice(0, 200), input, createdBy: ctx.userId })
    .returning();
  const job = await enqueueJob(LOCAL_RUN_JOB, { runId: run!.id }, { projectId: ctx.projectId, workspaceId: ctx.workspaceId, createdBy: ctx.userId, maxAttempts: 1, priority: 50 });
  await db.update(seoLocalRuns).set({ jobId: job?.id ?? null }).where(eq(seoLocalRuns.id, run!.id));
  return { ...run!, jobId: job?.id ?? null };
}

export async function listLocalRuns(ctx: SeoContext, input: { tool?: SeoLocalTool; limit?: number } = {}) {
  return db
    .select({
      id: seoLocalRuns.id,
      tool: seoLocalRuns.tool,
      label: seoLocalRuns.label,
      status: seoLocalRuns.status,
      error: seoLocalRuns.error,
      costUsd: seoLocalRuns.costUsd,
      createdAt: seoLocalRuns.createdAt,
      completedAt: seoLocalRuns.completedAt,
    })
    .from(seoLocalRuns)
    .where(and(eq(seoLocalRuns.projectId, ctx.projectId), input.tool ? eq(seoLocalRuns.tool, input.tool) : undefined))
    .orderBy(desc(seoLocalRuns.createdAt))
    .limit(Math.min(200, input.limit ?? 50));
}

export async function getLocalRun(ctx: SeoContext, runId: string): Promise<LocalRun> {
  const [run] = await db.select().from(seoLocalRuns).where(and(eq(seoLocalRuns.id, runId), eq(seoLocalRuns.projectId, ctx.projectId))).limit(1);
  if (!run) throw new SeoError("NOT_FOUND", "Run not found");
  return run;
}

export async function deleteLocalRun(ctx: SeoContext, runId: string) {
  assertCanRun(ctx, "manage Local SEO runs");
  await db.delete(seoLocalRuns).where(and(eq(seoLocalRuns.id, runId), eq(seoLocalRuns.projectId, ctx.projectId)));
  return { ok: true };
}

/** Re-attempt collecting a queued reviews/posts task (free — the task was billed at post time). */
export async function retryLocalCollect(ctx: SeoContext, runId: string) {
  assertCanRun(ctx, "manage Local SEO runs");
  const run = await getLocalRun(ctx, runId);
  if (!run.taskId || !run.taskEndpoint) throw new SeoError("VALIDATION_ERROR", "This run has no queued task to collect.");
  await db.update(seoLocalRuns).set({ status: "processing", error: null, collectAttempts: 0 }).where(eq(seoLocalRuns.id, run.id));
  const job = await enqueueJob(LOCAL_COLLECT_JOB, { runId: run.id }, { projectId: run.projectId, maxAttempts: 2 });
  await db.update(seoLocalRuns).set({ jobId: job?.id ?? null }).where(eq(seoLocalRuns.id, run.id));
  return { ok: true };
}

/* ───────────────────────────── Execution (jobs) ───────────────────────────── */

async function loadRunCtx(runId: string) {
  const [row] = await db.select({ run: seoLocalRuns, project: projects }).from(seoLocalRuns).innerJoin(projects, eq(projects.id, seoLocalRuns.projectId)).where(eq(seoLocalRuns.id, runId)).limit(1);
  if (!row) return null;
  return { run: row.run, ctx: systemSeoContext(row.project, row.run.createdBy) };
}

async function finishRun(runId: string, result: unknown, costUsd: number) {
  await db.update(seoLocalRuns).set({ status: "completed", result: result as object, costUsd, completedAt: new Date(), error: null }).where(eq(seoLocalRuns.id, runId));
}

async function failRun(runId: string, err: unknown) {
  const e = toSeoError(err);
  await db
    .update(seoLocalRuns)
    .set({ status: "failed", error: e instanceof Error ? e.message : String(e), completedAt: new Date() })
    .where(eq(seoLocalRuns.id, runId));
}

function businessLocation(ctx: SeoContext, input: { near?: { latitude: number; longitude: number; radiusKm?: number }; locationCode?: number; languageCode?: string }) {
  return {
    locationCoordinate: input.near ? formatBusinessDataCoordinate(input.near) : undefined,
    locationCode: input.near ? undefined : (input.locationCode ?? ctx.market.locationCode),
    languageCode: input.languageCode ?? ctx.market.languageCode,
  };
}

/** Entry point of `seo.local-run`. */
export async function executeLocalRun(runId: string) {
  const loaded = await loadRunCtx(runId);
  if (!loaded || loaded.run.status === "completed" || loaded.run.status === "failed") return { skipped: true };
  const { run, ctx } = loaded;
  await db.update(seoLocalRuns).set({ status: "running" }).where(eq(seoLocalRuns.id, runId));
  const tool = run.tool as LocalRunTool;
  try {
    const S = LOCAL_TOOL_SCHEMAS;
    switch (tool) {
      case "business_search": {
        const i = S.business_search.parse(run.input);
        const task = await dfsLive<{ items?: unknown[] | null; total_count?: number | null }>(ctx, BUSINESS_LISTINGS_SEARCH_PATH, buildBusinessSearchTask(i), {
          feature: "local_seo",
          treatNoResultsAsEmpty: true,
          estimatedCostUsd: LOCAL_COST_HINTS.businessListings,
        });
        const r = task.result[0];
        await finishRun(runId, { businesses: (r?.items ?? []).map((row) => pickRowFields(row, BUSINESS_LISTING_FIELDS)), totalCount: r?.total_count ?? null }, task.cost);
        return { ok: true };
      }
      case "local_serp": {
        const i = S.local_serp.parse(run.input);
        const req = buildLocalSerpRequest({ ...i, ...i.near, languageCode: i.languageCode ?? ctx.market.languageCode });
        const task = await dfsLive<{ items?: unknown[] | null }>(ctx, req.path, req.task, { feature: "local_seo", treatNoResultsAsEmpty: true, retry5xx: false });
        await finishRun(runId, { items: (task.result[0]?.items ?? []).map((row) => pickRowFields(row, LOCAL_SERP_FIELDS)), searchType: i.searchType }, task.cost);
        return { ok: true };
      }
      case "rank_grid":
        return runRankGrid(ctx, runId, S.rank_grid.parse(run.input));
      case "business_profile": {
        const i = S.business_profile.parse(run.input);
        const id = resolveBusinessIdentifier(i);
        const loc = businessLocation(ctx, i);
        const task = await dfsLive<{ items?: Record<string, unknown>[] | null; check_url?: string | null }>(
          ctx,
          MY_BUSINESS_INFO_PATH,
          { keyword: businessIdentifierKeyword(id), ...businessLocationParams(loc), language_code: loc.languageCode },
          { feature: "local_seo", treatNoResultsAsEmpty: true, estimatedCostUsd: LOCAL_COST_HINTS.businessInfo },
        );
        const entry = task.result[0];
        const item = entry?.items?.[0] ?? null;
        const profile = item ? { ...item, check_url: item.check_url ?? entry?.check_url ?? null } : null;
        await finishRun(runId, { profile }, task.cost);
        return { ok: true };
      }
      case "questions": {
        const i = S.questions.parse(run.input);
        const id = resolveBusinessIdentifier(i);
        const task = await dfsLive<unknown>(
          ctx,
          QUESTIONS_ANSWERS_PATH,
          {
            keyword: businessIdentifierKeyword(id),
            location_coordinate: formatBusinessDataCoordinate(i.near),
            language_code: i.languageCode ?? ctx.market.languageCode,
            depth: i.depth,
          },
          { feature: "local_seo", treatNoResultsAsEmpty: true, estimatedCostUsd: LOCAL_COST_HINTS.questions },
        );
        await finishRun(runId, { questions: combinedQuestionItems(task.result) }, task.cost);
        return { ok: true };
      }
      case "reviews":
      case "posts": {
        let post: { endpoint: BusinessTaskEndpoint; task: Record<string, unknown> };
        let estimate: number;
        if (tool === "reviews") {
          const i = S.reviews.parse(run.input);
          const id = resolveBusinessIdentifier(i);
          post = buildReviewsTaskPost({ ...id, ...businessLocation(ctx, i), depth: i.depth, sortBy: i.sortBy, includeOtherSources: i.includeOtherSources });
          estimate = estimateLocalRunCost(tool, i);
        } else {
          const i = S.posts.parse(run.input);
          const id = resolveBusinessIdentifier(i);
          post = buildUpdatesTaskPost({ keyword: businessIdentifierKeyword(id), depth: i.depth, ...businessLocation(ctx, i) });
          estimate = estimateLocalRunCost(tool, i);
        }
        // Billed at post → never retried.
        const res = await dfsTaskPost(ctx, businessTaskPostPath(post.endpoint), [post.task], "local_seo", estimate);
        const t = res.tasks[0];
        if (res.statusCode !== 20000 || !t || t.status_code !== 20100 || !t.id) {
          throw new SeoError("UPSTREAM", t?.status_message || res.statusMessage || "DataForSEO task_post failed");
        }
        await db
          .update(seoLocalRuns)
          .set({ status: "processing", taskId: t.id, taskEndpoint: post.endpoint, costUsd: res.cost, collectAttempts: 0 })
          .where(eq(seoLocalRuns.id, runId));
        const job = await enqueueJob(LOCAL_COLLECT_JOB, { runId }, { runAt: new Date(Date.now() + COLLECT_DELAYS_S[0]! * 1000), projectId: run.projectId, maxAttempts: 2 });
        await db.update(seoLocalRuns).set({ jobId: job?.id ?? null }).where(eq(seoLocalRuns.id, runId));
        return { queued: true, taskId: t.id };
      }
    }
  } catch (err) {
    await failRun(runId, err);
    return { failed: true };
  }
}

async function runRankGrid(ctx: SeoContext, runId: string, i: z.infer<(typeof LOCAL_TOOL_SCHEMAS)["rank_grid"]>) {
  const zoom = i.zoom ?? rankGridZoom(i.spacingKm, i.center.latitude);
  const points = buildRankGridPoints(i.center, i.gridSize, i.spacingKm);
  const languageCode = i.languageCode ?? ctx.market.languageCode;
  let matchedBusiness: { title: string | null; cid: string | null; placeId: string | null } | null = null;
  let lastError: unknown = null;
  let cost = 0;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const searchPoint = async (p: (typeof points)[number]): Promise<GridPointResult> => {
    try {
      const task = await dfsLive<{ items?: unknown[] | null }>(
        ctx,
        MAPS_SERP_PATH,
        {
          keyword: i.keyword,
          location_coordinate: formatLocalSerpCoordinate({ ...p, zoom }),
          language_code: languageCode,
          device: i.device,
          os: i.device === "desktop" ? "windows" : "android",
          depth: RANK_GRID_DEPTH,
          search_places: false,
        },
        { feature: "local_seo", treatNoResultsAsEmpty: true, retry5xx: false },
      );
      cost += task.cost;
      const items = task.result[0]?.items ?? [];
      const match = matchGridItem(items, { cid: i.target.cid, placeId: i.target.placeId, name: i.target.name });
      if (match && !matchedBusiness) matchedBusiness = { title: str(readPath(match, "title")), cid: str(readPath(match, "cid")), placeId: str(readPath(match, "place_id")) };
      const rank = readPath(match, "rank_absolute") ?? readPath(match, "rank_group");
      const first = items[0];
      return {
        ...p,
        rank: typeof rank === "number" ? rank : null,
        resultsCount: items.length,
        topResult: first == null ? null : { title: str(readPath(first, "title")), cid: str(readPath(first, "cid")) },
      };
    } catch (err) {
      // Systemic failures abort instead of rendering a misleading grid.
      if (err instanceof SeoError && ["NOT_CONFIGURED", "AUTH_FAILED", "INSUFFICIENT_FUNDS", "BUDGET"].includes(err.code)) throw err;
      lastError = err;
      return { ...p, rank: null, error: true };
    }
  };
  const grid: GridPointResult[] = [];
  for (let k = 0; k < points.length; k += RANK_GRID_CONCURRENCY) {
    grid.push(...(await Promise.all(points.slice(k, k + RANK_GRID_CONCURRENCY).map(searchPoint))));
  }
  if (grid.every((p) => p.error)) throw lastError ?? new SeoError("UPSTREAM", "Every grid point failed");
  await finishRun(runId, { grid, summary: summarizeGrid(grid), matchedBusiness, gridSize: i.gridSize, spacingKm: i.spacingKm, zoom, center: i.center, keyword: i.keyword, device: i.device }, cost);
  return { ok: true };
}

/** Entry point of `seo.local-collect` — free task_get; re-schedules itself with growing delays. */
export async function collectLocalTask(runId: string) {
  const loaded = await loadRunCtx(runId);
  if (!loaded || loaded.run.status !== "processing" || !loaded.run.taskId || !loaded.run.taskEndpoint) return { skipped: true };
  const { run, ctx } = loaded;
  const endpoint = run.taskEndpoint as BusinessTaskEndpoint;
  let task;
  try {
    task = await dfsGetTask<Record<string, unknown>>(ctx, businessTaskGetPath(endpoint, run.taskId!), "local_seo");
  } catch (err) {
    task = null;
    console.warn("[local-seo] task_get failed", err instanceof Error ? err.message : err);
  }
  const attempts = run.collectAttempts + 1;
  if (task && !TASK_IN_PROGRESS_STATUS_CODES.has(task.status_code)) {
    if (task.status_code !== 20000 && !isNoResultsMessage(task.status_message)) {
      await failRun(runId, new SeoError("UPSTREAM", task.status_message || `DataForSEO task failed (${task.status_code})`));
      return { failed: true };
    }
    const first = (task.result?.[0] ?? null) as Record<string, unknown> | null;
    const items = Array.isArray(first?.items) ? (first!.items as unknown[]) : [];
    const result =
      run.tool === "reviews"
        ? {
            reviews: items.map((r) => pickRowFields(r, REVIEW_ROW_FIELDS)),
            totals: first ? pickRowFields(first, ["title", "reviews_count", "rating", "cid", "place_id"]) : null,
            source: endpoint,
          }
        : { posts: items.map((r) => pickRowFields(r, BUSINESS_UPDATE_ROW_FIELDS)), totals: first ? pickRowFields(first, ["title", "cid", "place_id"]) : null };
    await db.update(seoLocalRuns).set({ collectAttempts: attempts }).where(eq(seoLocalRuns.id, runId));
    await finishRun(runId, result, run.costUsd);
    return { ok: true };
  }
  if (attempts >= COLLECT_DELAYS_S.length) {
    await db
      .update(seoLocalRuns)
      .set({ status: "failed", collectAttempts: attempts, error: "DataForSEO is still processing this task. Use “Retry collection” later — collecting is free.", completedAt: new Date() })
      .where(eq(seoLocalRuns.id, runId));
    return { timedOut: true };
  }
  await db.update(seoLocalRuns).set({ collectAttempts: attempts }).where(eq(seoLocalRuns.id, runId));
  const job = await enqueueJob(LOCAL_COLLECT_JOB, { runId }, { runAt: new Date(Date.now() + COLLECT_DELAYS_S[attempts]! * 1000), projectId: run.projectId, maxAttempts: 2 });
  await db.update(seoLocalRuns).set({ jobId: job?.id ?? null }).where(eq(seoLocalRuns.id, runId));
  return { pending: true, attempts };
}

/* ───────────────────────────── Free helpers ───────────────────────────── */

export type BusinessCategory = { category: string; businessCount: number | null };

/** Free `GET business_listings/categories`, full list cached 7 days, filtered in memory. */
export async function listBusinessCategories(ctx: SeoContext, input: { query?: string; limit?: number } = {}) {
  let all = (await cacheGet<BusinessCategory[]>("local:business-categories"))?.value;
  if (!all) {
    const task = await dfsGetTask<{ category_name?: string; business_count?: number | null }>(ctx, BUSINESS_LISTINGS_CATEGORIES_PATH, "local_seo");
    all = (task.result ?? [])
      .filter((r) => typeof r?.category_name === "string")
      .map((r) => ({ category: r.category_name!, businessCount: r.business_count ?? null }))
      .sort((a, b) => (b.businessCount ?? 0) - (a.businessCount ?? 0));
    await cacheSet("local:business-categories", "local:business-categories", null, all, CACHE_TTL.businessCategories);
  }
  const q = input.query?.trim().toLowerCase().replace(/\s+/g, "_");
  const matched = q ? all.filter((c) => c.category.toLowerCase().includes(q)) : all;
  return { total: matched.length, categories: matched.slice(0, Math.min(200, input.limit ?? 50)) };
}

export type GeocodeResult = { label: string; latitude: number; longitude: number; type: string };

/**
 * Place search → coordinates via OpenStreetMap Nominatim (free, fixed host, no key). Rate-limited to 1 req/s per
 * instance per their usage policy; cached 30 days.
 */
export async function geocodePlace(query: string): Promise<GeocodeResult[]> {
  const q = z.string().trim().min(2).max(200).parse(query);
  const key = buildCacheKey("geocode", { q: q.toLowerCase() });
  const cached = await cacheGet<GeocodeResult[]>(key);
  if (cached) return cached.value;
  if (!rateLimit("seo:nominatim", 1, 1100)) throw new SeoError("UPSTREAM", "Place search is busy — try again in a second.");
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`;
  let rows: { display_name?: string; lat?: string; lon?: string; type?: string }[] = [];
  try {
    const res = await fetch(url, { headers: { "User-Agent": "AutoSEO (self-hosted SEO platform)", Accept: "application/json" }, signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (res.ok) rows = (await res.json()) as typeof rows;
  } catch (err) {
    throw new SeoError("UPSTREAM", `Place search failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const out = rows
    .map((r) => ({ label: r.display_name ?? "", latitude: Number(r.lat), longitude: Number(r.lon), type: r.type ?? "" }))
    .filter((r) => r.label && Number.isFinite(r.latitude) && Number.isFinite(r.longitude));
  await cacheSet(key, "geocode", null, out, CACHE_TTL.serpLocations);
  return out;
}
