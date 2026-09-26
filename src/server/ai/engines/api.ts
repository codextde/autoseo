import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { getSetting } from "@/server/settings";
import { recordUsage } from "@/server/usage";
import type { AnswerRequest, AnswerResult } from "./types";
import { EngineUnavailableError } from "./types";
import { CitationCollector, arr, countryName, hostOf, isoCountry, num, obj, str, stripCitationMarkers, trimRaw, uniqueStrings } from "./util";

/**
 * Direct provider APIs with web search (docs verified 2026-09):
 * - OpenAI      Responses API + `web_search` tool (user_location), fan-outs from web_search_call.action.queries
 * - Anthropic   Messages API + `web_search_20260209` server tool (server-side refusal fallback)
 * - Perplexity  Agent API (`/v1/agent`, preset "fast"), results from output[type=search_results]
 * - Gemini      generateContent + google_search grounding (webSearchQueries = fan-outs)
 * - xAI         Responses API + `web_search` tool (Live Search was removed in 2026-01)
 * - Mistral     Conversations API + `web_search` tool
 * - DeepSeek    Chat completions (the API has no web search)
 */

const TIMEOUT_MS = 180_000;

// Approximate list prices (USD) for usage estimates: [input per 1M, output per 1M, per web search call].
const PRICE: Record<string, [number, number, number]> = {
  openai: [1.25, 10, 0.01],
  anthropic: [5, 25, 0.01],
  perplexity: [1, 1, 0.0025],
  gemini: [0.3, 2.5, 0.014],
  xai: [2, 6, 0.005],
  mistral: [1.5, 7.5, 0.03],
  deepseek: [0.3, 1.2, 0],
};

function estimate(provider: keyof typeof PRICE, input: number, output: number, searches: number): number {
  const [i, o, s] = PRICE[provider]!;
  return Math.round(((input * i + output * o) / 1_000_000 + searches * s) * 1e6) / 1e6;
}

async function track(req: AnswerRequest, provider: string, model: string, costUsd: number, units: number) {
  await recordUsage({
    provider,
    feature: "ai_tracking",
    endpoint: `${req.engine}:${model}`,
    units: Math.max(1, units),
    costUsd,
    projectId: req.project.id,
    workspaceId: req.project.workspaceId,
    userId: req.userId ?? null,
  });
}

