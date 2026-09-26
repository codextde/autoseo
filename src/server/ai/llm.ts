import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { getSetting } from "@/server/settings";
import { recordUsage, assertBudget } from "@/server/usage";
import { dispatchAgentLlm, type AgentRuntime } from "@/server/agents/dispatch";

export type LlmProvider = "agent" | "anthropic" | "openai" | "openrouter";

export type LlmRequest<S extends z.ZodType | undefined = undefined> = {
  /** Label for usage tracking and the agent activity log. */
  purpose: string;
  system?: string;
  prompt: string;
  /** When set, the answer is parsed & validated against this schema. */
  schema?: S;
  /** Let the model search the web (answers carry citations). */
  webSearch?: boolean;
  /** "auto" = local agent first (if enabled) then API keys; "api" skips agents; "agent" = agent only. */
  route?: "auto" | "agent" | "api";
  runtime?: AgentRuntime | "any";
  /** Local agents in Auto mode: "full" = with the machine's MCP servers (agentic work), "lean" = bulk analysis. */
  agentMode?: "lean" | "full";
  maxTokens?: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  timeoutMs?: number;
  projectId?: string | null;
  workspaceId?: string | null;
  userId?: string | null;
};

export type LlmResult<T> = {
  text: string;
  data: T;
  provider: LlmProvider;
  model: string;
  citations: { url: string; title?: string }[];
};

export class AiNotConfiguredError extends Error {
  constructor(message = "No AI provider is available. Connect a local agent (Claude Code / Codex) or add an API key in Admin → AI Providers.") {
    super(message);
  }
}

type Parsed<S> = S extends z.ZodType ? z.infer<S> : string;

/** Extracts the first JSON object/array from free text (agents answer in plain text). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.search(/[[{]/);
  if (start === -1) throw new Error("No JSON found in model output");
  const open = candidate[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return JSON.parse(candidate.slice(start, i + 1));
    }
  }
  return JSON.parse(candidate.slice(start));
}

function jsonInstruction(schema: z.ZodType): string {
  return `\n\nRespond with ONLY a JSON value (no prose, no markdown fences) that matches this JSON schema:\n${JSON.stringify(
    z.toJSONSchema(schema),
  )}`;
}

async function viaAgent<S extends z.ZodType | undefined>(req: LlmRequest<S>, timeoutMs: number): Promise<LlmResult<Parsed<S>> | null> {
  const result = await dispatchAgentLlm({
    purpose: req.purpose,
    system: req.system,
    prompt: req.schema ? req.prompt + jsonInstruction(req.schema) : req.prompt,
    jsonSchema: req.schema ? (z.toJSONSchema(req.schema) as Record<string, unknown>) : undefined,
    webSearch: req.webSearch,
    runtime: req.runtime ?? "any",
    mode: req.agentMode,
    timeoutMs,
    projectId: req.projectId,
    workspaceId: req.workspaceId,
    userId: req.userId,
  });
  if (!result) return null;
  const data = req.schema ? (req.schema.parse(extractJson(result.text)) as Parsed<S>) : (result.text as Parsed<S>);
  await recordUsage({
    provider: "local_agent",
    feature: req.purpose,
    endpoint: result.runtime,
    projectId: req.projectId,
    workspaceId: req.workspaceId,
    userId: req.userId,
    meta: { agentId: result.agentId, jobId: result.jobId, durationMs: result.durationMs },
  });
  return { text: result.text, data, provider: "agent", model: result.model ?? result.runtime, citations: result.citations ?? [] };
}

// Approximate list prices (USD per 1M tokens) used for usage estimates only.
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5": [5, 25],
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5": [2, 10],
  "claude-haiku-4-5": [1, 5],
};

async function viaAnthropic<S extends z.ZodType | undefined>(req: LlmRequest<S>, apiKey: string, model: string): Promise<LlmResult<Parsed<S>>> {
  const client = new Anthropic({ apiKey, timeout: req.timeoutMs ?? 10 * 60_000 });
  const tools = req.webSearch ? [{ type: "web_search_20260209" as const, name: "web_search" as const, max_uses: 5 }] : undefined;
  const base = {
    model,
    max_tokens: req.maxTokens ?? 16000,
    system: req.system,
    messages: [{ role: "user" as const, content: req.prompt }],
    tools,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default" as const,
    ...(req.effort ? { output_config: { effort: req.effort } } : {}),
  };
  let message;
  let data: unknown;
  if (req.schema && !req.webSearch) {
    const parsed = await client.beta.messages.parse({
      ...base,
      output_config: { ...(req.effort ? { effort: req.effort } : {}), format: betaZodOutputFormat(req.schema) },
    });
    message = parsed;
    data = parsed.parsed_output;
  } else {
    message = await client.beta.messages.create(base);
  }
  if (message.stop_reason === "refusal") throw new Error("The model declined this request.");
  let text = "";
  const citations: { url: string; title?: string }[] = [];
  for (const block of message.content) {
    if (block.type === "text") {
      text += block.text;
      for (const c of block.citations ?? []) {
        if ("url" in c && typeof c.url === "string") citations.push({ url: c.url, title: "title" in c ? (c.title ?? undefined) : undefined });
      }
    } else if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content) if (r.type === "web_search_result") citations.push({ url: r.url, title: r.title });
    }
  }
  if (req.schema && data == null) data = req.schema.parse(extractJson(text));
  const [inP, outP] = PRICES[model] ?? [5, 25];
  await recordUsage({
    provider: "anthropic",
    feature: req.purpose,
    endpoint: model,
    units: message.usage.input_tokens + message.usage.output_tokens,
    costUsd: (message.usage.input_tokens * inP + message.usage.output_tokens * outP) / 1_000_000,
    projectId: req.projectId,
    workspaceId: req.workspaceId,
    userId: req.userId,
  });
  return {
    text,
    data: (req.schema ? data : text) as Parsed<S>,
    provider: "anthropic",
    model: message.model,
    citations: dedupeCitations(citations),
  };
}

async function viaOpenAiCompatible<S extends z.ZodType | undefined>(
  req: LlmRequest<S>,
  provider: "openai" | "openrouter",
  apiKey: string,
  model: string,
): Promise<LlmResult<Parsed<S>>> {
  const client = new OpenAI({
    apiKey,
    baseURL: provider === "openrouter" ? "https://openrouter.ai/api/v1" : undefined,
    timeout: req.timeoutMs ?? 10 * 60_000,
  });
  const citations: { url: string; title?: string }[] = [];
  let text = "";
  let data: unknown;
  if (provider === "openai" && req.webSearch) {
    const res = await client.responses.create({
      model,
      instructions: req.system,
      input: req.schema ? req.prompt + jsonInstruction(req.schema) : req.prompt,
      tools: [{ type: "web_search" }],
    });
    text = res.output_text;
    for (const item of res.output) {
      if (item.type === "message") {
        for (const part of item.content) {
          if (part.type === "output_text") {
            for (const a of part.annotations ?? []) if (a.type === "url_citation") citations.push({ url: a.url, title: a.title });
          }
        }
      }
    }
    if (req.schema) data = req.schema.parse(extractJson(text));
  } else {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (req.system) messages.push({ role: "system", content: req.system });
    messages.push({ role: "user", content: req.prompt });
    if (req.schema) {
      const res = await client.chat.completions.parse({
        model,
        messages,
        response_format: zodResponseFormat(req.schema, "result"),
      });
      text = res.choices[0]?.message.content ?? "";
      data = res.choices[0]?.message.parsed ?? req.schema.parse(extractJson(text));
    } else {
      const res = await client.chat.completions.create({ model, messages });
      text = res.choices[0]?.message.content ?? "";
    }
  }
  await recordUsage({ provider, feature: req.purpose, endpoint: model, projectId: req.projectId, workspaceId: req.workspaceId, userId: req.userId });
  return { text, data: (req.schema ? data : text) as Parsed<S>, provider, model, citations: dedupeCitations(citations) };
}

function dedupeCitations(list: { url: string; title?: string }[]) {
  const seen = new Set<string>();
  return list.filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)));
}

/** Which providers are currently usable (for UI hints). */
export async function availableLlmProviders(): Promise<LlmProvider[]> {
  const ai = await getSetting("ai");
  const out: LlmProvider[] = [];
  const { hasOnlineAgent } = await import("@/server/agents/dispatch");
  if (ai.preferLocalAgent && (await hasOnlineAgent("any"))) out.push("agent");
  if (ai.anthropicApiKey) out.push("anthropic");
  if (ai.openaiApiKey) out.push("openai");
  if (ai.openrouterApiKey) out.push("openrouter");
  return out;
}

