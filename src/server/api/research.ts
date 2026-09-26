import "server-only";
import { z } from "zod";
import { isDataForSeoConfigured } from "@/server/dataforseo/client";
import { availableLlmProviders } from "@/server/ai/llm";
import { createLookup, getLookup, listLookups } from "@/server/ai/lookup/history";
import { explorerAvailability, MAX_EXPLORER_PROMPT } from "@/server/ai/lookup/prompt-explorer";
import { createList, getListRow, getLists, getItems } from "@/server/ai/research/lists";
import { defaultPromptSetConfig, promptSetConfigSchema, startPromptGeneration } from "@/server/ai/research/generate";
import { addItemsToTracker } from "@/server/ai/research/tracker";
import { logAudit } from "@/server/audit";
import { getCountry } from "@/lib/countries";
import type { BrandLookupParams, BrandLookupResult, ExplorerParams, ExplorerResult } from "@/features/ai-research/types";
import type { ApiPrincipal, ApiProject } from "./auth";
import { ApiError, zodIssues } from "./errors";
import { toApiError } from "./error-map";

/**
 * AI research (brand lookup, prompt explorer, prompt research lists) for REST v1 and MCP. Mirrors the
 * ai-research module's server actions: paid lookups need `seo.run`, list/tracker writes `prompts.manage`.
 */

/** Services of this module throw plain `Error`s with user-facing messages → validation errors. */
async function userErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (toApiError(err) || zodIssues(err)) throw err;
    if (err instanceof Error) throw new ApiError("validation_error", err.message);
    throw err;
  }
}

/* ───────────────────────────── Brand lookup & prompt explorer ───────────────────────────── */

export const brandLookupInput = z.object({
  query: z.string().trim().min(1).max(250).describe("Brand domain (e.g. solakon.de) or brand / keyword."),
  competitors: z.array(z.string().trim().min(1).max(250)).max(5).optional().describe("Up to 5 competitor domains or names to compare share of voice."),
  scope: z.enum(["domain", "subdomains"]).optional().describe("For domains: include subdomains (default) or the exact domain only."),
  country: z.string().min(2).max(3).optional().describe("Market (ISO code, default the project market). ChatGPT data is US-only."),
});

export async function startBrandLookup(p: ApiPrincipal, project: ApiProject, raw: z.input<typeof brandLookupInput>) {
  const data = brandLookupInput.parse(raw);
  if (!(await isDataForSeoConfigured())) throw new ApiError("not_configured", "DataForSEO is not configured (Admin → Data Providers).");
  const country = getCountry(data.country ?? project.country);
  if (!country) throw new ApiError("validation_error", "Unknown market.");
  const params: BrandLookupParams = {
    query: data.query,
    competitors: (data.competitors ?? []).filter((c) => c.toLowerCase() !== data.query.toLowerCase()),
    scope: data.scope ?? "subdomains",
    country: country.iso,
    locationCode: country.locationCode,
    languageCode: country.language,
  };
  const row = await createLookup({ projectId: project.id, kind: "brand_lookup", query: data.query, params, userId: p.user.id });
  void logAudit("ai.brand_lookup", {
    actor: { id: p.user.id, email: p.user.email },
    projectId: project.id,
    workspaceId: project.workspaceId,
    targetType: "ai_lookup",
    targetId: row.id,
    meta: { query: data.query, via: p.kind === "oauth" ? "oauth" : "api_key" },
  });
  return { lookupId: row.id, kind: "brand_lookup" as const, status: row.status, params };
}

export const EXPLORER_MODEL_IDS = ["chat_gpt", "claude", "gemini", "perplexity", "autoseo"] as const;

export const promptExplorerInput = z.object({
  prompt: z.string().trim().min(3).max(MAX_EXPLORER_PROMPT).describe("The question to ask the AI models."),
  models: z
    .array(z.enum(EXPLORER_MODEL_IDS))
    .min(1)
    .max(5)
    .optional()
    .describe("chat_gpt, claude, gemini, perplexity (DataForSEO) and/or autoseo (local agent / AI API). Default: all available."),
  webSearch: z.boolean().optional().describe("Let the models search the web (default true)."),
  country: z.string().min(2).max(3).optional().describe("Market for the answers (ISO code, default US)."),
  highlightBrand: z.string().trim().max(120).optional().describe("Brand to detect in answers and citations (default: project name)."),
});

