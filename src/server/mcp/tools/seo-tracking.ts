import "server-only";
import { z } from "zod";
import {
  createRankConfig,
  estimateRankTrackerCost,
  getLatestRankRun,
  LOCAL_TOOL_SCHEMAS,
  listBusinessCategories,
  removeTrackingKeywords,
  triggerRankCheck,
  type LocalRunTool,
} from "@/server/seo";
import { apiSeoContext } from "@/server/api/module-context";
import {
  addKeywordsBody,
  addKeywordsWithApproval,
  COMPARE_PERIODS,
  createTrackerBody,
  listTrackers,
  requireDataForSeo,
  startLocalRun,
  trackerResults,
  trackerView,
  waitForLocalRun,
  type LocalRunView,
} from "@/server/api/seo-tracking";
import { defineTool, type McpToolContext, type McpToolResult } from "../types";
import { mdTable, projectIdInput, toolProject } from "../helpers";

/**
 * open-seo MCP tools — rank tracking (6) and local SEO / Google Business (8 + run lookup).
 * Paid calls go through DataForSEO and need the `seo.run` role permission.
 */

const PAID = { readOnlyHint: false, openWorldHint: true } as const;
const WAIT_MS = 25_000;
const trackerIdInput = z.string().min(1).max(64).describe("Rank tracker id (from get_rank_tracker / create_rank_tracker).");

const pos = (v: number | null | undefined) => (v == null ? "—" : String(v));
const asRec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const rating = (row: Record<string, unknown>) => {
  const r = asRec(row.rating);
  return { value: typeof r.value === "number" ? r.value : null, votes: typeof r.votes_count === "number" ? r.votes_count : null };
};
const addressOf = (row: Record<string, unknown>) =>
  typeof row.address === "string" ? row.address : typeof asRec(row.address_info).address === "string" ? (asRec(row.address_info).address as string) : null;

/* ───────────────────────────── Local run → tool result ───────────────────────────── */

function pendingText(run: LocalRunView) {
  return `Run ${run.runId} is still ${run.status} (DataForSEO is processing it). Call get_local_seo_run with runId "${run.runId}" in 30–60 seconds — fetching the result is free.`;
}

