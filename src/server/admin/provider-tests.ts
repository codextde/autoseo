import "server-only";
import { getSetting } from "@/server/settings";
import { runLlm } from "@/server/ai/llm";
import { hasOnlineAgent } from "@/server/agents/dispatch";
import { dfsUserData } from "@/server/dataforseo/client";

export const AI_KEY_PROVIDERS = [
  "anthropic",
  "openai",
  "openrouter",
  "perplexity",
  "gemini",
  "xai",
  "mistral",
  "deepseek",
] as const;
export type AiKeyProvider = (typeof AI_KEY_PROVIDERS)[number];

export type TestResult = { ok: boolean; message: string; detail?: string; latencyMs?: number };

const KEY_FIELD: Record<AiKeyProvider, string> = {
  anthropic: "anthropicApiKey",
  openai: "openaiApiKey",
  openrouter: "openrouterApiKey",
  perplexity: "perplexityApiKey",
  gemini: "geminiApiKey",
  xai: "xaiApiKey",
  mistral: "mistralApiKey",
  deepseek: "deepseekApiKey",
};

async function timedFetch(url: string, init: RequestInit, timeoutMs = 20_000) {
  const started = Date.now();
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  return { res, ms: Date.now() - started };
}

async function errorText(res: Response) {
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
      if (typeof j.error === "string") return j.error;
      return j.error?.message ?? j.message ?? text.slice(0, 300);
    } catch {
      return text.slice(0, 300);
    }
  } catch {
    return `HTTP ${res.status}`;
  }
}

/**
 * Checks one AI provider key. Anthropic/OpenAI/OpenRouter (the LLM fallback providers) run a tiny
 * completion with the configured model; engine-only providers verify the key against their
 * model listing endpoint (free).
 */