export async function startPromptExplorer(p: ApiPrincipal, project: ApiProject, raw: z.input<typeof promptExplorerInput>) {
  const data = promptExplorerInput.parse(raw);
  const avail = await explorerAvailability();
  const models = data.models?.length
    ? [...new Set(data.models)]
    : EXPLORER_MODEL_IDS.filter((m) => (m === "autoseo" ? avail.internal : avail.dataforseo));
  if (!models.length) throw new ApiError("not_configured", "No model is available: configure DataForSEO (Admin → Data Providers) or an AI provider / local agent.");
  if (models.some((m) => m !== "autoseo") && !avail.dataforseo) {
    throw new ApiError("not_configured", "DataForSEO is not configured (Admin → Data Providers). Use models: [\"autoseo\"] for the local agent / AI API.");
  }
  if (models.includes("autoseo") && !avail.internal) throw new ApiError("not_configured", "No local agent or AI API provider is available (Admin → AI Providers).");
  const params: ExplorerParams = {
    prompt: data.prompt,
    models,
    webSearch: data.webSearch ?? true,
    country: (data.country ?? "US").toUpperCase(),
    highlightBrand: data.highlightBrand || project.name,
  };
  const row = await createLookup({ projectId: project.id, kind: "prompt_explorer", query: data.prompt, params, userId: p.user.id });
  return { lookupId: row.id, kind: "prompt_explorer" as const, status: row.status, params };
}