function localText(run: LocalRunView): string {
  if (run.status === "failed") return `Run ${run.runId} failed: ${run.error ?? "unknown error"}`;
  if (run.status !== "completed" || !run.result) return pendingText(run);
  const r = run.result;
  const cost = `Cost ~$${run.costUsd.toFixed(4)}.`;
  switch (run.tool as LocalRunTool) {
    case "business_search": {
      const rows = (r.businesses as Record<string, unknown>[] | undefined) ?? [];
      return `${rows.length} business(es)${r.totalCount != null ? ` of ${r.totalCount}` : ""}. ${cost}\n\n${mdTable(rows, [
        ["title", (x) => x.title],
        ["category", (x) => x.category],
        ["rating", (x) => rating(x).value],
        ["reviews", (x) => rating(x).votes],
        ["claimed", (x) => x.is_claimed],
        ["phone", (x) => x.phone],
        ["address", (x) => addressOf(x)],
        ["cid", (x) => x.cid],
      ])}`;
    }
    case "local_serp": {
      const rows = (r.items as Record<string, unknown>[] | undefined) ?? [];
      return `${rows.length} ${r.searchType === "local_finder" ? "Local Finder" : "Maps"} result(s). ${cost}\n\n${mdTable(rows, [
        ["rank", (x) => x.rank_absolute ?? x.rank_group],
        ["title", (x) => x.title],
        ["category", (x) => x.category],
        ["rating", (x) => rating(x).value],
        ["reviews", (x) => rating(x).votes],
        ["domain", (x) => x.domain],
        ["address", (x) => addressOf(x)],
        ["cid", (x) => x.cid],
      ])}`;
    }
    case "rank_grid": {
      const grid = (r.grid as { row: number; col: number; rank: number | null; error?: boolean }[] | undefined) ?? [];
      const size = Number(r.gridSize ?? 3);
      const lines: string[] = [];
      for (let row = 0; row < size; row++) {
        lines.push(
          Array.from({ length: size }, (_, col) => {
            const p = grid.find((g) => g.row === row && g.col === col);
            return (p?.error ? "x" : p?.rank != null ? String(p.rank) : "–").padStart(3);
          }).join(" "),
        );
      }
      const s = asRec(r.summary);
      const m = asRec(r.matchedBusiness);
      return `Rank grid for "${r.keyword}" (${size}×${size}, ${r.spacingKm} km spacing, north at top; – = not in top 20, x = failed):\n\n\`\`\`\n${lines.join("\n")}\n\`\`\`\nFound at ${s.pointsFound}/${s.pointsSearched} points · avg rank ${s.averageRank ?? "—"} · top 3 at ${s.top3Count} · top 10 at ${s.top10Count}. Matched: ${m.title ?? "not found"}. ${cost}`;
    }
    case "business_profile": {
      const p = asRec(r.profile);
      if (!r.profile) return `No Google Business Profile found. ${cost}`;
      const rt = rating(p);
      const hours = asRec(asRec(p.work_time).work_hours);
      const status = typeof hours.current_status === "string" ? hours.current_status : null;
      return [
        `**${p.title ?? "Business"}** — ${p.category ?? "no category"}${Array.isArray(p.additional_categories) && p.additional_categories.length ? ` (+ ${(p.additional_categories as string[]).join(", ")})` : ""}`,
        `Rating ${rt.value ?? "—"} from ${rt.votes ?? 0} reviews · claimed: ${p.is_claimed ? "yes" : "no"}${status ? ` · now ${status}` : ""}`,
        `Address: ${addressOf(p) ?? "—"} · Phone: ${p.phone ?? "—"} · Website: ${p.url ?? p.domain ?? "—"}`,
        `CID ${p.cid ?? "—"} · place_id ${p.place_id ?? "—"}${p.check_url ? ` · ${p.check_url}` : ""}`,
        cost,
      ].join("\n");
    }
    case "questions": {
      const rows = (r.questions as Record<string, unknown>[] | undefined) ?? [];
      return `${rows.length} question(s). ${cost}\n\n${mdTable(rows, [
        ["question", (x) => x.question_text],
        ["by", (x) => x.profile_name],
        ["when", (x) => x.time_ago],
        ["answers", (x) => (Array.isArray(x.items) ? x.items.length : 0)],
      ])}`;
    }
    case "reviews": {
      const rows = (r.reviews as Record<string, unknown>[] | undefined) ?? [];
      const t = asRec(r.totals);
      return `${rows.length} review(s) of ${t.title ?? "the business"}${t.reviews_count != null ? ` (${t.reviews_count} total, rating ${asRec(t.rating).value ?? "—"})` : ""}. ${cost}\n\n${mdTable(rows, [
        ["#", (x) => x.rank_absolute],
        ["when", (x) => x.time_ago],
        ["rating", (x) => asRec(x.rating).value],
        ["author", (x) => x.profile_name],
        ["review", (x) => (typeof x.review_text === "string" ? x.review_text.slice(0, 120) : null)],
        ["owner replied", (x) => Boolean(x.owner_answer)],
      ])}`;
    }
    case "posts": {
      const rows = (r.posts as Record<string, unknown>[] | undefined) ?? [];
      return `${rows.length} post(s)/update(s). ${cost}\n\n${mdTable(rows, [
        ["#", (x) => x.rank_absolute],
        ["date", (x) => x.post_date],
        ["post", (x) => (typeof x.post_text === "string" ? x.post_text.slice(0, 140) : x.snippet)],
        ["url", (x) => x.url],
      ])}`;
    }
  }
}

function localResult(run: LocalRunView, ctx: McpToolContext, projectId: string): McpToolResult {
  return {
    text: localText(run),
    data: { projectId, ...run, url: `${ctx.baseUrl}/p/${projectId}/seo/local` },
    isError: run.status === "failed",
  };
}

type LocalShape = (typeof LOCAL_TOOL_SCHEMAS)[LocalRunTool]["shape"];