function localeHint(req: AnswerRequest): string {
  return `The user is located in ${countryName(req.country)}. Answer in the language of the question.`;
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, label: string): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    throw new Error(`${label} request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const textBody = await res.text();
  if (!res.ok) {
    if (res.status === 401 || res.status === 403)
      throw new EngineUnavailableError(`${label} rejected the API key (${res.status}). Check Admin → AI Providers.`, "not_configured");
    let message = textBody.slice(0, 400);
    try {
      const j = JSON.parse(textBody) as Record<string, unknown>;
      const e = obj(j.error);
      message = str(e.message) ?? str(j.message) ?? str(j.detail) ?? message;
    } catch {
      // keep raw text
    }
    const err = new Error(`${label} HTTP ${res.status}: ${message}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  try {
    return JSON.parse(textBody) as Record<string, unknown>;
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
}

function emptyGuard(text: string, label: string) {
  if (!text.trim()) throw new EngineUnavailableError(`${label} returned an empty answer.`, "no_answer");
}

/* ───────────────────────────── OpenAI (ChatGPT) ───────────────────────────── */

async function openaiAnswer(req: AnswerRequest, apiKey: string, model: string): Promise<AnswerResult> {
  const client = new OpenAI({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 });
  const res = await client.responses.create({
    model,
    input: req.prompt,
    tools: [{ type: "web_search", user_location: { type: "approximate", country: isoCountry(req.country) } }],
    include: ["web_search_call.action.sources"],
  });
  const cites = new CitationCollector();
  const fanouts: string[] = [];
  let searches = 0;
  for (const item of res.output) {
    if (item.type === "web_search_call") {
      searches++;
      if (item.action.type === "search") {
        fanouts.push(...(item.action.queries ?? []), ...(item.action.query ? [item.action.query] : []));
      }
    } else if (item.type === "message") {
      for (const part of item.content) {
        if (part.type !== "output_text") continue;
        for (const a of part.annotations ?? []) if (a.type === "url_citation") cites.add(a.url, a.title);
      }
    }
  }
  const text = res.output_text ?? "";
  emptyGuard(text, "OpenAI");
  const usage = res.usage;
  const costUsd = estimate("openai", usage?.input_tokens ?? 0, usage?.output_tokens ?? 0, searches);
  await track(req, "openai", res.model, costUsd, (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0));
  return {
    text,
    citations: cites.list,
    fanouts: uniqueStrings(fanouts),
    shopping: [],
    ads: [],
    model: res.model,
    provider: "api",
    costUsd,
    raw: trimRaw({ endpoint: "openai/responses", id: res.id, usage, searches }),
  };
}

/* ───────────────────────────── Anthropic (Claude) ───────────────────────────── */

async function anthropicAnswer(req: AnswerRequest, apiKey: string, model: string): Promise<AnswerResult> {
  const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 });
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: req.prompt }];
  const tools: Anthropic.Beta.BetaToolUnion[] = [
    {
      type: "web_search_20260209",
      name: "web_search",
      max_uses: 5,
      user_location: { type: "approximate", country: isoCountry(req.country) },
    },
  ];
  const cites = new CitationCollector();
  const fanouts: string[] = [];
  const textParts: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let searches = 0;
  let finalModel = model;
  // Server-side tool loops can pause (`pause_turn`); resume by sending the paused turn back.
  for (let round = 0; round < 4; round++) {
    const message = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      system: localeHint(req),
      messages,
      tools,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    finalModel = message.model;
    inputTokens += message.usage.input_tokens;
    outputTokens += message.usage.output_tokens;
    searches += message.usage.server_tool_use?.web_search_requests ?? 0;
    if (message.stop_reason === "refusal") throw new Error("Claude declined to answer this prompt (refusal).");
    for (const block of message.content) {
      if (block.type === "text") {
        textParts.push(block.text);
        for (const c of block.citations ?? []) {
          if (c.type === "web_search_result_location") cites.add(c.url, c.title);
        }
      } else if (block.type === "server_tool_use" && block.name === "web_search") {
        const q = str(obj(block.input).query);
        if (q) fanouts.push(q);
      } else if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const r of block.content) if (r.type === "web_search_result") cites.add(r.url, r.title);
      }
    }
    if (message.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: message.content });
    // The paused turn's text is re-emitted on resume only for new blocks; keep what we have.
  }
  const text = textParts.join("").trim();
  emptyGuard(text, "Claude");
  const costUsd = estimate("anthropic", inputTokens, outputTokens, searches);
  await track(req, "anthropic", finalModel, costUsd, inputTokens + outputTokens);
  return {
    text,
    citations: cites.list,
    fanouts: uniqueStrings(fanouts),
    shopping: [],
    ads: [],
    model: finalModel,
    provider: "api",
    costUsd,
    raw: trimRaw({ endpoint: "anthropic/messages", inputTokens, outputTokens, searches }),
  };
}

/* ───────────────────────────── Perplexity ───────────────────────────── */

function parseResponsesOutput(json: Record<string, unknown>, cites: CitationCollector, fanouts: string[]): string {
  const parts: string[] = [];
  for (const item of arr(json.output)) {
    const it = obj(item);
    const type = str(it.type);
    if (type === "message") {
      for (const c of arr(it.content)) {
        const part = obj(c);
        if (part.type === "output_text" || part.type === "text") {
          const t = str(part.text);
          if (t) parts.push(t);
          for (const a of arr(part.annotations)) {
            const an = obj(a);
            if (an.type === "url_citation") {
              const title = str(an.title);
              cites.add(an.url, title && !/^\d+$/.test(title) ? title : null);
            }
          }
        }
      }
    } else if (type === "search_results") {
      for (const r of arr(it.results)) {
        const res = obj(r);
        cites.add(res.url, res.title);
      }
      fanouts.push(...uniqueStrings(arr(it.queries)));
    } else if (type === "web_search_call") {
      const action = obj(it.action);
      fanouts.push(...uniqueStrings([...arr(action.queries), action.query]));
      for (const s of arr(action.sources)) cites.add(obj(s).url, null);
    }
  }
  return parts.join("\n\n").trim();
}

