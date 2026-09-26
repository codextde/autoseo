import "server-only";
import { z } from "zod";
import {
  aiFilterShape,
  buildAiScope,
  getAnswerContent,
  getCompetitorGapAnalysis,
  getCompetitorH2H,
  getCompetitorRanking,
  getPromptDetails,
  getQueryFanouts,
  getSentiment,
  getTags,
  getTopSources,
  getVisibilityMetrics,
  getVisibilityTimeseries,
  listPromptsWithMetrics,
} from "@/server/api/ai-data";
import { addPromptsToProject } from "@/server/api/prompts";
import { METRIC_KEYS, type MetricKey } from "@/features/ai-insights/lib/metrics";
import { defineTool } from "../types";
import { mdTable, pct, projectIdInput, signed, toolProject } from "../helpers";

const filters = { projectId: projectIdInput, ...aiFilterShape };
const RO = { readOnlyHint: true, openWorldHint: false } as const;
const periodLine = (p: { from: string; to: string; days: number }) => `Period ${p.from} → ${p.to} (${p.days} days)`;

/** finseo MCP tools — AI visibility (GEO) data. All read-only. */
export const aiVisibilityTools = [
  defineTool({
    name: "get_visibility_metrics",
    title: "AI visibility metrics",
    description:
      "Headline AI visibility KPIs for a project over a period, with the previous period and changes: visibility, mention rate, citation rate, average position, mention depth, sentiment and share of voice. Filter by model (AI engine) and prompt tags.",
    input: z.object(filters),
    scope: "read",
    annotations: RO,
    async handler(args, ctx) {
      const s = await buildAiScope(await toolProject(ctx, args.projectId), args);
      const m = await getVisibilityMetrics(s);
      const c = m.current;
      const ch = m.changes as Record<string, number | null>;
      return {
        text: [
          `**${s.project.name}** — ${periodLine(m.period)}${s.engines.length ? `, models: ${s.engines.join(", ")}` : ""}`,
          `- Visibility: ${pct(c.visibility)}${signed(ch.visibility, " pts")}`,
          `- Mention rate: ${pct(c.mentionRate)}${signed(ch.mentionRate, " pts")}`,
          `- Citation rate: ${pct(c.citationRate)}${signed(ch.citationRate, " pts")}`,
          `- Avg position: ${c.avgPosition ?? "—"}${signed(ch.avgPosition)}`,
          `- Sentiment: ${c.sentiment ?? "—"}${signed(ch.sentiment)}`,
          `- Share of voice: ${pct(c.shareOfVoice)}${signed(ch.shareOfVoice, " pts")}`,
          `- ${c.answers} answers across ${c.prompts} prompts`,
          c.answers === 0 ? "\nNo tracked answers in this period yet — prompts are answered on the tracking schedule." : "",
        ].join("\n"),
        data: { projectId: s.project.id, ...m },
      };
    },
  }),

  defineTool({
    name: "get_visibility_timeseries",
    title: "AI visibility over time",
    description: "Daily AI visibility series (visibility, mention rate, citation rate, position, sentiment and the mentioned/cited mix) for trend analysis.",
    input: z.object(filters),
    scope: "read",
    annotations: RO,
    async handler(args, ctx) {
      const s = await buildAiScope(await toolProject(ctx, args.projectId), args);
      const t = await getVisibilityTimeseries(s);
      const withData = t.series.filter((p) => p.answers > 0);
      return {
        text: `${periodLine(t.period)} — ${withData.length} day(s) with data.\n\n${mdTable(withData, [
          ["date", (r) => r.date],
          ["answers", (r) => r.answers],
          ["visibility %", (r) => r.visibility],
          ["mention %", (r) => r.mentionRate],
          ["citation %", (r) => r.citationRate],
          ["position", (r) => r.avgPosition],
          ["sentiment", (r) => r.sentiment],
        ], 120)}`,
        data: { projectId: s.project.id, ...t },
      };
    },
  }),

  defineTool({
    name: "list_prompts",
    title: "List tracked prompts",
    description:
      "Tracked prompts with their AI visibility metrics for the period: isVisible, visibility, total mentions, mention rate, own-domain citations, citation rate, sentiment and position. Supports search, status, pagination and model/tag filters.",
    input: z.object({
      ...filters,
      search: z.string().max(200).optional().describe("Case-insensitive text search."),
      status: z.enum(["active", "archived", "all"]).optional().describe("Default active."),
      page: z.number().int().min(1).max(1000).optional(),
      limit: z.number().int().min(1).max(200).optional().describe("Default 50."),
    }),
    scope: "read",
    annotations: RO,
    async handler(args, ctx) {
      const s = await buildAiScope(await toolProject(ctx, args.projectId), args);
      const res = await listPromptsWithMetrics(s, { search: args.search, status: args.status, page: args.page ?? 1, limit: args.limit ?? 50 });
      return {
        text: `${res.pagination.total} prompt(s), page ${res.pagination.page}/${res.pagination.totalPages} — ${periodLine(res.period)}\n\n${mdTable(res.items, [
          ["id", (r) => r.id],
          ["prompt", (r) => r.text],
          ["visible", (r) => r.metrics.isVisible],
          ["visibility %", (r) => r.metrics.visibility],
          ["mentions", (r) => r.metrics.totalMentions],
          ["citation %", (r) => r.metrics.citationRate],
          ["sentiment", (r) => r.metrics.sentiment],
          ["tags", (r) => r.tags.map((t) => t.name)],
        ])}`,
        data: { projectId: s.project.id, ...res },
      };
    },
  }),

  defineTool({
    name: "get_prompt_details",
    title: "Prompt details",
    description: "Detailed metrics of one tracked prompt: per-model visibility, competitors named, and recent answers (use get_answer_content to read an answer).",
    input: z.object({ ...filters, promptId: z.string().max(64).describe("Prompt id from list_prompts.") }),
    scope: "read",
    annotations: RO,
    async handler(args, ctx) {
      const s = await buildAiScope(await toolProject(ctx, args.projectId), args);
      const d = await getPromptDetails(s, args.promptId);
      return {
        text: `**"${d.prompt.text}"** (${d.prompt.country}) — visibility ${pct(d.metrics.visibility)}, ${d.metrics.totalMentions} mentions, citation rate ${pct(d.metrics.citationRate)}\n\n${mdTable(d.byModel, [
          ["model", (r) => r.model],
          ["answers", (r) => r.answers],
          ["visibility %", (r) => r.visibility],
          ["mentioned", (r) => r.mentioned],
          ["cited", (r) => r.cited],
          ["position", (r) => r.avgPosition],
          ["latest answer", (r) => r.latest?.answerId],
        ])}\n\nCompetitors named: ${d.competitorsMentioned.map((c) => `${c.name} (${c.mentions})`).join(", ") || "none"}`,
        data: { projectId: s.project.id, ...d },
      };
    },
  }),

  defineTool({
    name: "get_answer_content",
    title: "Read an AI answer",
    description:
      "Full text of one AI answer with brands mentioned, cited sources, fan-out queries, products and sentiment statements. Pass answerId, or promptId (+ optional model and date YYYY-MM-DD) for the latest matching answer.",
    input: z.object({
      projectId: projectIdInput,
      answerId: z.string().max(64).optional(),
      promptId: z.string().max(64).optional(),
      model: z.string().max(40).optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      maxChars: z.number().int().min(500).max(100000).optional().describe("Truncate answer text (default 20000)."),
    }),
    scope: "read",
    annotations: RO,
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const a = await getAnswerContent(p, args);
      return {
        text: `**${a.model}** answer for "${a.prompt}" (${a.date}, ${a.country}) — brand ${a.brandMentioned ? `mentioned (position ${a.position ?? "?"})` : "not mentioned"}${a.brandCited ? ", own domain cited" : ""}.\n\n${a.text}\n\n**Sources:** ${a.citations.map((c) => c.url).slice(0, 15).join(", ") || "none"}`,
        data: { projectId: p.id, ...a },
      };
    },
  }),

  defineTool({
    name: "get_competitor_ranking",
    title: "Competitor ranking",
    description:
      "Ranks the own brand and tracked competitors by an AI visibility metric (visibility, mentionRate, mentions, citationRate, citations, sentiment, avgPosition, mentionDepth, sov, firstShare, top3Share, citationShare), with changes vs the previous period and per-model visibility.",
    input: z.object({
      ...filters,
      sortBy: z.enum(METRIC_KEYS as [MetricKey, ...MetricKey[]]).optional().describe("Default visibility."),
      includeUntracked: z.boolean().optional().describe("Include auto-discovered brands not on My List."),
    }),
    scope: "read",
    annotations: RO,
    async handler(args, ctx) {
      const s = await buildAiScope(await toolProject(ctx, args.projectId), args);
      const r = await getCompetitorRanking(s, { sortBy: args.sortBy, includeUntracked: args.includeUntracked });
      return {
        text: `Ranking by ${r.sortBy} — ${periodLine(r.period)}, ${r.totals.answers} answers\n\n${mdTable(r.items, [
          ["#", (x) => x.rank],
          ["brand", (x) => (x.isOwnBrand ? `${x.name} (you)` : x.name)],
          ["id", (x) => x.competitorId],
          ["visibility %", (x) => x.metrics.visibility],
          ["mention %", (x) => x.metrics.mentionRate],
          ["mentions", (x) => x.metrics.mentions],
          ["citation %", (x) => x.metrics.citationRate],
          ["position", (x) => x.metrics.avgPosition],
          ["sentiment", (x) => x.metrics.sentiment],
          ["SoV %", (x) => x.metrics.sov],
        ])}`,
        data: { projectId: s.project.id, ...r },
      };
    },
  }),

  defineTool({
    name: "get_competitor_gap_analysis",
    title: "Competitor gap analysis",
    description:
      "Finds prompts where competitors are named by AI but your brand is not (content gaps), prompts where a competitor leads, and sources that cite the competitor but never you. Pass competitor (id, name or domain) for one competitor; omit for all competitors.",
    input: z.object({
      ...filters,
      competitor: z.string().max(200).optional().describe("Competitor id, name or domain."),
      limit: z.number().int().min(1).max(200).optional().describe("Default 50."),
    }),
    scope: "read",
    annotations: RO,
    async handler(args, ctx) {
      const s = await buildAiScope(await toolProject(ctx, args.projectId), args);
      const g = await getCompetitorGapAnalysis(s, args.competitor, args.limit ?? 50);
      return {
        text: `${g.competitor ? `Gaps vs **${g.competitor.name}**` : "Gaps vs all competitors"} — ${periodLine(g.period)}: ${g.summary.gapAnswers} of ${g.summary.answers} answers name ${g.competitor ? "them" : "a competitor"} but not you.\n\n${mdTable(g.promptGaps, [
          ["promptId", (r) => r.promptId],
          ["prompt", (r) => r.text],
          ["answers", (r) => r.answers],
          ["gap answers", (r) => r.gapAnswers],
          ["your mention %", (r) => r.yourMentionRate],
          ["competitors", (r) => r.competitors.slice(0, 3).map((c) => `${c.name} (${c.mentions})`)],
        ])}\n\nTop sources cited in gap answers:\n${mdTable(g.sourceGaps.slice(0, 10), [
          ["url", (r) => r.url],
          ["type", (r) => r.contentType],
          ["gap answers", (r) => r.gapAnswersCiting],
        ])}`,
        data: { projectId: s.project.id, ...g },
      };
    },
  }),

  defineTool({
    name: "get_competitor_h2h",
    title: "Head-to-head vs competitor",
    description:
      "Head-to-head comparison with one competitor: KPIs side by side, answers naming both (who is named first), AI comparison claims and sentiment of the competitor.",
    input: z.object({ ...filters, competitor: z.string().max(200).describe("Competitor id, name or domain.") }),
    scope: "read",
    annotations: RO,
    async handler(args, ctx) {
      const s = await buildAiScope(await toolProject(ctx, args.projectId), args);
      const h = await getCompetitorH2H(s, args.competitor);
      const hh = h.headToHead;
      return {
        text: `**${h.you.name} vs ${h.competitor.name}** — ${periodLine(h.period)}\nShared answers: ${hh.shared} · wins ${hh.wins} · losses ${hh.losses} · ties ${hh.ties}\n\n${mdTable(h.kpis, [
          ["metric", (k) => k.key],
          ["you", (k) => k.you],
          ["them", (k) => k.them],
          ["your change", (k) => k.youDelta],
          ["their change", (k) => k.themDelta],
        ])}`,
        data: { projectId: s.project.id, ...h },
      };
    },
  }),

  defineTool({
    name: "get_sentiment_overview",
    title: "Sentiment overview",
    description:
      "How AI talks about the brand: sentiment score (0–100), praise / neutral / criticism mix, top praised and criticised attributes, and the brand sentiment table vs competitors. Optionally compare with one competitor.",
    input: z.object({ ...filters, compareWith: z.string().max(200).optional().describe("Competitor id, name or domain to compare.") }),
    scope: "read",
    annotations: RO,
    async handler(args, ctx) {
      const s = await buildAiScope(await toolProject(ctx, args.projectId), args);
      const o = await getSentiment(s, args.compareWith);
      const y = o.you;
      return {
        text: `**${o.brand}** sentiment ${y.score ?? "—"}/100${signed(y.scoreDelta)} — praise ${y.praise}%, neutral ${y.neutral}%, criticism ${y.criticism}% (${y.statements} statements), ${periodLine(o.period)}\n\nTop praise: ${o.topPraise.map((p) => `${p.attribute} (${p.count})`).join(", ") || "—"}\nTop criticism: ${o.topCriticism.map((p) => `${p.attribute} (${p.count})`).join(", ") || "—"}`,
        data: { projectId: s.project.id, ...o },
      };
    },
  }),

  defineTool({
    name: "get_top_sources",
    title: "Top cited sources",
    description:
      "Most cited sources (URLs or domains) in AI answers for the project, with citation counts, change vs previous period, prompts, models, content type (listicle, buying-guide, test, ugc, article, reference, video, retail…) and ownership (own / competitor / third_party).",
    input: z.object({
      ...filters,
      groupBy: z.enum(["url", "domain"]).optional().describe("Default url."),
      contentType: z.string().max(40).optional(),
      ownership: z.enum(["own", "competitor", "third_party"]).optional(),
      search: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(200).optional().describe("Default 25."),
      page: z.number().int().min(1).max(1000).optional(),
    }),
    scope: "read",
    annotations: RO,
    async handler(args, ctx) {
      const s = await buildAiScope(await toolProject(ctx, args.projectId), args);
      const r = await getTopSources(s, {
        limit: args.limit ?? 25,
        page: args.page,
        contentType: args.contentType,
        ownership: args.ownership,
        search: args.search,
        domains: args.groupBy === "domain",
      });
      return {
        text: `${r.pagination.total} source(s) — ${periodLine(r.period)}\n\n${mdTable(r.items, [
          ["#", (x) => x.rank],
          [r.groupedBy === "domain" ? "domain" : "url", (x) => ("url" in x && x.url ? x.url : x.domain)],
          ["type", (x) => x.contentType],
          ["owner", (x) => x.ownership],
          ["citations", (x) => x.citations],
          ["change", (x) => x.citationsChange],
          ["prompts", (x) => x.prompts],
          ["models", (x) => x.models],
        ])}`,
        data: { projectId: s.project.id, ...r },
      };
    },
  }),

  defineTool({
    name: "get_tags",
    title: "Prompt tags",
    description: "Lists the project's prompt tags with prompt counts (use tag names or ids in the tags filter of other tools).",
    input: z.object({ projectId: projectIdInput }),
    scope: "read",
    annotations: RO,
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const tags = await getTags(p.id);
      return {
        text: `${tags.length} tag(s):\n\n${mdTable(tags, [
          ["id", (t) => t.id],
          ["name", (t) => t.name],
          ["prompts", (t) => t.promptCount],
        ])}`,
        data: { projectId: p.id, tags },
      };
    },
  }),

  defineTool({
    name: "get_query_fanouts",
    title: "Query fan-outs",
    description:
      "Search sub-queries AI engines ran while answering tracked prompts (query fan-out), with frequency, models and originating prompts. Great for finding content/keyword opportunities.",
    input: z.object({
      ...filters,
      search: z.string().max(200).optional(),
      promptId: z.string().max(64).optional().describe("Only fan-outs of one prompt."),
      limit: z.number().int().min(1).max(500).optional().describe("Default 50."),
      page: z.number().int().min(1).max(1000).optional(),
    }),
    scope: "read",
    annotations: RO,
    async handler(args, ctx) {
      const s = await buildAiScope(await toolProject(ctx, args.projectId), args, 90);
      const r = await getQueryFanouts(s, { search: args.search, promptId: args.promptId, limit: args.limit ?? 50, page: args.page });
      return {
        text: `${r.pagination.total} fan-out quer${r.pagination.total === 1 ? "y" : "ies"} — ${periodLine(r.period)}\n\n${mdTable(r.items, [
          ["query", (x) => x.query],
          ["frequency", (x) => x.frequency],
          ["models", (x) => x.models],
          ["prompts", (x) => x.promptCount],
          ["last seen", (x) => x.lastSeen],
        ])}`,
        data: { projectId: s.project.id, ...r },
      };
    },
  }),

  defineTool({
    name: "add_prompts",
    title: "Add tracked prompts",
    description:
      "Adds prompts (questions people ask AI) to AI visibility tracking, optionally tagged and for a specific market. Duplicates are skipped; the project's prompt limit applies. By default a first tracking run starts right away.",
    input: z.object({
      projectId: projectIdInput,
      prompts: z.array(z.string().trim().min(3).max(2000)).min(1).max(100),
      tags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
      country: z.string().length(2).optional().describe("ISO market, default project market."),
      models: z.array(z.string()).max(11).optional().describe("Restrict to these AI models (default: project models)."),
      runNow: z.boolean().optional().describe("Start a tracking run for the new prompts (default true)."),
    }),
    scope: "write",
    permission: "prompts.manage",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const r = await addPromptsToProject(p, {
        prompts: args.prompts.map((text) => ({ text, country: args.country, tags: args.tags })),
        models: args.models,
        runNow: args.runNow ?? true,
        userId: ctx.principal.user.id,
      });
      return {
        text: `Added ${r.created.length} prompt(s)${r.duplicates ? `, ${r.duplicates} duplicate(s) skipped` : ""}${r.skippedOverLimit ? `, ${r.skippedOverLimit} over the prompt limit` : ""}.${r.run ? ` Tracking run ${r.run.runId} started (${r.run.tasks} tasks).` : ""}`,
        data: { projectId: p.id, ...r },
      };
    },
  }),
];
