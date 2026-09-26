import "server-only";
import { z } from "zod";
import { CONTENT_STATUSES, TASK_STATUSES } from "@/server/db/schema";
import { attributionSummaryForApi, listAttributionsForApi } from "@/server/api/attribution";
import {
  commentOnTask,
  factCheckOverview,
  generateContentForApi,
  generateContentInput,
  getContentForApi,
  listContentForApi,
  listFindings,
  optimizeUrlForApi,
  optimizeUrlInput,
  runFactCheckForApi,
  updateTaskStatus,
} from "@/server/api/optimize";
import { FINDING_VERDICTS } from "@/features/optimize/fact-check/queries";
import { defineTool } from "../types";
import { mdTable, pct, projectIdInput, toolProject } from "../helpers";

const RO = { readOnlyHint: true, openWorldHint: false } as const;
const AI_JOB = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const;

/** Tool args minus the project selector (service inputs don't take it). */
function withoutProject<T extends { projectId?: string }>(args: T): Omit<T, "projectId"> {
  const rest: Partial<T> = { ...args };
  delete rest.projectId;
  return rest as Omit<T, "projectId">;
}

const money = (v: number, c: string) => `${Math.round(v).toLocaleString("en-US")} ${c}`;

/** Optimize module (tasks, content, fact check) + attribution. */
export const optimizeTools = [
  /* ───────────── Attribution ───────────── */
  defineTool({
    name: "get_attribution_summary",
    title: "Attribution summary",
    description:
      "Self-reported attribution (\"How did you hear about us?\") for a period: responses, AI search share, deal value from AI search vs other channels, breakdown by channel and AI assistant (ChatGPT, Perplexity…), daily series and matched conversions, with the previous period.",
    input: z.object({
      projectId: projectIdInput,
      timeframeDays: z.number().int().min(1).max(730).optional().describe("Look-back window ending today (default 30)."),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }),
    scope: "read",
    annotations: RO,
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const s = await attributionSummaryForApi(p.id, {
        timeframe: args.timeframeDays ? `${args.timeframeDays}d` : undefined,
        startDate: args.startDate,
        endDate: args.endDate,
      });
      return {
        text: `Attribution ${s.from.slice(0, 10)} → ${s.to.slice(0, 10)}: ${s.responses} responses, ${s.aiResponses} from AI search (${pct(s.aiShare)}), deal value ${money(s.dealValue, s.currency)} of which AI search ${money(s.aiDealValue, s.currency)} (${pct(s.aiDealShare)}). Previous period: ${s.previous.responses} responses, ${s.previous.aiResponses} AI.\n\n${mdTable(s.byChannel, [
          ["channel", (c) => c.label],
          ["responses", (c) => c.responses],
          ["deal value", (c) => Math.round(c.dealValue)],
        ])}\n\nAI assistants:\n${mdTable(s.byAiDetail, [
          ["assistant", (c) => c.label],
          ["responses", (c) => c.responses],
          ["deal value", (c) => Math.round(c.dealValue)],
        ])}`,
        data: { projectId: p.id, ...s, url: `${ctx.baseUrl}/p/${p.id}/attribution` },
      };
    },
  }),

  defineTool({
    name: "list_attributions",
    title: "List attribution responses",
    description: "Individual attribution responses (channel, AI assistant, form, masked contact, deal value, matched conversion), newest first.",
    input: z.object({
      projectId: projectIdInput,
      channel: z.string().max(40).optional().describe("ai_search, other, a channel id (search, social, ads, referral, content, other) or all."),
      from: z.string().max(40).optional().describe("ISO date (inclusive)."),
      to: z.string().max(40).optional().describe("ISO date (inclusive)."),
      search: z.string().max(200).optional(),
      status: z.enum(["active", "dismissed", "all"]).optional(),
      page: z.number().int().min(1).max(10_000).optional(),
      limit: z.number().int().min(1).max(500).optional().describe("Default 50."),
    }),
    scope: "read",
    annotations: RO,
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const r = await listAttributionsForApi(p.id, {
        channel: args.channel,
        from: args.from,
        to: args.to,
        search: args.search,
        status: args.status ?? "active",
        page: args.page ?? 1,
        limit: args.limit ?? 50,
      });
      return {
        text: `${r.pagination.total} response(s), page ${r.pagination.page}/${r.pagination.totalPages}\n\n${mdTable(r.items, [
          ["date", (a) => a.respondedAt.slice(0, 10)],
          ["channel", (a) => a.channelDetailLabel ? `${a.channelLabel} · ${a.channelDetailLabel}` : a.channelLabel],
          ["source", (a) => a.formName ?? a.provider],
          ["contact", (a) => a.contact.emailMask ?? a.contact.externalId],
          ["deal", (a) => (a.dealValue != null ? `${a.dealValue} ${a.dealCurrency ?? ""}`.trim() : null)],
        ])}`,
        data: { projectId: p.id, ...r },
      };
    },
  }),

  /* ───────────── Tasks (writes) ───────────── */
  defineTool({
    name: "update_task_status",
    title: "Update task status",
    description: "Sets the status of one or more optimization tasks (open, in_progress, done, dismissed). Connected PM tools / webhooks are notified.",
    input: z.object({
      projectId: projectIdInput,
      taskIds: z.array(z.string().max(64)).min(1).max(500).describe("Task ids from list_tasks."),
      status: z.enum(TASK_STATUSES),
    }),
    scope: "write",
    permission: "prompts.manage",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const r = await updateTaskStatus(ctx.principal, p, args.taskIds, args.status);
      return { text: `${r.changed} task(s) set to ${r.status}${r.changed < args.taskIds.length ? ` (${args.taskIds.length - r.changed} unchanged or not found)` : ""}.`, data: { projectId: p.id, ...r } };
    },
  }),

  defineTool({
    name: "comment_on_task",
    title: "Comment on task",
    description: "Adds a comment (e.g. findings, what was changed, links) to an optimization task's activity log.",
    input: z.object({ projectId: projectIdInput, taskId: z.string().max(64), body: z.string().trim().min(1).max(5000) }),
    scope: "write",
    permission: "prompts.manage",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const r = await commentOnTask(ctx.principal, p, args.taskId, args.body);
      return { text: `Comment added to task ${args.taskId}.`, data: { projectId: p.id, ...r, url: `${ctx.baseUrl}/p/${p.id}/tasks/${args.taskId}` } };
    },
  }),

  /* ───────────── Content ───────────── */
  defineTool({
    name: "list_content",
    title: "List content",
    description: "AI-optimized content pieces (articles and page rewrites) with status, target prompt/keyword and AEO score (0–100), plus a summary (average score, published, in review, drafts).",
    input: z.object({
      projectId: projectIdInput,
      status: z.enum(CONTENT_STATUSES).optional(),
      kind: z.enum(["article", "rewrite"]).optional(),
      search: z.string().max(200).optional(),
      page: z.number().int().min(1).max(1000).optional(),
      limit: z.number().int().min(1).max(200).optional().describe("Default 50."),
    }),
    scope: "read",
    annotations: RO,
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const r = await listContentForApi(p, { status: args.status, kind: args.kind, search: args.search, page: args.page ?? 1, limit: args.limit ?? 50 });
      return {
        text: `${r.summary.total} content piece(s), avg AEO score ${r.summary.avgScore ?? "—"}, ${r.summary.published} published, ${r.summary.inReview} in review, ${r.summary.drafts} drafts.\n\n${mdTable(r.items, [
          ["id", (c) => c.id],
          ["title", (c) => c.title],
          ["kind", (c) => c.kind],
          ["status", (c) => c.status],
          ["score", (c) => c.aeoScore],
          ["words", (c) => c.wordCount],
        ])}`,
        data: { projectId: p.id, ...r, url: `${ctx.baseUrl}/p/${p.id}/content` },
      };
    },
  }),

  defineTool({
    name: "get_content",
    title: "Get content",
    description: "One content piece with markdown body, meta title/description, slug, FAQs, entities, citations, JSON-LD and AEO score.",
    input: z.object({ projectId: projectIdInput, contentId: z.string().max(64), maxBodyChars: z.number().int().min(500).max(400_000).optional() }),
    scope: "read",
    annotations: RO,
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const c = await getContentForApi(p, args.contentId, { maxBodyChars: args.maxBodyChars });
      return {
        text: `**${c.title}** — ${c.status}${c.generationStage && c.status === "generating" ? ` (${c.generationStage})` : ""}, AEO score ${c.aeoScore ?? "—"}, ${c.wordCount} words${c.error ? `, error: ${c.error}` : ""}\n\n${c.body}`,
        data: { projectId: p.id, content: c, url: `${ctx.baseUrl}/p/${p.id}/content/${c.id}` },
      };
    },
  }),

  defineTool({
    name: "generate_content",
    title: "Generate content",
    description:
      "Writes a new AI-search-optimized article (brief → draft with FAQ, meta, JSON-LD) for a target prompt/topic using the local agent / AI API. Runs in the background (a few minutes) — poll get_content with the returned contentId.",
    input: z.object({ projectId: projectIdInput, ...generateContentInput.shape }),
    scope: "write",
    permission: "prompts.manage",
    annotations: AI_JOB,
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const r = await generateContentForApi(ctx.principal, p, withoutProject(args));
      return { text: `Generating content ${r.contentId}. Poll get_content for the draft.`, data: { projectId: p.id, ...r, url: `${ctx.baseUrl}/p/${p.id}/content/${r.contentId}` } };
    },
  }),

  defineTool({
    name: "optimize_page_content",
    title: "Optimize an existing page",
    description:
      "Imports a public page URL, scores it for AI answers (AEO score) and — with AI available — rewrites it into an optimized draft (the live page is not changed). Runs in the background — poll get_content with the returned contentId.",
    input: z.object({ projectId: projectIdInput, ...optimizeUrlInput.shape }),
    scope: "write",
    permission: "prompts.manage",
    annotations: AI_JOB,
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const r = await optimizeUrlForApi(ctx.principal, p, withoutProject(args));
      return {
        text: `Importing${r.rewrite ? " and rewriting" : ""} the page as content ${r.contentId}. Poll get_content for the result.`,
        data: { projectId: p.id, ...r, url: `${ctx.baseUrl}/p/${p.id}/content/${r.contentId}` },
      };
    },
  }),

  /* ───────────── Fact check ───────────── */
  defineTool({
    name: "get_fact_check_overview",
    title: "Fact check overview",
    description:
      "Ground-truth fact check: how many AI statements about your products/assets match the reference documents (label alignment), deviations by type (off-label, contradicted, unsupported, outdated), per-asset status and the last run.",
    input: z.object({ projectId: projectIdInput }),
    scope: "read",
    annotations: RO,
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const o = await factCheckOverview(p);
      const t = o.totals;
      const matchRate = t.checked ? (t.matched / t.checked) * 100 : null;
      return {
        text: `Label alignment ${pct(matchRate)} (${t.matched}/${t.checked} checked, ${t.pending} pending) — off-label ${t.off_label}, contradicted ${t.contradicted}, unsupported ${t.unsupported}, outdated ${t.outdated}, needs review ${t.needs_review}.${o.aiReady ? "" : " AI provider not available — only lexical checks run."}\n\n${mdTable(o.assets, [
          ["id", (a) => a.id],
          ["asset", (a) => a.name],
          ["markets", (a) => a.markets.map((m) => m.country)],
          ["docs", (a) => `${a.docsReady}/${a.docs}`],
          ["open findings", (a) => a.openFindings],
          ["critical", (a) => a.criticalFindings],
        ])}`,
        data: { projectId: p.id, ...o, matchRate, url: `${ctx.baseUrl}/p/${p.id}/fact-check` },
      };
    },
  }),

  defineTool({
    name: "list_fact_check_findings",
    title: "Fact check findings",
    description: "AI statements that deviate from the reference documents (claim, verdict, severity, model, market, label quote, explanation), with KPIs.",
    input: z.object({
      projectId: projectIdInput,
      status: z.enum(["open", "resolved", "ignored", "all"]).optional().describe("Default open."),
      verdict: z.array(z.enum(FINDING_VERDICTS)).max(5).optional(),
      severity: z.array(z.enum(["critical", "major", "minor"])).max(3).optional(),
      market: z.array(z.string().max(4)).max(50).optional(),
      model: z.array(z.string().max(40)).max(11).optional(),
      assetId: z.array(z.string().max(64)).max(50).optional(),
      period: z.enum(["7d", "30d", "90d", "365d"]).optional().describe("Default 90d."),
      page: z.number().int().min(1).max(1000).optional(),
      limit: z.number().int().min(1).max(500).optional().describe("Default 50."),
    }),
    scope: "read",
    annotations: RO,
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const r = await listFindings(p, { ...withoutProject(args), status: args.status ?? "open", period: args.period ?? "90d", page: args.page ?? 1, limit: args.limit ?? 50 });
      return {
        text: `${r.pagination.total} finding(s) — open ${r.kpis.open} (critical ${r.kpis.critical}, major ${r.kpis.major}, minor ${r.kpis.minor}), needs review ${r.kpis.needsReview}\n\n${mdTable(r.items, [
          ["id", (f) => f.id],
          ["asset", (f) => f.assetName],
          ["claim", (f) => f.claim],
          ["verdict", (f) => f.verdict],
          ["severity", (f) => f.severity],
          ["model", (f) => f.engine],
          ["market", (f) => f.market],
        ])}`,
        data: { projectId: p.id, ...r, url: `${ctx.baseUrl}/p/${p.id}/fact-check/findings` },
      };
    },
  }),

  defineTool({
    name: "run_fact_check",
    title: "Run fact check",
    description:
      "Queues a fact-check run that compares AI answers about your assets with their reference documents (all active assets, or one asset). Uses the local agent / AI API for judging. Runs in the background — check get_fact_check_overview for results.",
    input: z.object({ projectId: projectIdInput, assetId: z.string().max(64).optional() }),
    scope: "write",
    permission: "prompts.manage",
    annotations: AI_JOB,
    async handler(args, ctx) {
      const p = await toolProject(ctx, args.projectId);
      const r = await runFactCheckForApi(ctx.principal, p, { assetId: args.assetId });
      return {
        text: r.queued ? "Fact-check run queued." : r.alreadyRunning ? "A fact-check run is already queued or running." : "Fact-check run could not be queued.",
        data: { projectId: p.id, ...r, url: `${ctx.baseUrl}/p/${p.id}/fact-check` },
      };
    },
  }),
];
