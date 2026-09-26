import "server-only";
import { z } from "zod";
import { CONTENT_STATUSES, TASK_STATUSES } from "@/server/db/schema";
import { availableLlmProviders } from "@/server/ai/llm";
import { contentDashboard, createContent, getContent, listContent } from "@/server/optimize/content/service";
import { enqueueContentGeneration, enqueueUrlOptimization } from "@/server/optimize/content/jobs";
import { parsePublicUrl, UnsafeUrlError } from "@/server/optimize/net";
import { enqueueFactCheck } from "@/server/optimize/fact-check/enqueue";
import { addTaskComment, getTask, setTaskStatus } from "@/server/optimize/tasks/service";
import { emitTaskEvents } from "@/server/optimize/integrations";
import { getAssetDetail, getFindings, getOverview, getRunState, FINDING_VERDICTS } from "@/features/optimize/fact-check/queries";
import type { ApiPrincipal, ApiProject } from "./auth";
import { ApiError } from "./errors";

/**
 * Optimize module (content, fact check, task updates) for REST v1 and MCP. Same rules as the module's
 * server actions: reads need project access, writes `prompts.manage`; AI generation runs as jobs.
 */

const NO_AI = "No AI provider is available. Connect a local agent (Local Agents) or add an API key in Admin → AI Providers.";

async function hasAi() {
  return (await availableLlmProviders().catch(() => [])).length > 0;
}

/* ───────────────────────────── Tasks (writes) ───────────────────────────── */

export const taskStatusInput = z.object({ status: z.enum(TASK_STATUSES).describe("open | in_progress | done | dismissed") });

export async function updateTaskStatus(p: ApiPrincipal, project: ApiProject, taskIds: string[], status: (typeof TASK_STATUSES)[number]) {
  const changed = await setTaskStatus(project.id, taskIds, status, p.user.id);
  if (changed.length) {
    await emitTaskEvents(project.id, status === "done" || status === "dismissed" ? "task.resolved" : "task.updated", changed).catch(() => null);
  }
  return { changed: changed.length, taskIds: changed, status };
}

export const taskCommentInput = z.object({ body: z.string().trim().min(1).max(5000).describe("Comment text (markdown).") });

export async function commentOnTask(p: ApiPrincipal, project: ApiProject, taskId: string, body: string) {
  const task = await getTask(project.id, taskId);
  if (!task) throw new ApiError("not_found", "Task not found.");
  await addTaskComment(project.id, taskId, body, p.user.id);
  return { taskId, commented: true };
}

/* ───────────────────────────── Content ───────────────────────────── */