/**
 * Runs an AI task. Order: online local agent (Claude Code / Codex) → API providers in the
 * configured fallback order. Throws AiNotConfiguredError when nothing is available.
 */
export async function runLlm<S extends z.ZodType | undefined = undefined>(req: LlmRequest<S>): Promise<LlmResult<Parsed<S>>> {
  const ai = await getSetting("ai");
  const route = req.route ?? "auto";
  const errors: string[] = [];

  if (route !== "api" && (ai.preferLocalAgent || route === "agent")) {
    try {
      const res = await viaAgent(req, req.timeoutMs ?? ai.agentTimeoutSeconds * 1000);
      if (res) return res;
    } catch (err) {
      errors.push(`agent: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (route === "agent") throw new AiNotConfiguredError(errors[0] ?? "No local agent is online.");
  }

  await assertBudget();
  for (const provider of ai.fallbackOrder) {
    try {
      if (provider === "anthropic" && ai.anthropicApiKey) return await viaAnthropic(req, ai.anthropicApiKey, ai.anthropicModel);
      if (provider === "openai" && ai.openaiApiKey) return await viaOpenAiCompatible(req, "openai", ai.openaiApiKey, ai.openaiModel);
      if (provider === "openrouter" && ai.openrouterApiKey)
        return await viaOpenAiCompatible(req, "openrouter", ai.openrouterApiKey, ai.openrouterModel);
    } catch (err) {
      errors.push(`${provider}: ${err instanceof Error ? err.message : String(err)}`);
      console.error(`[ai] ${provider} failed for ${req.purpose}`, err);
    }
  }
  if (errors.length) throw new Error(`All AI providers failed — ${errors.join(" | ")}`);
  throw new AiNotConfiguredError();
}