async function perplexityAnswer(req: AnswerRequest, apiKey: string, model: string): Promise<AnswerResult> {
  const headers = { Authorization: `Bearer ${apiKey}` };
  const cites = new CitationCollector();
  const fanouts: string[] = [];
  // Admin may pin a legacy Sonar model ("sonar", "sonar-pro"): use the OpenAI-compatible endpoint.
  if (model.startsWith("sonar")) {
    const json = await postJson(
      "https://api.perplexity.ai/chat/completions",
      headers,
      {
        model,
        messages: [{ role: "user", content: req.prompt }],
        web_search_options: { user_location: { country: isoCountry(req.country) } },
      },
      "Perplexity",
    );
    const choice = obj(arr(json.choices)[0]);
    const text = stripCitationMarkers(str(obj(choice.message).content) ?? "");
    for (const r of arr(json.search_results)) {
      const sr = obj(r);
      cites.add(sr.url, sr.title);
    }
    for (const u of arr(json.citations)) cites.add(u, null);
    emptyGuard(text, "Perplexity");
    const usage = obj(json.usage);
    const reported = num(obj(usage.cost).total_cost);
    const costUsd = reported ?? estimate("perplexity", num(usage.prompt_tokens) ?? 0, num(usage.completion_tokens) ?? 0, 1);
    await track(req, "perplexity", model, costUsd, (num(usage.total_tokens) ?? 0) as number);
    return { text, citations: cites.list, fanouts: [], shopping: [], ads: [], model: str(json.model) ?? model, provider: "api", costUsd, raw: trimRaw({ endpoint: "perplexity/sonar", usage }) };
  }
  // Agent API (successor of Sonar). `model` = preset name (fast/low/medium/high) or a provider model id.
  const isPreset = ["fast", "low", "medium", "high"].includes(model);
  const body: Record<string, unknown> = isPreset
    ? { preset: model, input: req.prompt, instructions: localeHint(req) }
    : {
        model,
        input: req.prompt,
        instructions: localeHint(req),
        tools: [{ type: "web_search", user_location: { country: isoCountry(req.country) } }],
      };
  let json: Record<string, unknown>;
  try {
    json = await postJson("https://api.perplexity.ai/v1/agent", headers, body, "Perplexity");
  } catch (err) {
    // Some presets reject extra fields — retry once with the minimal documented body.
    if ((err as { status?: number }).status === 400 && isPreset) {
      json = await postJson("https://api.perplexity.ai/v1/agent", headers, { preset: model, input: req.prompt }, "Perplexity");
    } else throw err;
  }
  const text = stripCitationMarkers(parseResponsesOutput(json, cites, fanouts));
  emptyGuard(text, "Perplexity");
  const usage = obj(json.usage);
  const searches = num(obj(obj(usage.tool_calls_details).search_web).invocation) ?? 1;
  const costUsd = estimate("perplexity", num(usage.input_tokens) ?? 0, num(usage.output_tokens) ?? 0, searches);
  await track(req, "perplexity", str(json.model) ?? model, costUsd, (num(usage.total_tokens) ?? 0) as number);
  return {
    text,
    citations: cites.list,
    fanouts: uniqueStrings(fanouts),
    shopping: [],
    ads: [],
    model: str(json.model) ?? `perplexity-${model}`,
    provider: "api",
    costUsd,
    raw: trimRaw({ endpoint: "perplexity/agent", usage }),
  };
}

/* ───────────────────────────── Gemini ───────────────────────────── */

const geminiModelCache: { id: string | null; at: number } = { id: null, at: 0 };