export const contentListQuery = z.object({
  status: z.enum(CONTENT_STATUSES).optional(),
  kind: z.enum(["article", "rewrite"]).optional(),
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function listContentForApi(project: ApiProject, q: z.infer<typeof contentListQuery>) {
  const [all, dashboard] = await Promise.all([listContent(project.id), contentDashboard(project.id)]);
  let items = all;
  if (q.status) items = items.filter((c) => c.status === q.status);
  if (q.kind) items = items.filter((c) => c.kind === q.kind);
  if (q.search?.trim()) {
    const s = q.search.trim().toLowerCase();
    items = items.filter((c) => c.title.toLowerCase().includes(s) || (c.targetPrompt ?? "").toLowerCase().includes(s) || (c.targetKeyword ?? "").toLowerCase().includes(s));
  }
  const total = items.length;
  return {
    summary: {
      total: dashboard.total,
      avgScore: dashboard.avgScore,
      optimized: dashboard.optimized,
      published: dashboard.published,
      inReview: dashboard.review,
      drafts: dashboard.drafts,
      generating: dashboard.generating,
    },
    items: items.slice((q.page - 1) * q.limit, q.page * q.limit),
    pagination: { page: q.page, limit: q.limit, total, totalPages: Math.max(1, Math.ceil(total / q.limit)) },
  };
}

export const contentDetailQuery = z.object({
  maxBodyChars: z.coerce.number().int().min(500).max(400_000).optional().describe("Truncate the markdown body."),
});

export async function getContentForApi(project: ApiProject, contentId: string, opts: { maxBodyChars?: number } = {}) {
  const row = await getContent(project.id, contentId);
  if (!row) throw new ApiError("not_found", "Content not found.");
  const max = opts.maxBodyChars ?? 60_000;
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    status: row.status,
    generationStage: row.generationStage,
    error: row.error,
    targetPrompt: row.targetPrompt,
    targetKeyword: row.targetKeyword,
    language: row.language,
    aeoScore: row.aeoScore,
    baselineScore: row.baselineScore,
    wordCount: row.wordCount,
    metaTitle: row.metaTitle,
    metaDescription: row.metaDescription,
    slug: row.slug,
    sourceUrl: row.sourceUrl,
    publishedUrl: row.publishedUrl,
    body: row.body.length > max ? `${row.body.slice(0, max)}\n\n[truncated ${row.body.length - max} characters]` : row.body,
    faqs: row.faqs,
    entities: row.entities,
    citations: row.citations,
    schemaJsonLd: row.schemaJsonLd,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const generateContentInput = z.object({
  target: z.string().trim().min(3).max(400).describe("Topic or AI prompt the article should win (e.g. \"best balcony power plant with storage\")."),
  keyword: z.string().trim().max(120).optional().describe("Target search keyword."),
  contentType: z.enum(["article", "guide", "comparison", "listicle", "how-to", "faq", "product"]).optional(),
  wordCount: z.number().int().min(400).max(4000).optional().describe("Default 1500."),
  language: z.string().min(2).max(8).optional().describe("Default: project language."),
  includeFaq: z.boolean().optional(),
  tone: z.string().max(120).optional(),
  instructions: z.string().max(2000).optional(),
});

export async function generateContentForApi(p: ApiPrincipal, project: ApiProject, raw: z.input<typeof generateContentInput>) {
  const data = generateContentInput.parse(raw);
  if (!(await hasAi())) throw new ApiError("not_configured", NO_AI);
  const wordCount = data.wordCount ?? 1500;
  const row = await createContent(
    project.id,
    {
      title: data.target,
      status: "generating",
      targetPrompt: data.target,
      targetKeyword: data.keyword || null,
      topic: data.keyword || data.target,
      language: data.language ?? project.language,
      generationStage: "queued",
      brief: { wordCount },
    },
    p.user.id,
  );
  await enqueueContentGeneration(
    project.id,
    row.id,
    { contentType: data.contentType ?? "article", wordCount, includeFaq: data.includeFaq ?? true, tone: data.tone || undefined, instructions: data.instructions || undefined },
    p.user.id,
  );
  return { contentId: row.id, status: "generating" as const };
}

export const optimizeUrlInput = z.object({
  url: z.string().trim().min(4).max(2000).describe("Public page URL to import and optimize for AI answers."),
  keyword: z.string().trim().max(120).optional(),
  targetPrompt: z.string().trim().max(400).optional(),
  rewrite: z.boolean().optional().describe("Let AI rewrite the page (default true; without AI the page is only imported and scored)."),
});

export async function optimizeUrlForApi(p: ApiPrincipal, project: ApiProject, raw: z.input<typeof optimizeUrlInput>) {
  const data = optimizeUrlInput.parse(raw);
  let url: URL;
  try {
    url = parsePublicUrl(/^https?:\/\//i.test(data.url) ? data.url : `https://${data.url}`);
  } catch (err) {
    throw new ApiError("validation_error", err instanceof UnsafeUrlError ? err.message : "Enter a valid public URL.");
  }
  const row = await createContent(
    project.id,
    {
      title: url.hostname + url.pathname,
      kind: "rewrite",
      status: "generating",
      sourceUrl: url.toString(),
      targetKeyword: data.keyword || null,
      targetPrompt: data.targetPrompt || null,
      language: project.language,
      generationStage: "queued",
    },
    p.user.id,
  );
  const rewrite = data.rewrite ?? true;
  await enqueueUrlOptimization(project.id, row.id, rewrite, p.user.id);
  return { contentId: row.id, status: "generating" as const, rewrite: rewrite && (await hasAi()) };
}

/* ───────────────────────────── Fact check ───────────────────────────── */

export async function factCheckOverview(project: ApiProject) {
  const o = await getOverview(project.id);
  return {
    totals: o.totals,
    lastCheckedAt: o.lastCheckedAt,
    answersTracked: o.answersTracked,
    aiReady: o.aiReady,
    run: o.run,
    assets: o.assets,
  };
}

export const findingsQuery = z.object({
  status: z.enum(["open", "resolved", "ignored", "all"]).default("open"),
  verdict: z.array(z.enum(FINDING_VERDICTS)).max(5).optional().describe("off_label, contradicted, unsupported, outdated, needs_review"),
  severity: z.array(z.enum(["critical", "major", "minor"])).max(3).optional(),
  market: z.array(z.string().max(4)).max(50).optional(),
  model: z.array(z.string().max(40)).max(11).optional(),
  assetId: z.array(z.string().max(64)).max(50).optional(),
  period: z.enum(["7d", "30d", "90d", "365d"]).default("90d"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export const FINDINGS_ARRAY_KEYS = ["verdict", "severity", "market", "model", "assetId"];

export async function listFindings(project: ApiProject, q: z.infer<typeof findingsQuery>) {
  const data = await getFindings(project.id, {
    markets: (q.market ?? []).map((m) => m.toUpperCase()),
    engines: q.model ?? [],
    types: q.verdict ?? [],
    severities: q.severity ?? [],
    assets: q.assetId ?? [],
    status: q.status,
    period: q.period,
    tab: "all",
  });
  const total = data.rows.length;
  return {
    kpis: data.kpis,
    offLabelCount: data.offLabelCount,
    options: data.options,
    items: data.rows.slice((q.page - 1) * q.limit, q.page * q.limit),
    pagination: { page: q.page, limit: q.limit, total, totalPages: Math.max(1, Math.ceil(total / q.limit)) },
  };
}

export const runFactCheckInput = z.object({ assetId: z.string().max(64).optional().describe("Check only this asset (default: all active assets).") });

export async function runFactCheckForApi(p: ApiPrincipal, project: ApiProject, raw: z.input<typeof runFactCheckInput>) {
  const { assetId } = runFactCheckInput.parse(raw);
  if (assetId && !(await getAssetDetail(project.id, assetId))) throw new ApiError("not_found", "Fact-check asset not found.");
  const state = await getRunState(project.id);
  const job = await enqueueFactCheck({ projectId: project.id, assetId: assetId ?? null, trigger: "api" }, { createdBy: p.user.id });
  return { queued: Boolean(job), alreadyRunning: !job && Boolean(state.active), assetId: assetId ?? null };
}
