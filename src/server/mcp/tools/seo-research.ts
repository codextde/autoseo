import "server-only";
import { z } from "zod";
import { accessibleProjects, getApiProject } from "@/server/api/auth";
import { ApiError } from "@/server/api/errors";
import { apiSeoContext } from "@/server/api/module-context";
import {
  backlinksOverviewBody,
  backlinksOverviewForApi,
  backlinksProfileBody,
  backlinksProfileForApi,
  backlinksTopPagesBody,
  backlinksTopPagesForApi,
  domainKeywordSuggestionsForApi,
  domainOverviewBody,
  domainOverviewForApi,
  domainTopPagesBody,
  domainTopPagesForApi,
  keywordMetricsBody,
  keywordMetricsForApi,
  listSavedKeywordsBody,
  listSavedKeywordsForApi,
  rankedKeywordsBody,
  rankedKeywordsForApi,
  referringDomainsBody,
  referringDomainsForApi,
  removeSavedKeywordsBody,
  removeSavedKeywordsForApi,
  researchKeywordsBody,
  researchKeywordsForApi,
  saveKeywordsBody,
  saveKeywordsForApi,
  serpCompetitorsBody,
  serpCompetitorsForApi,
  serpLocationsForApi,
  serpLocationsQuery,
  serpResultsBody,
  serpResultsForApi,
  tagSavedKeywordsBody,
  tagSavedKeywordsForApi,
} from "@/server/api/seo-research";
import { defineTool, type McpToolContext } from "../types";
import { mdTable, projectIdInput, toolProject } from "../helpers";

/**
 * open-seo MCP tools — keyword research, saved keywords, SERP, domain and backlink research.
 * Paid tools spend DataForSEO credits (recorded in Usage) and need the `seo.run` role permission
 * on a cache miss; cached results are free for every reader.
 */

const PAID = { readOnlyHint: false, openWorldHint: true } as const;
const FREE_RO = { readOnlyHint: true, openWorldHint: false } as const;

async function seoCtx(ctx: McpToolContext, projectId: string | undefined) {
  const project = await toolProject(ctx, projectId);
  return apiSeoContext(ctx.principal, project);
}

const cachedNote = (cached: boolean | undefined) => (cached ? " (cached — no cost)" : "");