/** Latest stable "gemini-X-flash" model that supports generateContent (cached 24h). */
async function geminiDefaultModel(apiKey: string): Promise<string> {
  if (geminiModelCache.id && Date.now() - geminiModelCache.at < 24 * 3600_000) return geminiModelCache.id;
  let picked = "gemini-2.5-flash";
  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {
      headers: { "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (res.ok) {
      const json = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
      const ids = (json.models ?? [])
        .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
        .map((m) => m.name.replace(/^models\//, ""))
        .filter((id) => /^gemini-\d+(\.\d+)?-flash$/.test(id))
        .sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
      if (ids[0]) picked = ids[0];
    }
  } catch {
    // keep fallback
  }
  geminiModelCache.id = picked;
  geminiModelCache.at = Date.now();
  return picked;
}

/** Grounding chunk URIs are Google redirect links — resolve them to the real page (best effort). */
async function resolveRedirect(uri: string, title: string | null): Promise<string> {
  if (!/vertexaisearch\.cloud\.google\.com|grounding-api-redirect/.test(uri)) return uri;
  try {
    const res = await fetch(uri, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(6_000), cache: "no-store" });
    const loc = res.headers.get("location");
    await res.body?.cancel().catch(() => {});
    if (loc && /^https?:\/\//.test(loc)) return loc;
  } catch {
    // fall through
  }
  // The chunk title carries the domain when the redirect cannot be followed.
  return title && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(title) ? `https://${title}` : uri;
}

async function geminiAnswer(req: AnswerRequest, apiKey: string, modelOverride: string): Promise<AnswerResult> {
  const model = modelOverride || (await geminiDefaultModel(apiKey));
  const json = await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    { "x-goog-api-key": apiKey },
    {
      systemInstruction: { parts: [{ text: localeHint(req) }] },
      contents: [{ role: "user", parts: [{ text: req.prompt }] }],
      tools: [{ google_search: {} }],
    },
    "Gemini",
  );
  const cand = obj(arr(json.candidates)[0]);
  const finish = str(cand.finishReason);
  if (finish === "SAFETY" || finish === "PROHIBITED_CONTENT") throw new Error("Gemini blocked this prompt (safety).");
  const text = arr(obj(cand.content).parts)
    .map((p) => str(obj(p).text) ?? "")
    .join("")
    .trim();
  emptyGuard(text, "Gemini");
  const gm = obj(cand.groundingMetadata);
  const chunks = arr(gm.groundingChunks)
    .map((c) => obj(obj(c).web))
    .filter((w) => str(w.uri));
  const resolved = await Promise.all(chunks.slice(0, 30).map((w) => resolveRedirect(str(w.uri)!, str(w.title))));
  const cites = new CitationCollector();
  resolved.forEach((url, i) => {
    const title = str(chunks[i]!.title);
    // Titles are usually just the domain — only keep them when they add information.
    cites.add(url, title && title !== hostOf(url) ? title : null);
  });
  const queries = uniqueStrings(arr(gm.webSearchQueries));
  const usage = obj(json.usageMetadata);
  const inTok = (num(usage.promptTokenCount) ?? 0) + (num(usage.toolUsePromptTokenCount) ?? 0);
  const outTok = (num(usage.candidatesTokenCount) ?? 0) + (num(usage.thoughtsTokenCount) ?? 0);
  const costUsd = estimate("gemini", inTok, outTok, Math.max(1, queries.length));
  const finalModel = str(json.modelVersion) ?? model;
  await track(req, "gemini", finalModel, costUsd, inTok + outTok);
  return {
    text,
    citations: cites.list,
    fanouts: queries,
    shopping: [],
    ads: [],
    model: finalModel,
    provider: "api",
    costUsd,
    raw: trimRaw({ endpoint: "gemini/generateContent", usage, finishReason: finish }),
  };
}

/* ───────────────────────────── xAI (Grok) ───────────────────────────── */

async function grokAnswer(req: AnswerRequest, apiKey: string, model: string): Promise<AnswerResult> {
  const json = await postJson(
    "https://api.x.ai/v1/responses",
    { Authorization: `Bearer ${apiKey}` },
    {
      model,
      instructions: localeHint(req),
      input: [{ role: "user", content: req.prompt }],
      tools: [{ type: "web_search" }, { type: "x_search" }],
      include: ["no_inline_citations", "web_search_call.action.sources"],
    },
    "xAI",
  );
  const cites = new CitationCollector();
  const fanouts: string[] = [];
  const text = parseResponsesOutput(json, cites, fanouts);
  for (const u of arr(json.citations)) cites.add(typeof u === "string" ? u : obj(u).url, null);
  emptyGuard(text, "Grok");
  const usage = obj(json.usage);
  const searches = num(obj(usage.server_side_tool_usage_details).web_search_calls) ?? num(usage.num_server_side_tools_used) ?? 1;
  const costUsd = estimate("xai", num(usage.input_tokens) ?? 0, num(usage.output_tokens) ?? 0, searches);
  const finalModel = str(json.model) ?? model;
  await track(req, "xai", finalModel, costUsd, (num(usage.input_tokens) ?? 0) + (num(usage.output_tokens) ?? 0));
  return {
    text,
    citations: cites.list,
    fanouts: uniqueStrings(fanouts),
    shopping: [],
    ads: [],
    model: finalModel,
    provider: "api",
    costUsd,
    raw: trimRaw({ endpoint: "xai/responses", usage }),
  };
}

/* ───────────────────────────── Mistral ───────────────────────────── */

async function mistralAnswer(req: AnswerRequest, apiKey: string, model: string): Promise<AnswerResult> {
  const json = await postJson(
    "https://api.mistral.ai/v1/conversations",
    { Authorization: `Bearer ${apiKey}` },
    {
      model,
      inputs: req.prompt,
      instructions: localeHint(req),
      tools: [{ type: "web_search" }],
      store: false,
    },
    "Mistral",
  );
  const cites = new CitationCollector();
  const fanouts: string[] = [];
  const parts: string[] = [];
  for (const o of arr(json.outputs)) {
    const out = obj(o);
    if (out.type === "tool.execution") {
      try {
        const args = typeof out.arguments === "string" ? (JSON.parse(out.arguments) as Record<string, unknown>) : obj(out.arguments);
        fanouts.push(...uniqueStrings([args.query, ...arr(args.queries)]));
      } catch {
        // arguments are not documented — ignore
      }
    } else if (out.type === "message.output") {
      if (typeof out.content === "string") parts.push(out.content);
      for (const c of arr(out.content)) {
        const chunk = obj(c);
        if (chunk.type === "text") parts.push(str(chunk.text) ?? "");
        else if (chunk.type === "tool_reference") {
          cites.add(chunk.url, chunk.title);
          // Keep a visible reference marker position-neutral: nothing appended to text.
        }
      }
    }
  }
  const text = parts.join("").trim();
  emptyGuard(text, "Mistral");
  const usage = obj(json.usage);
  const searches = num(obj(usage.connectors).web_search) ?? (fanouts.length || 1);
  const costUsd = estimate("mistral", num(usage.prompt_tokens) ?? 0, num(usage.completion_tokens) ?? 0, searches);
  await track(req, "mistral", model, costUsd, (num(usage.total_tokens) ?? 0) as number);
  return {
    text,
    citations: cites.list,
    fanouts: uniqueStrings(fanouts),
    shopping: [],
    ads: [],
    model,
    provider: "api",
    costUsd,
    raw: trimRaw({ endpoint: "mistral/conversations", usage }),
  };
}

/* ───────────────────────────── DeepSeek ───────────────────────────── */

async function deepseekAnswer(req: AnswerRequest, apiKey: string, model: string): Promise<AnswerResult> {
  const json = await postJson(
    "https://api.deepseek.com/chat/completions",
    { Authorization: `Bearer ${apiKey}` },
    {
      model,
      messages: [
        { role: "system", content: localeHint(req) },
        { role: "user", content: req.prompt },
      ],
    },
    "DeepSeek",
  );
  const text = str(obj(obj(arr(json.choices)[0]).message).content) ?? "";
  emptyGuard(text, "DeepSeek");
  const usage = obj(json.usage);
  const costUsd = estimate("deepseek", num(usage.prompt_tokens) ?? 0, num(usage.completion_tokens) ?? 0, 0);
  const finalModel = str(json.model) ?? model;
  await track(req, "deepseek", finalModel, costUsd, (num(usage.total_tokens) ?? 0) as number);
  // DeepSeek's API answers from model knowledge only (no web search → no citations).
  return { text, citations: [], fanouts: [], shopping: [], ads: [], model: finalModel, provider: "api", costUsd, raw: trimRaw({ endpoint: "deepseek/chat", usage }) };
}

/* ───────────────────────────── Dispatcher ───────────────────────────── */

export async function answerViaApi(req: AnswerRequest, modelOverride?: string): Promise<AnswerResult> {
  const ai = await getSetting("ai");
  const m = modelOverride?.trim() || "";
  const need = (key: string, vendor: string) => {
    if (!key) throw new EngineUnavailableError(`Add a ${vendor} API key in Admin → AI Providers.`, "not_configured");
    return key;
  };
  switch (req.engine) {
    case "chatgpt":
      return openaiAnswer(req, need(ai.openaiApiKey, "OpenAI"), m || ai.openaiModel || "gpt-5");
    case "claude":
      return anthropicAnswer(req, need(ai.anthropicApiKey, "Anthropic"), m || ai.anthropicModel || "claude-opus-5");
    case "perplexity":
      return perplexityAnswer(req, need(ai.perplexityApiKey, "Perplexity"), m || "fast");
    case "gemini":
      return geminiAnswer(req, need(ai.geminiApiKey, "Google Gemini"), m);
    case "grok":
      return grokAnswer(req, need(ai.xaiApiKey, "xAI"), m || "grok-4.7");
    case "mistral":
      return mistralAnswer(req, need(ai.mistralApiKey, "Mistral"), m || "mistral-medium-latest");
    case "deepseek":
      return deepseekAnswer(req, need(ai.deepseekApiKey, "DeepSeek"), m || "deepseek-flash");
    default:
      throw new EngineUnavailableError(`There is no direct API for ${req.engine}.`, "unsupported");
  }
}