export async function testAiProvider(provider: AiKeyProvider): Promise<TestResult> {
  const ai = (await getSetting("ai")) as Record<string, unknown>;
  const key = String(ai[KEY_FIELD[provider]] ?? "");
  if (!key) return { ok: false, message: "No API key saved for this provider." };
  try {
    switch (provider) {
      case "anthropic": {
        const model = String(ai.anthropicModel);
        const { res, ms } = await timedFetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model, max_tokens: 16, messages: [{ role: "user", content: "Reply with the word OK." }] }),
        });
        if (!res.ok) return { ok: false, message: `Anthropic rejected the request (${res.status}).`, detail: await errorText(res) };
        return { ok: true, message: `Key valid · ${model} answered`, latencyMs: ms };
      }
      case "openai":
      case "openrouter": {
        const model = String(provider === "openai" ? ai.openaiModel : ai.openrouterModel);
        const base = provider === "openai" ? "https://api.openai.com/v1" : "https://openrouter.ai/api/v1";
        const { res, ms } = await timedFetch(`${base}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify({ model, max_completion_tokens: 16, messages: [{ role: "user", content: "Reply with the word OK." }] }),
        });
        if (!res.ok) return { ok: false, message: `${provider === "openai" ? "OpenAI" : "OpenRouter"} rejected the request (${res.status}).`, detail: await errorText(res) };
        return { ok: true, message: `Key valid · ${model} answered`, latencyMs: ms };
      }
      case "perplexity": {
        const { res, ms } = await timedFetch("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify({ model: "sonar", max_tokens: 8, messages: [{ role: "user", content: "Reply with OK." }] }),
        });
        if (!res.ok) return { ok: false, message: `Perplexity rejected the request (${res.status}).`, detail: await errorText(res) };
        return { ok: true, message: "Key valid · sonar answered", latencyMs: ms };
      }
      case "gemini": {
        const { res, ms } = await timedFetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=5", {
          headers: { "x-goog-api-key": key },
        });
        if (!res.ok) return { ok: false, message: `Gemini rejected the key (${res.status}).`, detail: await errorText(res) };
        return { ok: true, message: "Key valid", latencyMs: ms };
      }
      case "xai":
      case "mistral":
      case "deepseek": {
        const url = {
          xai: "https://api.x.ai/v1/models",
          mistral: "https://api.mistral.ai/v1/models",
          deepseek: "https://api.deepseek.com/models",
        }[provider];
        const { res, ms } = await timedFetch(url, { headers: { Authorization: `Bearer ${key}` } });
        if (!res.ok) return { ok: false, message: `The provider rejected the key (${res.status}).`, detail: await errorText(res) };
        const json = (await res.json().catch(() => ({}))) as { data?: unknown[] };
        return { ok: true, message: `Key valid${json.data ? ` · ${json.data.length} models available` : ""}`, latencyMs: ms };
      }
    }
  } catch (err) {
    return { ok: false, message: "Could not reach the provider.", detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * End-to-end check of the LLM router. Agent tests run in the admin's workspace (agents of a
 * workspace, or ones an admin marked as shared, may take the job — instance-level jobs without a
 * workspace only go to shared agents).
 */
export async function testLlmRouting(
  route: "api" | "agent",
  scope: { workspaceId: string | null; workspaceName?: string | null; userId: string },
): Promise<TestResult> {
  const started = Date.now();
  if (route === "agent" && !(await hasOnlineAgent("any", { workspaceId: scope.workspaceId, kind: "llm" }).catch(() => false))) {
    return {
      ok: false,
      message: scope.workspaceId
        ? `No local agent is online for ${scope.workspaceName ? `“${scope.workspaceName}”` : "your workspace"}.`
        : "No shared local agent is online.",
      detail: "Install or start an agent in Admin → Local Agents (or mark one as shared), then try again.",
    };
  }
  try {
    const res = await runLlm({
      purpose: "admin.connection_test",
      prompt: "This is a connection test. Reply with the single word OK.",
      route,
      maxTokens: 32,
      timeoutMs: route === "agent" ? 60_000 : 30_000,
      workspaceId: scope.workspaceId,
      userId: scope.userId,
    });
    return {
      ok: true,
      message: `${res.provider === "agent" ? "Local agent" : res.provider} answered with ${res.model}`,
      detail: res.text.slice(0, 200),
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return { ok: false, message: route === "agent" ? "No local agent answered." : "The AI router failed.", detail: err instanceof Error ? err.message : String(err) };
  }
}

export async function localAgentOnline(): Promise<boolean> {
  try {
    return await hasOnlineAgent("any");
  } catch {
    return false;
  }
}

export async function testDataForSeo(): Promise<TestResult & { balance?: number; login?: string }> {
  const started = Date.now();
  try {
    const data = await dfsUserData();
    if (!data) return { ok: false, message: "Login and password are required." };
    return {
      ok: true,
      message: `Connected as ${data.login}`,
      balance: data.balance,
      login: data.login,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return { ok: false, message: "DataForSEO rejected the connection.", detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Checks a Google PageSpeed Insights key with a tiny request. */
export async function testPageSpeedKey(): Promise<TestResult> {
  const google = await getSetting("google");
  if (!google.pagespeedApiKey) return { ok: false, message: "No PageSpeed API key saved." };
  try {
    const { res, ms } = await timedFetch(
      `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent("https://example.com")}&category=performance&strategy=mobile&key=${encodeURIComponent(google.pagespeedApiKey)}`,
      {},
      60_000,
    );
    if (!res.ok) return { ok: false, message: `Google rejected the key (${res.status}).`, detail: await errorText(res) };
    return { ok: true, message: "Key valid", latencyMs: ms };
  } catch (err) {
    return { ok: false, message: "Could not reach Google.", detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Verifies a Cloudflare API token via the token verify endpoint. */
export async function testCloudflareToken(): Promise<TestResult> {
  const s = await getSetting("integrations");
  if (!s.cloudflareApiToken) return { ok: false, message: "No Cloudflare API token saved." };
  try {
    const { res, ms } = await timedFetch("https://api.cloudflare.com/client/v4/user/tokens/verify", {
      headers: { Authorization: `Bearer ${s.cloudflareApiToken}` },
    });
    const json = (await res.json().catch(() => ({}))) as { success?: boolean; result?: { status?: string }; errors?: { message: string }[] };
    if (!res.ok || !json.success) return { ok: false, message: "Cloudflare rejected the token.", detail: json.errors?.[0]?.message };
    return { ok: true, message: `Token ${json.result?.status ?? "valid"}`, latencyMs: ms };
  } catch (err) {
    return { ok: false, message: "Could not reach Cloudflare.", detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Bing Webmaster API key check (lists the user's sites). */
export async function testBingKey(): Promise<TestResult> {
  const s = await getSetting("integrations");
  if (!s.bingWebmasterApiKey) return { ok: false, message: "No Bing Webmaster API key saved." };
  try {
    const { res, ms } = await timedFetch(
      `https://ssl.bing.com/webmaster/api.svc/json/GetUserSites?apikey=${encodeURIComponent(s.bingWebmasterApiKey)}`,
      {},
    );
    if (!res.ok) return { ok: false, message: `Bing rejected the key (${res.status}).`, detail: await errorText(res) };
    const json = (await res.json().catch(() => ({}))) as { d?: unknown[] };
    return { ok: true, message: `Key valid${json.d ? ` · ${json.d.length} sites` : ""}`, latencyMs: ms };
  } catch (err) {
    return { ok: false, message: "Could not reach Bing.", detail: err instanceof Error ? err.message : String(err) };
  }
}