function localTool<T extends LocalRunTool>(tool: T, def: { name: string; title: string; description: string }) {
  const shape = LOCAL_TOOL_SCHEMAS[tool].shape as LocalShape;
  return defineTool({
    name: def.name,
    title: def.title,
    description: def.description,
    input: z.object({ projectId: projectIdInput, ...shape }),
    scope: "read",
    permission: "seo.run",
    annotations: PAID,
    async handler(args, ctx) {
      const input: Record<string, unknown> = { ...(args as Record<string, unknown>) };
      const project = await toolProject(ctx, input.projectId as string | undefined);
      delete input.projectId;
      const run = await startLocalRun(apiSeoContext(ctx.principal, project), tool, input as never, WAIT_MS);
      return localResult(run, ctx, project.id);
    },
  });
}

const IDENTIFIER_HELP =
  "Identify the business by exactly one of businessName, cid or placeId (cid/placeId from search_local_businesses or get_local_serp_results).";

/* ───────────────────────────── Tools ───────────────────────────── */

export const seoTrackingTools = [
  defineTool({
    name: "create_rank_tracker",
    title: "Create rank tracker",
    description:
      "Creates a Google rank tracker for a domain in a market (country, or a city via locationName from search_serp_locations). Free — no check runs until you call run_rank_tracker or a schedule is set. Defaults: project domain, mobile, depth 40, manual schedule. Requires the write scope and the seo.run permission.",
    input: z.object({ projectId: projectIdInput, ...createTrackerBody.shape }),
    scope: "write",
    permission: "seo.run",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    async handler(args, ctx) {
      const project = await toolProject(ctx, args.projectId);
      const config = await createRankConfig(apiSeoContext(ctx.principal, project), {
        domain: args.domain ?? project.domain,
        locationCode: args.locationCode,
        languageCode: args.languageCode,
        locationName: args.locationName ?? null,
        devices: args.devices,
        serpDepth: args.serpDepth,
        scheduleInterval: args.scheduleInterval,
      });
      const tracker = trackerView(config);
      return {
        text: `Created rank tracker ${config.id} for ${config.domain} (location ${config.locationName ?? config.locationCode}, ${config.devices}, depth ${config.serpDepth}, ${config.scheduleInterval}). Add keywords with add_rank_tracking_keywords.`,
        data: { projectId: project.id, trackerId: config.id, config: tracker, url: `${ctx.baseUrl}/p/${project.id}/seo/rank-tracking/${config.id}` },
      };
    },
  }),

  defineTool({
    name: "get_rank_tracker",
    title: "Get rank tracker(s)",
    description:
      "Without trackerId: lists the project's active rank trackers. With trackerId: current desktop/mobile positions of every tracked keyword vs. the comparison period (1d/7d/30d/90d, default 7d), ranking URLs and the latest run status. Free (reads stored results).",
    input: z.object({
      projectId: projectIdInput,
      trackerId: trackerIdInput.optional(),
      comparePeriod: z.enum(COMPARE_PERIODS).optional(),
    }),
    scope: "read",
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(args, ctx) {
      const project = await toolProject(ctx, args.projectId);
      const sctx = apiSeoContext(ctx.principal, project);
      if (!args.trackerId) {
        const configs = await listTrackers(sctx);
        return {
          text: `${configs.length} rank tracker(s):\n\n${mdTable(configs, [
            ["trackerId", (c) => c.trackerId],
            ["domain", (c) => c.domain],
            ["location", (c) => c.locationName ?? c.locationCode],
            ["devices", (c) => c.devices],
            ["schedule", (c) => c.scheduleInterval],
            ["keywords", (c) => c.keywordCount],
            ["last run", (c) => c.lastRunStatus],
          ])}`,
          data: { projectId: project.id, configs, url: `${ctx.baseUrl}/p/${project.id}/seo/rank-tracking` },
        };
      }
      const res = await trackerResults(sctx, args.trackerId, args.comparePeriod ?? "7d");
      const { rows, run } = res;
      return {
        text: `**${res.config.domain}** (${res.config.locationName ?? res.config.locationCode}) — ${rows.length} keyword(s); last run: ${run ? `${run.status}${run.lastCheckedAt ? `, checked ${run.lastCheckedAt}` : ""}` : "never"}.\n\n${mdTable(rows, [
          ["keyword", (r) => r.keyword],
          ["desktop", (r) => pos(r.desktop.position)],
          ["prev (desktop)", (r) => pos(r.desktop.previousPosition)],
          ["mobile", (r) => pos(r.mobile.position)],
          ["prev (mobile)", (r) => pos(r.mobile.previousPosition)],
          ["volume", (r) => r.searchVolume],
          ["id", (r) => r.trackingKeywordId],
        ], 100)}`,
        data: {
          projectId: project.id,
          config: res.config,
          results: { rows, run },
          url: `${ctx.baseUrl}/p/${project.id}/seo/rank-tracking/${res.config.trackerId}`,
        },
      };
    },
  }),

  defineTool({
    name: "add_rank_tracking_keywords",
    title: "Add keywords to a rank tracker",
    description:
      "Adds keywords (1–2000, max 80 chars each; duplicates skipped) to a rank tracker. Free unless runCheckNow=true. For scheduled trackers you must approve the recurring cost: pass maxEstimatedScheduledCheckCostUsd ≥ the per-check estimate (call estimate_rank_tracker_cost with additionalKeywordCount first). Requires write scope + seo.run.",
    input: z.object({ projectId: projectIdInput, trackerId: trackerIdInput, ...addKeywordsBody.shape }),
    scope: "write",
    permission: "seo.run",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    async handler(args, ctx) {
      const project = await toolProject(ctx, args.projectId);
      const trackerId = args.trackerId;
      const res = await addKeywordsWithApproval(apiSeoContext(ctx.principal, project), trackerId, {
        keywords: args.keywords,
        matchCase: args.matchCase,
        maxEstimatedScheduledCheckCostUsd: args.maxEstimatedScheduledCheckCostUsd,
        runCheckNow: args.runCheckNow,
      });
      const e = res.scheduledEstimate;
      return {
        text: `Added ${res.added} of ${res.requested} keyword(s) to tracker ${trackerId}${res.checkTriggered ? "; a live check for them started" : ""}.${e ? ` Each ${e.scheduleInterval} check now costs ~$${e.costUsd.toFixed(4)} (~$${e.monthlyCostUsd.toFixed(2)}/month).` : ""}`,
        data: { projectId: project.id, ...res, url: `${ctx.baseUrl}/p/${project.id}/seo/rank-tracking/${trackerId}` },
      };
    },
  }),

  defineTool({
    name: "remove_rank_tracking_keywords",
    title: "Remove keywords from a rank tracker",
    description:
      "Stops tracking keywords (trackingKeywordId values from get_rank_tracker). Position history of removed keywords is deleted with them. Requires write scope + seo.run.",
    input: z.object({ projectId: projectIdInput, trackerId: trackerIdInput, keywordIds: z.array(z.string().min(1).max(64)).min(1).max(2000) }),
    scope: "write",
    permission: "seo.run",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    async handler(args, ctx) {
      const project = await toolProject(ctx, args.projectId);
      const res = await removeTrackingKeywords(apiSeoContext(ctx.principal, project), { configId: args.trackerId, keywordIds: args.keywordIds });
      return {
        text: `Removed ${res.removed} of ${args.keywordIds.length} keyword(s) from tracker ${args.trackerId}.`,
        data: { projectId: project.id, trackerId: args.trackerId, requested: args.keywordIds.length, ...res },
      };
    },
  }),

  defineTool({
    name: "estimate_rank_tracker_cost",
    title: "Estimate rank check cost",
    description:
      "Estimates the DataForSEO cost (USD) of one live rank check of a tracker (keywords × devices at its depth), optionally after adding additionalKeywordCount keywords, plus the per-check and monthly cost of its schedule (queued pricing). Free.",
    input: z.object({ projectId: projectIdInput, trackerId: trackerIdInput, additionalKeywordCount: z.number().int().min(0).max(1000).optional() }),
    scope: "read",
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(args, ctx) {
      const project = await toolProject(ctx, args.projectId);
      const e = await estimateRankTrackerCost(apiSeoContext(ctx.principal, project), args.trackerId, args.additionalKeywordCount ?? 0);
      const s = e.scheduledEstimate;
      return {
        text: `A live check of ${e.keywordCount} keyword(s) × ${e.devicesCount} device(s) = ${e.totalChecks} SERP checks costs ~$${e.costUsd.toFixed(4)}.${s ? ` Scheduled (${s.scheduleInterval}, queued pricing): ~$${s.costUsd.toFixed(4)} per check, ~$${s.monthlyCostUsd.toFixed(2)}/month.` : " The tracker has no schedule (manual)."} Queued tasks that fail may fall back to separately billed live checks.`,
        data: { projectId: project.id, trackerId: args.trackerId, ...e },
      };
    },
  }),

  defineTool({
    name: "run_rank_tracker",
    title: "Run a rank check",
    description:
      "Starts a paid live rank check (DataForSEO SERP: ~$0.002 per keyword × device for the first 10 results + $0.0015 per extra 10, i.e. ~$0.0065 at depth 40) for all keywords of a tracker, or only keywordIds. maxCostUsd is the approved ceiling — the check is refused when the fresh estimate exceeds it (use estimate_rank_tracker_cost). Returns started=false with the blocking run when one is in progress. Poll get_rank_tracker until the run completes. Requires write scope + seo.run.",
    input: z.object({
      projectId: projectIdInput,
      trackerId: trackerIdInput,
      maxCostUsd: z.number().positive().describe("Approved maximum cost in USD for this check."),
      keywordIds: z.array(z.string().min(1).max(64)).max(2000).optional().describe("Only check these trackingKeywordIds."),
    }),
    scope: "write",
    permission: "seo.run",
    annotations: { ...PAID, destructiveHint: false },
    async handler(args, ctx) {
      const project = await toolProject(ctx, args.projectId);
      await requireDataForSeo();
      const sctx = apiSeoContext(ctx.principal, project);
      const r = await triggerRankCheck(sctx, { configId: args.trackerId, keywordIds: args.keywordIds, maxCostUsd: args.maxCostUsd });
      const url = `${ctx.baseUrl}/p/${project.id}/seo/rank-tracking/${args.trackerId}`;
      if (!r.ok) {
        return {
          text: `A rank check is already running for this tracker (run ${r.blockingRunId ?? "unknown"}). No charge. Poll get_rank_tracker for its results.`,
          data: { projectId: project.id, trackerId: args.trackerId, started: false, blockingRunId: r.blockingRunId, url },
        };
      }
      const run = await getLatestRankRun(sctx, args.trackerId);
      return {
        text: `Rank check ${r.runId} started${run ? ` (${run.keywordsTotal} keyword(s))` : ""}. Poll get_rank_tracker with trackerId ${args.trackerId} until lastCheckedAt advances.`,
        data: { projectId: project.id, trackerId: args.trackerId, started: true, runId: r.runId, url },
      };
    },
  }),

  localTool("business_search", {
    name: "search_local_businesses",
    title: "Search local businesses",
    description:
      "Finds Google Business listings near a point (near: latitude, longitude, radiusKm 1–100000, default 10) by title query and/or category slugs (see list_business_categories), with minRating / minReviews / isClaimed filters, sortBy relevance|rating|reviews, limit ≤50. Returns title, category, rating, reviews, phone, address, cid and place_id. Paid (DataForSEO business listings, ~$0.01). Waits up to ~25 s; if still running, resume with get_local_seo_run.",
  }),
  localTool("local_serp", {
    name: "get_local_serp_results",
    title: "Local (Maps) SERP",
    description:
      "Google Maps or Local Finder results for a keyword as seen from a point (near: latitude, longitude, optional zoom 4–18), device mobile|desktop, depth 1–100 (default 20). Returns rank, title, domain, category, rating, reviews, address, cid/place_id. Paid (~$0.002 per 10 results). Waits up to ~25 s; resume with get_local_seo_run.",
  }),
  localTool("questions", {
    name: "get_google_business_questions",
    title: "Google Business Q&A",
    description: `Questions & answers on a Google Business Profile. ${IDENTIFIER_HELP} near (latitude, longitude, radiusKm) is required. depth 1–100 (default 20). Paid (~$0.005). Waits up to ~25 s; resume with get_local_seo_run.`,
  }),
  localTool("business_profile", {
    name: "get_business_profile",
    title: "Google Business Profile",
    description: `Full Google Business Profile: categories, rating breakdown, address, phone, website, claimed status, opening hours, photos, cid/place_id. ${IDENTIFIER_HELP} Optional near (latitude, longitude, radiusKm) or locationCode (default project market). Paid (~$0.005). Waits up to ~25 s; resume with get_local_seo_run.`,
  }),
  localTool("reviews", {
    name: "get_business_reviews",
    title: "Google Business reviews",
    description: `Latest reviews of a business (text, rating, author, owner replies). ${IDENTIFIER_HELP} depth 10–200 (default 20), sortBy newest|highest_rating|lowest_rating|relevant, includeOtherSources adds Yelp/Tripadvisor/Trustpilot. Paid (~$0.0015 per 10 reviews). DataForSEO processes reviews asynchronously: if the result is not ready within ~25 s, call get_local_seo_run with the returned runId in 30–60 s (free).`,
  }),
  localTool("posts", {
    name: "get_business_updates",
    title: "Google Business posts / updates",
    description: `Recent Google Business posts (updates) of a business. ${IDENTIFIER_HELP} depth 10–100 (default 10). Paid (~$0.0015 per 10). Asynchronous like reviews — resume with get_local_seo_run (free).`,
  }),
  localTool("rank_grid", {
    name: "get_local_rank_grid",
    title: "Local rank grid (geo-grid)",
    description:
      "Geo-grid rank check: searches Google Maps for keyword at gridSize×gridSize points (3 or 5) around center (latitude, longitude) spaced spacingKm apart (0.25–10, default 2) and finds the target business (target.cid, target.placeId or target.name contains). Returns the rank per point plus average rank and top-3/top-10 coverage. Paid: gridSize² Maps checks (3×3 ≈ $0.036, 5×5 ≈ $0.10). Can take a minute — resume with get_local_seo_run.",
  }),

  defineTool({
    name: "list_business_categories",
    title: "Google Business categories",
    description:
      "Lists Google Business category slugs (e.g. solar_energy_company) with business counts, optionally filtered by a substring query; use them in search_local_businesses. Free (cached 7 days), but needs DataForSEO credentials on first load.",
    input: z.object({ projectId: projectIdInput, query: z.string().trim().max(80).optional(), limit: z.number().int().min(1).max(200).optional() }),
    scope: "read",
    annotations: { readOnlyHint: true, openWorldHint: true },
    async handler(args, ctx) {
      const project = await toolProject(ctx, args.projectId);
      const res = await listBusinessCategories(apiSeoContext(ctx.principal, project), { query: args.query, limit: args.limit ?? 50 });
      return {
        text: `${res.total} matching categor${res.total === 1 ? "y" : "ies"}:\n\n${mdTable(res.categories, [
          ["category", (c) => c.category],
          ["businesses", (c) => c.businessCount],
        ], 200)}`,
        data: { projectId: project.id, ...res },
      };
    },
  }),

  defineTool({
    name: "get_local_seo_run",
    title: "Get local SEO run",
    description:
      "Status and result of a local SEO run started by search_local_businesses, get_local_serp_results, get_google_business_questions, get_business_profile, get_business_reviews, get_business_updates or get_local_rank_grid. Free. Waits up to waitSeconds (default 20, max 50) for runs that are still processing.",
    input: z.object({ projectId: projectIdInput, runId: z.string().min(1).max(64), waitSeconds: z.number().int().min(0).max(50).optional() }),
    scope: "read",
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(args, ctx) {
      const project = await toolProject(ctx, args.projectId);
      const run = await waitForLocalRun(apiSeoContext(ctx.principal, project), args.runId, (args.waitSeconds ?? 20) * 1000);
      return localResult(run, ctx, project.id);
    },
  }),
];

export { localText };
