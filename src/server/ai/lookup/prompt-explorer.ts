import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { aiLookups, projects } from "@/server/db/schema";
import { dfsGet, dfsPost, isDataForSeoConfigured } from "@/server/dataforseo/client";
import { availableLlmProviders, runLlm } from "@/server/ai/llm";
import { citationMatchesBrand, textMentionsBrand } from "@/features/ai-research/lib/brand-match";
import type { ExplorerAnswer, ExplorerCitation, ExplorerModel, ExplorerParams, ExplorerResult } from "@/features/ai-research/types";

export const PROMPT_EXPLORER_JOB = "ai_research.prompt_explorer";
export const MAX_EXPLORER_PROMPT = 500;

type DfsModel = Exclude<ExplorerModel, "autoseo">;

const PREFERRED: Record<DfsModel, string[]> = {
  chat_gpt: ["gpt-5", "gpt-4.1", "gpt-4o"],
  claude: ["claude-sonnet-4-5", "claude-sonnet-4-6", "claude-sonnet-4-0", "claude-3-7-sonnet-latest"],
  gemini: ["gemini-2.5-pro", "gemini-2.5-flash"],
  perplexity: ["sonar-reasoning-pro", "sonar-pro", "sonar"],
};

const CLAUDE_COUNTRIES = new Set("AR AT AU BE BR CA CH CL CN DE DK ES FI FR GB HK ID IN IT JP KR MX MY NL NO NZ PH PL PT RU SA SE TR TW US ZA".split(" "));

type ModelInfo = { model_name: string; reasoning?: boolean; web_search_supported?: boolean };
const modelCache = new Map<DfsModel, { at: number; list: ModelInfo[] }>();

/** Picks the model name: preferred list ∩ DataForSEO's (free) models endpoint, cached 12h. */
async function resolveModel(slug: DfsModel, projectId: string): Promise<{ name: string; reasoning: boolean }> {
  let cached = modelCache.get(slug);
  if (!cached || Date.now() - cached.at > 12 * 3600_000) {
    try {
      const task = await dfsGet<ModelInfo>(`/v3/ai_optimization/${slug}/llm_responses/models`, { projectId, feature: "ai_prompt_explorer" });
      cached = { at: Date.now(), list: (task.result ?? []).filter((m) => m?.model_name) };
      modelCache.set(slug, cached);
    } catch {
      cached = { at: Date.now() - 11 * 3600_000, list: [] };
    }
  }
  const names = new Map(cached.list.map((m) => [m.model_name, m]));
  for (const pref of PREFERRED[slug]) {
    const m = names.get(pref);
    if (m) return { name: m.model_name, reasoning: Boolean(m.reasoning) };
  }
  const fallback = cached.list.find((m) => m.web_search_supported) ?? cached.list[0];
  return fallback ? { name: fallback.model_name, reasoning: Boolean(fallback.reasoning) } : { name: PREFERRED[slug][0]!, reasoning: false };
}

type LlmResponse = {
  model_name?: string;
  output_tokens?: number | null;
  web_search?: boolean;
  money_spent?: number | null;
  items?: { type?: string; sections?: { type?: string; text?: string | null; annotations?: { url?: string | null; title?: string | null }[] | null }[] | null }[] | null;
  fan_out_queries?: string[] | null;
};