export async function getLookupResult(project: ApiProject, lookupId: string, opts: { maxAnswerChars?: number } = {}) {
  const row = await getLookup(project.id, lookupId);
  if (!row) throw new ApiError("not_found", "Lookup not found.");
  const base = {
    lookupId: row.id,
    kind: row.kind,
    query: row.query,
    status: row.status,
    error: row.error,
    costUsd: Math.round(row.costUsd * 1000) / 1000,
    params: row.params,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
  if (row.status !== "done") return { ...base, result: null };
  if (row.kind === "prompt_explorer") {
    const res = row.result as unknown as ExplorerResult;
    const max = opts.maxAnswerChars ?? 8000;
    return {
      ...base,
      result: {
        ...res,
        answers: (res.answers ?? []).map((a) => ({ ...a, text: a.text.length > max ? `${a.text.slice(0, max)}\n\n[truncated ${a.text.length - max} characters]` : a.text })),
      },
    };
  }
  return { ...base, result: row.result as unknown as BrandLookupResult };
}

export const lookupsQuery = z.object({
  kind: z.enum(["brand_lookup", "prompt_explorer"]).default("brand_lookup"),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const lookupResultQuery = z.object({
  maxAnswerChars: z.coerce.number().int().min(500).max(200_000).optional().describe("Truncate prompt-explorer answers."),
});

export async function listLookupHistory(project: ApiProject, kind: "brand_lookup" | "prompt_explorer", limit = 30) {
  return listLookups(project.id, kind, Math.min(100, Math.max(1, limit)));
}

/* ───────────────────────────── Prompt research lists ───────────────────────────── */

export async function listResearchLists(project: ApiProject) {
  return getLists(project.id);
}

export const researchItemsQuery = z.object({
  listId: z.string().max(64).optional().describe("List id (default: the project's default list)."),
  topic: z.string().max(120).optional(),
  funnelStage: z.enum(["tofu", "mofu", "bofu"]).optional(),
  search: z.string().max(200).optional(),
  untrackedOnly: z.enum(["true", "false"]).optional().describe("Only prompts not yet added to the tracker."),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export async function listResearchItems(project: ApiProject, q: z.infer<typeof researchItemsQuery>) {
  const lists = await getLists(project.id);
  const list = q.listId ? lists.find((l) => l.id === q.listId) : (lists.find((l) => l.isDefault) ?? lists[0]);
  if (!list) {
    if (q.listId) throw new ApiError("not_found", "Prompt list not found.");
    return { list: null, items: [], pagination: { page: q.page, limit: q.limit, total: 0, totalPages: 1 } };
  }
  let items = await getItems(project.id, list.id);
  if (q.topic) items = items.filter((i) => (i.topic ?? "").toLowerCase() === q.topic!.toLowerCase());
  if (q.funnelStage) items = items.filter((i) => i.funnelStage === q.funnelStage);
  if (q.search?.trim()) {
    const s = q.search.trim().toLowerCase();
    items = items.filter((i) => i.text.toLowerCase().includes(s));
  }
  if (q.untrackedOnly === "true") items = items.filter((i) => !i.trackedPromptId);
  const total = items.length;
  return {
    list,
    items: items.slice((q.page - 1) * q.limit, q.page * q.limit).map((i) => ({
      id: i.id,
      text: i.text,
      topic: i.topic,
      funnelStage: i.funnelStage,
      persona: i.persona,
      intent: i.intent,
      branded: i.branded,
      competitorMentioned: i.competitorMentioned,
      length: i.length,
      volume: i.volume,
      volumeScore: i.volumeScore,
      volumeSource: i.volumeSource,
      keyword: i.keyword,
      trackedPromptId: i.trackedPromptId,
      source: i.source,
      createdAt: i.createdAt,
    })),
    pagination: { page: q.page, limit: q.limit, total, totalPages: Math.max(1, Math.ceil(total / q.limit)) },
  };
}

export const generateResearchInput = z.object({
  listId: z.string().max(64).optional().describe("Append to this list. Omit to create a new list named `newListName`."),
  newListName: z.string().trim().min(1).max(120).optional().describe("Name of a new list (default \"AI prompts <date>\")."),
  count: z.number().int().min(5).max(200).optional().describe("Number of prompts to generate (default 40)."),
  topics: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
  personas: z.array(z.string().trim().min(1).max(160)).max(20).optional(),
  funnelStages: z.array(z.enum(["tofu", "mofu", "bofu"])).min(1).optional(),
  brandedShare: z.number().int().min(0).max(100).optional().describe("% of prompts naming the brand (default 20)."),
  competitorComparisons: z.boolean().optional(),
  instructions: z.string().max(1000).optional(),
});

export async function generateResearchList(p: ApiPrincipal, project: ApiProject, raw: z.input<typeof generateResearchInput>) {
  const data = generateResearchInput.parse(raw);
  if (!(await availableLlmProviders()).length) {
    throw new ApiError("not_configured", "No AI provider is available. Connect a local agent or add an API key in Admin → AI Providers.");
  }
  const defaults = await defaultPromptSetConfig(project.id);
  const config = promptSetConfigSchema.parse({
    ...defaults,
    ...Object.fromEntries(Object.entries(data).filter(([k, v]) => v !== undefined && k !== "listId" && k !== "newListName")),
  });
  return userErrors(async () => {
    const list = data.listId
      ? await getListRow(project.id, data.listId)
      : await createList(project.id, data.newListName ?? `AI prompts ${new Date().toISOString().slice(0, 10)}`, "generated", p.user.id);
    if (!list) throw new ApiError("not_found", "Prompt list not found.");
    const { jobId } = await startPromptGeneration({ projectId: project.id, listId: list.id, config, userId: p.user.id });
    void logAudit("prompt_research.generate", {
      actor: { id: p.user.id, email: p.user.email },
      projectId: project.id,
      workspaceId: project.workspaceId,
      targetType: "prompt_research_list",
      targetId: list.id,
      meta: { count: config.count, via: "api" },
    });
    return { listId: list.id, listName: list.name, jobId, status: "generating" as const, count: config.count };
  });
}

export const addToTrackerInput = z.object({ itemIds: z.array(z.string().min(1).max(64)).min(1).max(500).describe("Prompt research item ids.") });

export async function addResearchItemsToTracker(p: ApiPrincipal, project: ApiProject, raw: z.input<typeof addToTrackerInput>) {
  const { itemIds } = addToTrackerInput.parse(raw);
  const res = await userErrors(() => addItemsToTracker(project.id, itemIds, p.user.id));
  if (res.added === 0 && res.linked === 0 && res.skippedOverLimit > 0) {
    throw new ApiError("conflict", "Prompt limit reached for this project (Admin → Limits & Budgets).");
  }
  return res;
}