export const seoResearchTools = [
  defineTool({
    name: "research_keywords",
    title: "Research keywords (bulk)",
    description:
      "Keyword ideas for 1–5 seed keywords (each researched separately): search volume, keyword difficulty, CPC, competition and intent. Uses DataForSEO Labs related → suggestions → ideas (Google Ads keyword ideas for Ads-only countries). Uses DataForSEO credits (~$0.025 per seed at 150 results, up to 3× in auto mode; clickstream doubles it); cached 24h. Needs the seo.run permission unless cached.",
    input: researchKeywordsBody.extend({ projectId: projectIdInput }),
    scope: "read",
    annotations: PAID,
    async handler(args, ctx) {
      const { projectId, ...body } = args;
      const res = await researchKeywordsForApi(await seoCtx(ctx, projectId), body);
      const text = res.results
        .map((r) =>
          r.ok
            ? `## "${r.seed}" — ${r.rowCount} keywords (source: ${r.source}${r.usedFallback ? ", fallback" : ""}, ${r.location})${cachedNote(r.cached)}\n\n${mdTable(r.rows, [
                ["keyword", (x) => x.keyword],
                ["volume", (x) => x.searchVolume],
                ["KD", (x) => x.keywordDifficulty],
                ["CPC", (x) => (x.cpc == null ? null : `$${x.cpc.toFixed(2)}`)],
                ["competition", (x) => x.competition],
                ["intent", (x) => x.intent],
              ], 40)}`
            : `## "${r.seed}" — failed: ${r.error}`,
        )
        .join("\n\n");
      return { text: `${text}\n\nKD = keyword difficulty 0–100, competition = paid competition 0–1.`, data: res };
    },
  }),

  defineTool({
    name: "get_keyword_metrics",
    title: "Keyword metrics",
    description:
      "Search volume, keyword difficulty, CPC, competition, intent and 12-month trend for up to 700 known keywords (DataForSEO Labs keyword overview; Google Ads search volume for Ads-only countries — no KD/intent there). Uses DataForSEO credits (~$0.01 + $0.0001 per keyword per 700-keyword batch; $0.075 per batch for Ads countries). Not cached; needs the seo.run permission.",
    input: keywordMetricsBody.extend({ projectId: projectIdInput }),
    scope: "read",
    annotations: PAID,
    async handler(args, ctx) {
      const { projectId, ...body } = args;
      const res = await keywordMetricsForApi(await seoCtx(ctx, projectId), body);
      return {
        text: `${res.keywords.length} of ${res.requested} keywords with data — ${res.location} (${res.provider === "google_ads" ? "Google Ads data" : "DataForSEO Labs"})\n\n${mdTable(res.keywords, [
          ["keyword", (x) => x.keyword],
          ["volume", (x) => x.searchVolume],
          ["KD", (x) => x.keywordDifficulty],
          ["CPC", (x) => (x.cpc == null ? null : `$${x.cpc.toFixed(2)}`)],
          ["competition", (x) => x.competition],
          ["intent", (x) => x.intent],
        ], 100)}`,
        data: res,
      };
    },
  }),

  defineTool({
    name: "list_saved_keywords",
    title: "List saved keywords",
    description:
      "Keywords saved to the project (Saved Keywords list) with their latest metrics and tags. Filter by text, tags (ANY match), volume and difficulty; sort and paginate. Free (database only). Returns row ids for remove_saved_keywords / tag_saved_keywords.",
    input: listSavedKeywordsBody.extend({ projectId: projectIdInput }),
    scope: "read",
    annotations: FREE_RO,
    async handler(args, ctx) {
      const { projectId, ...q } = args;
      const res = await listSavedKeywordsForApi(await seoCtx(ctx, projectId), q);
      return {
        text: `${res.totalCount} saved keyword(s), page ${res.pagination.page}/${res.pagination.totalPages}. Tags: ${res.tags.map((t) => `${t.name} (${t.keywordCount})`).join(", ") || "none"}\n\n${mdTable(res.rows, [
          ["id", (x) => x.id],
          ["keyword", (x) => x.keyword],
          ["volume", (x) => x.searchVolume],
          ["KD", (x) => x.keywordDifficulty],
          ["CPC", (x) => (x.cpc == null ? null : `$${x.cpc.toFixed(2)}`)],
          ["intent", (x) => x.intent],
          ["tags", (x) => x.tags],
        ], 100)}`,
        data: res,
      };
    },
  }),

  defineTool({
    name: "save_keywords",
    title: "Save keywords",
    description:
      "Saves keywords to the project's Saved Keywords list (idempotent — existing ones are kept), optionally with metrics you already have (e.g. from research_keywords) and tags (append or replace; missing tags are created). No DataForSEO call. Requires write scope and the seo.run permission.",
    input: z.object({
      projectId: projectIdInput,
      keywords: z.array(z.string().min(1).max(200)).min(1).max(500),
      locationCode: z.number().int().positive().optional(),
      languageCode: z.string().min(2).max(8).optional(),
      tags: z.array(z.string().min(1).max(64)).max(20).optional(),
      tagMode: z.enum(["append", "replace"]).default("append").describe("replace requires tags."),
      metrics: z
        .array(
          z.object({
            keyword: z.string().min(1).max(200),
            searchVolume: z.number().nullable().optional(),
            cpc: z.number().nullable().optional(),
            competition: z.number().nullable().optional(),
            keywordDifficulty: z.number().nullable().optional(),
            intent: z.string().nullable().optional(),
          }),
        )
        .max(500)
        .optional()
        .describe("Known metrics to store alongside the keywords."),
    }),
    scope: "write",
    permission: "seo.run",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async handler(args, ctx) {
      const { projectId, ...body } = args;
      const res = await saveKeywordsForApi(await seoCtx(ctx, projectId), saveKeywordsBody.parse(body));
      return {
        text: `Saved ${res.savedCount} keyword(s)${res.tags.length ? ` with tags ${res.tags.join(", ")} (${res.tagMode})` : ""}.\n${res.url}`,
        data: res,
      };
    },
  }),

  defineTool({
    name: "remove_saved_keywords",
    title: "Remove saved keywords",
    description:
      "Deletes saved keywords by row id (from list_saved_keywords). Unknown or foreign ids are ignored. Does not affect rank tracking. Requires write scope and the seo.run permission.",
    input: removeSavedKeywordsBody.extend({ projectId: projectIdInput }),
    scope: "write",
    permission: "seo.run",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    async handler(args, ctx) {
      const { projectId, ...body } = args;
      const res = await removeSavedKeywordsForApi(await seoCtx(ctx, projectId), body);
      return { text: `Removed ${res.deletedCount} of ${res.requested} saved keyword(s).`, data: res };
    },
  }),

  defineTool({
    name: "tag_saved_keywords",
    title: "Tag saved keywords",
    description:
      "Adds tags (created if missing) to and/or removes tags (by tag id) from saved keywords. Tag ids are listed by list_saved_keywords. Requires write scope and the seo.run permission.",
    input: z.object({
      projectId: projectIdInput,
      savedKeywordIds: z.array(z.string().min(1)).min(1).max(2000),
      addTags: z.array(z.string().min(1).max(64)).max(20).optional(),
      removeTagIds: z.array(z.string()).max(50).optional(),
    }),
    scope: "write",
    permission: "seo.run",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    async handler(args, ctx) {
      const { projectId, ...body } = args;
      const res = await tagSavedKeywordsForApi(await seoCtx(ctx, projectId), tagSavedKeywordsBody.parse(body));
      return {
        text: `Updated tags on ${res.taggedCount} keyword(s)${res.addedTags.length ? ` — added ${res.addedTags.map((t) => t.name).join(", ")}` : ""}${res.removedAssignments ? `, removed ${res.removedAssignments} assignment(s)` : ""}.`,
        data: res,
      };
    },
  }),

  defineTool({
    name: "get_serp_results",
    title: "Google SERP results",
    description:
      "Live Google organic results (desktop) for 1–10 keywords: rank, title, URL, domain and snippet per result. Uses DataForSEO credits (~$0.002–0.004 per keyword at depth 20, more at depth 100); cached 12h. Needs the seo.run permission unless cached. One failing keyword does not fail the batch.",
    input: serpResultsBody.extend({ projectId: projectIdInput }),
    scope: "read",
    annotations: PAID,
    async handler(args, ctx) {
      const { projectId, ...body } = args;
      const res = await serpResultsForApi(await seoCtx(ctx, projectId), body);
      const text = res.results
        .map((r) =>
          r.ok
            ? `## "${r.keyword}" — ${r.items.length} results${cachedNote(r.cached)}${r.reason ? ` (${r.reason})` : ""}\n\n${mdTable(r.items, [
                ["rank", (x) => x.rank],
                ["domain", (x) => x.domain],
                ["title", (x) => x.title],
                ["url", (x) => x.url],
              ], 100)}`
            : `## "${r.keyword}" — failed: ${r.error}`,
        )
        .join("\n\n");
      return { text, data: res };
    },
  }),

  defineTool({
    name: "search_serp_locations",
    title: "Search SERP locations",
    description:
      "Finds DataForSEO sub-country locations (cities, counties, regions, DMAs) by place name within a country — use the returned locationCode for local keyword/SERP research or the exact locationName for create_rank_tracker. Free (cached registry), but needs DataForSEO configured on first use per country.",
    input: serpLocationsQuery.extend({ projectId: projectIdInput }),
    scope: "read",
    annotations: FREE_RO,
    async handler(args, ctx) {
      const project = args.projectId ? await getApiProject(ctx.principal, args.projectId) : (await accessibleProjects(ctx.principal))[0];
      if (!project) throw new ApiError("not_found", "This credential cannot access any project.");
      const res = await serpLocationsForApi({ projectId: project.id }, { query: args.query, countryCode: args.countryCode });
      return {
        text: `${res.locations.length} location(s) for "${args.query}" in ${args.countryCode.toUpperCase()}:\n\n${mdTable(res.locations, [
          ["locationCode", (x) => x.locationCode],
          ["locationName", (x) => x.locationName],
          ["type", (x) => x.locationType],
        ])}`,
        data: res,
      };
    },
  }),

  defineTool({
    name: "get_domain_overview",
    title: "Domain overview",
    description:
      "Organic search overview of a domain (default: the project domain): estimated organic traffic (ETV) and number of ranking keywords in a market (DataForSEO Labs; not available for Google-Ads-only countries). Uses DataForSEO credits (~$0.01); cached 12h. Needs the seo.run permission unless cached.",
    input: domainOverviewBody.extend({ projectId: projectIdInput }),
    scope: "read",
    annotations: PAID,
    async handler(args, ctx) {
      const { projectId, ...body } = args;
      const o = await domainOverviewForApi(await seoCtx(ctx, projectId), body);
      return {
        text: o.hasData
          ? `**${o.displayTarget}** (${o.location}) — ${o.organicKeywords?.toLocaleString("en-US") ?? "—"} ranking keywords, ~${o.organicTraffic?.toLocaleString("en-US", { maximumFractionDigits: 0 }) ?? "—"} monthly organic visits (ETV)${cachedNote(o.cached)}. ${o.note}\n${o.url}`
          : `No organic data for ${o.displayTarget} in ${o.location}.`,
        data: o,
      };
    },
  }),

  defineTool({
    name: "get_domain_keyword_suggestions",
    title: "Domain keyword suggestions",
    description:
      "Top 100 keywords a domain (default: the project domain) ranks for, by estimated traffic — good candidates for rank tracking. Uses DataForSEO credits (~$0.02); cached 12h. Needs the seo.run permission unless cached.",
    input: domainOverviewBody.extend({ projectId: projectIdInput }),
    scope: "read",
    annotations: PAID,
    async handler(args, ctx) {
      const { projectId, ...body } = args;
      const res = await domainKeywordSuggestionsForApi(await seoCtx(ctx, projectId), body);
      return {
        text: `${res.keywords.length} keyword(s) for ${res.domain}:\n\n${mdTable(res.keywords, [
          ["keyword", (x) => x.keyword],
          ["position", (x) => x.position],
          ["volume", (x) => x.searchVolume],
          ["traffic", (x) => x.traffic],
          ["KD", (x) => x.keywordDifficulty],
        ], 100)}`,
        data: res,
      };
    },
  }),

  defineTool({
    name: "get_ranked_keywords",
    title: "Ranked keywords",
    description:
      "Paginated keywords a domain/URL ranks for in Google (default: the project domain) with position, volume, estimated traffic, CPC, difficulty and ranking URL. Filter by volume, position, traffic, CPC, difficulty, include/exclude terms (e.g. exclude brand terms); sort by rank, traffic, volume, cpc or score. Uses DataForSEO credits (~$0.01 + $0.0001 per row); cached 12h per page. Needs the seo.run permission unless cached.",
    input: rankedKeywordsBody.extend({ projectId: projectIdInput }),
    scope: "read",
    annotations: PAID,
    async handler(args, ctx) {
      const { projectId, ...body } = args;
      const res = await rankedKeywordsForApi(await seoCtx(ctx, projectId), body);
      return {
        text: `${res.domain}: page ${res.page}, ${res.keywords.length} keyword(s) of ${res.totalCount ?? "?"}${res.hasMore ? " (more pages available)" : ""}${cachedNote(res.cached)}\n\n${mdTable(res.keywords, [
          ["keyword", (x) => x.keyword],
          ["rank", (x) => x.position],
          ["volume", (x) => x.searchVolume],
          ["traffic", (x) => x.traffic],
          ["CPC", (x) => (x.cpc == null ? null : `$${x.cpc.toFixed(2)}`)],
          ["KD", (x) => x.keywordDifficulty],
          ["url", (x) => x.relativeUrl ?? x.url],
        ], 100)}`,
        data: res,
      };
    },
  }),

  defineTool({
    name: "get_domain_top_pages",
    title: "Domain top pages",
    description:
      "Pages of a domain (default: the project domain) that earn the most organic traffic, with estimated traffic and ranking keyword count. Uses DataForSEO credits (~$0.01 + $0.0001 per row); cached 12h per page. Needs the seo.run permission unless cached.",
    input: domainTopPagesBody.extend({ projectId: projectIdInput }),
    scope: "read",
    annotations: PAID,
    async handler(args, ctx) {
      const { projectId, ...body } = args;
      const res = await domainTopPagesForApi(await seoCtx(ctx, projectId), body);
      return {
        text: `${res.domain}: ${res.pages.length} page(s) of ${res.totalCount ?? "?"}${cachedNote(res.cached)}\n\n${mdTable(res.pages, [
          ["page", (x) => x.relativePath ?? x.page],
          ["traffic", (x) => x.organicTraffic],
          ["keywords", (x) => x.keywords],
        ], 100)}`,
        data: res,
      };
    },
  }),

  defineTool({
    name: "find_serp_competitors",
    title: "Find SERP competitors",
    description:
      "Domains that compete in Google for a set of 1–100 keywords, with visibility, estimated traffic, average/median position and keyword count (DataForSEO Labs SERP competitors). Exclude domains and sort by visibility, traffic_estimate, avg_position or keyword_count. Uses DataForSEO credits (~$0.01 + $0.0001 per row); not cached; needs the seo.run permission.",
    input: serpCompetitorsBody.extend({ projectId: projectIdInput }),
    scope: "read",
    annotations: PAID,
    async handler(args, ctx) {
      const { projectId, ...body } = args;
      const res = await serpCompetitorsForApi(await seoCtx(ctx, projectId), body);
      return {
        text: `${res.competitors.length} competitor domain(s) for ${res.keywords} keyword(s):\n\n${mdTable(res.competitors, [
          ["domain", (x) => x.domain],
          ["keywords", (x) => x.keywordsCount],
          ["avg pos", (x) => x.avgPosition],
          ["median pos", (x) => x.medianPosition],
          ["visibility", (x) => x.visibility],
          ["etv", (x) => x.etv],
        ], 100)}`,
        data: res,
      };
    },
  }),

  defineTool({
    name: "get_backlinks_overview",
    title: "Backlinks overview",
    description:
      "Backlink profile summary of a domain or page (default: the project domain): backlinks, referring domains/pages, rank, broken links, spam score, new/lost and 1-year trends, plus the top 100 referring domains (unless includeReferringDomains=false or subfolder scope). Uses DataForSEO credits (~$0.04 summary + ~$0.02 referring domains); cached 6h. Needs the seo.run permission unless cached (and the Backlinks API enabled on the DataForSEO account).",
    input: backlinksOverviewBody.extend({ projectId: projectIdInput }),
    scope: "read",
    annotations: PAID,
    async handler(args, ctx) {
      const { projectId, ...body } = args;
      const o = await backlinksOverviewForApi(await seoCtx(ctx, projectId), body);
      const s = o.summary;
      const fmt = (v: number | null) => (v == null ? "—" : v.toLocaleString("en-US"));
      return {
        text: [
          `**${o.displayTarget}** (${o.scope})${cachedNote(o.cached)}`,
          `- Backlinks: ${fmt(s.backlinks)} · referring domains: ${fmt(s.referringDomains)} · referring pages: ${fmt(s.referringPages)}`,
          `- Rank: ${fmt(s.rank)} · broken backlinks: ${fmt(s.brokenBacklinks)} · spam score: ${fmt(s.targetSpamScore ?? s.backlinksSpamScore)}`,
          `- New / lost backlinks: ${fmt(s.newBacklinks)} / ${fmt(s.lostBacklinks)}`,
          o.scopeNote ? `\n_${o.scopeNote}_` : "",
          o.referringDomains
            ? `\nTop referring domains:\n\n${mdTable(o.referringDomains.rows, [
                ["domain", (x) => x.domain],
                ["backlinks", (x) => x.backlinks],
                ["referring pages", (x) => x.referringPages],
                ["rank", (x) => x.rank],
              ], 30)}`
            : "",
          o.url,
        ].join("\n"),
        data: o,
      };
    },
  }),

  defineTool({
    name: "get_backlinks_profile",
    title: "Backlinks list",
    description:
      "Paginated backlinks pointing to a domain or page (default: the project domain): source URL, target URL, anchor, dofollow/nofollow, rank, domain rank, spam score, first seen, lost/broken status. Filters for rank, spam, link type, lost/broken and referring domain; one link per domain by default. Uses DataForSEO credits (~$0.023 per page); cached 6h. Needs the seo.run permission unless cached.",
    input: backlinksProfileBody.extend({ projectId: projectIdInput }),
    scope: "read",
    annotations: PAID,
    async handler(args, ctx) {
      const { projectId, ...body } = args;
      const res = await backlinksProfileForApi(await seoCtx(ctx, projectId), body);
      const b = res.backlinks;
      return {
        text: `${res.target}: page ${b.page}, ${b.rows.length} backlink(s) of ${b.totalCount ?? "?"}${cachedNote(res.cached)}\n\n${mdTable(b.rows, [
          ["source", (x) => x.urlFrom],
          ["target", (x) => x.urlTo],
          ["anchor", (x) => x.anchor],
          ["type", (x) => (x.isDofollow == null ? null : x.isDofollow ? "dofollow" : "nofollow")],
          ["rank", (x) => x.rank],
          ["domain rank", (x) => x.domainFromRank],
          ["spam", (x) => x.spamScore],
          ["status", (x) => (x.isBroken ? "broken" : x.isLost ? "lost" : "live")],
        ], 100)}`,
        data: res,
      };
    },
  }),

  defineTool({
    name: "get_referring_domains",
    title: "Referring domains",
    description:
      "Paginated referring domains of a domain or page (default: the project domain) with backlinks, referring pages, rank, spam score and first seen. Not available for subfolder scope. Uses DataForSEO credits (~$0.023 per page); cached 6h. Needs the seo.run permission unless cached.",
    input: referringDomainsBody.extend({ projectId: projectIdInput }),
    scope: "read",
    annotations: PAID,
    async handler(args, ctx) {
      const { projectId, ...body } = args;
      const res = await referringDomainsForApi(await seoCtx(ctx, projectId), body);
      const r = res.referringDomains;
      return {
        text: `${res.target}: ${r.rows.length} referring domain(s) of ${r.totalCount ?? "?"}${cachedNote(res.cached)}\n\n${mdTable(r.rows, [
          ["domain", (x) => x.domain],
          ["backlinks", (x) => x.backlinks],
          ["referring pages", (x) => x.referringPages],
          ["rank", (x) => x.rank],
          ["spam", (x) => x.spamScore],
          ["first seen", (x) => x.firstSeen],
        ], 100)}`,
        data: res,
      };
    },
  }),

  defineTool({
    name: "get_backlinks_top_pages",
    title: "Most linked pages",
    description:
      "Pages of a domain (default: the project domain) with the most backlinks and referring domains. Uses DataForSEO credits (~$0.023 per page); cached 6h. Needs the seo.run permission unless cached.",
    input: backlinksTopPagesBody.extend({ projectId: projectIdInput }),
    scope: "read",
    annotations: PAID,
    async handler(args, ctx) {
      const { projectId, ...body } = args;
      const res = await backlinksTopPagesForApi(await seoCtx(ctx, projectId), body);
      const p = res.pages;
      return {
        text: `${res.target}: ${p.rows.length} page(s) of ${p.totalCount ?? "?"}${cachedNote(res.cached)}\n\n${mdTable(p.rows, [
          ["page", (x) => x.page],
          ["backlinks", (x) => x.backlinks],
          ["referring domains", (x) => x.referringDomains],
          ["rank", (x) => x.rank],
          ["broken", (x) => x.brokenBacklinks],
        ], 100)}`,
        data: res,
      };
    },
  }),
];