function cleanCitations(list: { url?: string | null; title?: string | null }[], brand: string | null): ExplorerCitation[] {
  const seen = new Set<string>();
  const out: ExplorerCitation[] = [];
  for (const c of list) {
    if (!c.url) continue;
    let u: URL;
    try {
      u = new URL(c.url);
    } catch {
      continue;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") continue;
    const url = u.toString();
    if (seen.has(url)) continue;
    seen.add(url);
    const title = c.title?.trim() || null;
    out.push({ url, domain: u.hostname.replace(/^www\./, ""), title, matchedBrand: citationMatchesBrand({ url, title }, brand) });
    if (out.length >= 25) break;
  }
  return out;
}

function splitThinking(text: string): { text: string; thinking: string | null } {
  const thinks: string[] = [];
  const rest = text.replace(/<think>([\s\S]*?)<\/think>/gi, (_, t: string) => {
    thinks.push(t.trim());
    return "";
  });
  return { text: rest.trim(), thinking: thinks.length ? thinks.join("\n\n") : null };
}

async function runDfsModel(slug: DfsModel, params: ExplorerParams, ctx: { projectId: string; workspaceId: string; userId: string | null }): Promise<ExplorerAnswer> {
  const started = Date.now();
  const { name } = await resolveModel(slug, ctx.projectId);
  const iso = params.country === "UK" ? "GB" : params.country;
  const body: Record<string, unknown> = { user_prompt: params.prompt.slice(0, MAX_EXPLORER_PROMPT), model_name: name, max_output_tokens: 4096 };
  if (slug !== "perplexity") body.web_search = params.webSearch;
  if (params.webSearch && iso) {
    if (slug === "chat_gpt") body.web_search_country_iso_code = iso;
    if (slug === "claude" && CLAUDE_COUNTRIES.has(iso)) body.web_search_country_iso_code = iso;
  }
  if (slug === "perplexity" && iso) body.web_search_country_iso_code = iso;
  const task = await dfsPost<LlmResponse>(`/v3/ai_optimization/${slug}/llm_responses/live`, [body], { ...ctx, feature: "ai_prompt_explorer" }, { timeoutMs: 180_000, estimatedCostUsd: 0.05 });
  const r = task.result?.[0] ?? {};
  const messageParts: string[] = [];
  const reasoningParts: string[] = [];
  const annotations: { url?: string | null; title?: string | null }[] = [];
  for (const item of r.items ?? []) {
    for (const s of item.sections ?? []) {
      if (!s.text) continue;
      if (item.type === "reasoning") reasoningParts.push(s.text);
      else if (item.type === "message") {
        messageParts.push(s.text);
        annotations.push(...(s.annotations ?? []));
      }
    }
  }
  const split = splitThinking(messageParts.join("\n\n"));
  const citations = cleanCitations(annotations, params.highlightBrand);
  const thinking = [reasoningParts.join("\n\n").trim(), split.thinking].filter(Boolean).join("\n\n") || null;
  const brandMentioned = params.highlightBrand ? citations.some((c) => c.matchedBrand) || Boolean(textMentionsBrand(split.text, params.highlightBrand)) : null;
  return {
    model: slug,
    status: "ok",
    provider: "dataforseo",
    modelName: r.model_name ?? name,
    text: split.text,
    thinking,
    citations,
    fanOutQueries: (r.fan_out_queries ?? []).filter((q) => typeof q === "string").slice(0, 20),
    outputTokens: r.output_tokens ?? null,
    webSearch: slug === "perplexity" ? true : Boolean(r.web_search ?? params.webSearch),
    brandMentioned,
    costUsd: Number(task.cost ?? 0),
    durationMs: Date.now() - started,
  };
}

async function runInternal(params: ExplorerParams, ctx: { projectId: string; workspaceId: string; userId: string | null }): Promise<ExplorerAnswer> {
  const started = Date.now();
  const res = await runLlm({
    purpose: "prompt_explorer",
    timeoutMs: 8 * 60_000,
    prompt: params.prompt,
    webSearch: params.webSearch,
    projectId: ctx.projectId,
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    maxTokens: 4096,
  });
  const split = splitThinking(res.text);
  const citations = cleanCitations(res.citations, params.highlightBrand);
  return {
    model: "autoseo",
    status: "ok",
    provider: res.provider,
    modelName: res.model,
    text: split.text,
    thinking: split.thinking,
    citations,
    fanOutQueries: [],
    outputTokens: null,
    webSearch: params.webSearch,
    brandMentioned: params.highlightBrand ? citations.some((c) => c.matchedBrand) || Boolean(textMentionsBrand(split.text, params.highlightBrand)) : null,
    costUsd: 0,
    durationMs: Date.now() - started,
  };
}

export async function explorerAvailability(): Promise<{ dataforseo: boolean; internal: boolean }> {
  const [dataforseo, providers] = await Promise.all([isDataForSeoConfigured(), availableLlmProviders()]);
  return { dataforseo, internal: providers.length > 0 };
}

export async function runPromptExplorer(lookupId: string) {
  const [row] = await db.select().from(aiLookups).where(eq(aiLookups.id, lookupId)).limit(1);
  if (!row || row.kind !== "prompt_explorer") return { skipped: "lookup not found" };
  const [project] = await db.select().from(projects).where(eq(projects.id, row.projectId)).limit(1);
  if (!project) return { skipped: "project deleted" };
  await db.update(aiLookups).set({ status: "running" }).where(eq(aiLookups.id, lookupId));
  const params = row.params as unknown as ExplorerParams;
  const ctx = { projectId: row.projectId, workspaceId: project.workspaceId, userId: row.createdBy };
  const models = [...new Set(params.models)];
  const settled = await Promise.allSettled(models.map((m) => (m === "autoseo" ? runInternal(params, ctx) : runDfsModel(m, params, ctx))));
  const answers: ExplorerAnswer[] = settled.map((s, i) =>
    s.status === "fulfilled"
      ? s.value
      : {
          model: models[i]!,
          status: "error",
          provider: models[i] === "autoseo" ? "internal" : "dataforseo",
          modelName: null,
          text: "",
          thinking: null,
          citations: [],
          fanOutQueries: [],
          outputTokens: null,
          webSearch: params.webSearch,
          brandMentioned: null,
          costUsd: 0,
          durationMs: 0,
          error: s.reason instanceof Error ? s.reason.message.slice(0, 400) : "This model is temporarily unavailable. Please try again.",
        },
  );
  const cost = answers.reduce((a, x) => a + x.costUsd, 0);
  const allFailed = answers.every((a) => a.status === "error");
  const result: ExplorerResult = { answers, fetchedAt: new Date().toISOString() };
  await db
    .update(aiLookups)
    .set({
      status: allFailed ? "failed" : "done",
      error: allFailed ? (answers[0]?.error ?? "All models failed.") : null,
      result: result as unknown as Record<string, unknown>,
      costUsd: cost,
      finishedAt: new Date(),
    })
    .where(eq(aiLookups.id, lookupId));
  return { cost, models: models.length, failed: answers.filter((a) => a.status === "error").length };
}
