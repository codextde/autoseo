import "server-only";
import { ENGINES, getEngine, type EngineId, type EngineInfo, type EngineProvider } from "@/lib/engines";
import { getSetting } from "@/server/settings";
import { isDataForSeoConfigured } from "@/server/dataforseo/client";
import { hasOnlineAgent } from "@/server/agents/dispatch";

export type EngineStatus = "configured" | "needs_key" | "needs_dataforseo" | "needs_agent" | "disabled";

export type EngineAvailability = {
  id: EngineId;
  name: string;
  vendor: string;
  /** Admin choice for this engine (auto / specific provider / disabled). */
  setting: "auto" | EngineProvider | "disabled";
  /** Provider that will answer prompts (null when none is usable). */
  provider: EngineProvider | null;
  configured: boolean;
  status: EngineStatus;
  reason: string;
  /** Where an admin fixes it. */
  adminHref: string;
  /** Providers the engine supports and whether each one is usable right now. */
  providers: { provider: EngineProvider; configured: boolean; reason: string }[];
};

type ProviderCheck = { configured: boolean; reason: string; status: EngineStatus; adminHref: string };

const PROVIDER_LABEL: Record<EngineProvider, string> = {
  dataforseo: "DataForSEO",
  api: "Direct API",
  agent: "Local agent",
};

export function providerLabel(p: EngineProvider | null): string {
  return p ? PROVIDER_LABEL[p] : "—";
}

async function checkProvider(engine: EngineInfo, provider: EngineProvider, env: Awaited<ReturnType<typeof loadEnv>>): Promise<ProviderCheck> {
  if (provider === "dataforseo") {
    return env.dfs
      ? { configured: true, reason: "Answered via DataForSEO AI Optimization / SERP API.", status: "configured", adminHref: "/admin/data" }
      : { configured: false, reason: "Add DataForSEO credentials in Admin → Data Providers.", status: "needs_dataforseo", adminHref: "/admin/data" };
  }
  if (provider === "api") {
    const key = engine.apiKeySetting;
    if (!key) return { configured: false, reason: "No direct API for this engine.", status: "needs_key", adminHref: "/admin/ai" };
    return env.ai[key]
      ? { configured: true, reason: `Answered via the ${engine.vendor} API with web search.`, status: "configured", adminHref: "/admin/ai" }
      : { configured: false, reason: `Add a ${engine.vendor} API key in Admin → AI Providers.`, status: "needs_key", adminHref: "/admin/ai" };
  }
  // agent
  if (!engine.agentRuntime) return { configured: false, reason: "No local agent can emulate this engine.", status: "needs_agent", adminHref: "/admin/agents" };
  if (!env.agentsEnabled) return { configured: false, reason: "Local agents are disabled in Admin → Local Agents.", status: "needs_agent", adminHref: "/admin/agents" };
  const online = env.agentOnline.get(engine.agentRuntime) ?? false;
  const cli = engine.agentRuntime === "claude" ? "Claude Code" : "Codex";
  return online
    ? { configured: true, reason: `Answered by a local ${cli} agent with web search.`, status: "configured", adminHref: "/agents" }
    : { configured: false, reason: `Needs an online local agent running ${cli}.`, status: "needs_agent", adminHref: "/agents" };
}

async function loadEnv(workspaceId?: string | null) {
  const [ai, engines, agents, dfs] = await Promise.all([
    getSetting("ai"),
    getSetting("engines"),
    getSetting("agents"),
    isDataForSeoConfigured(),
  ]);
  const agentOnline = new Map<string, boolean>();
  if (agents.enabled) {
    const runtimes = [...new Set(ENGINES.map((e) => e.agentRuntime).filter((r): r is "claude" | "codex" => !!r))];
    const results = await Promise.all(runtimes.map((r) => hasOnlineAgent(r, { workspaceId: workspaceId ?? null }).catch(() => false)));
    runtimes.forEach((r, i) => agentOnline.set(r, results[i] ?? false));
  }
  return { ai, engines, agentsEnabled: agents.enabled, dfs, agentOnline };
}

function engineSetting(engines: Record<string, { provider: string; model: string } | undefined>, id: EngineId) {
  const s = engines[id];
  return { provider: (s?.provider ?? "auto") as EngineAvailability["setting"], model: s?.model ?? "" };
}

async function resolveOne(engine: EngineInfo, env: Awaited<ReturnType<typeof loadEnv>>): Promise<EngineAvailability> {
  const { provider: setting } = engineSetting(env.engines as Record<string, { provider: string; model: string }>, engine.id);
  const providers = await Promise.all(
    engine.providers.map(async (p) => {
      const c = await checkProvider(engine, p, env);
      return { provider: p, configured: c.configured, reason: c.reason, check: c };
    }),
  );
  const base = { id: engine.id, name: engine.name, vendor: engine.vendor, setting, providers: providers.map((p) => ({ provider: p.provider, configured: p.configured, reason: p.reason })) };

  if (setting === "disabled") {
    return { ...base, provider: null, configured: false, status: "disabled", reason: "Disabled by an admin in Admin → AI Providers.", adminHref: "/admin/ai" };
  }
  if (setting !== "auto") {
    const chosen = providers.find((p) => p.provider === setting);
    if (!chosen) {
      return {
        ...base,
        provider: null,
        configured: false,
        status: "disabled",
        reason: `${providerLabel(setting)} cannot answer ${engine.name}. Pick another provider in Admin → AI Providers.`,
        adminHref: "/admin/ai",
      };
    }
    return { ...base, provider: setting, configured: chosen.configured, status: chosen.check.status, reason: chosen.reason, adminHref: chosen.check.adminHref };
  }
  const first = providers.find((p) => p.configured);
  if (first) return { ...base, provider: first.provider, configured: true, status: "configured", reason: first.reason, adminHref: first.check.adminHref };
  // Nothing configured: report the most actionable requirement (first provider in preference order).
  const pref = providers[0]!;
  const alt = providers
    .slice(1)
    .map((p) => providerLabel(p.provider))
    .join(" or ");
  return {
    ...base,
    provider: null,
    configured: false,
    status: pref.check.status,
    reason: alt ? `${pref.reason} (alternatively: ${alt})` : pref.reason,
    adminHref: pref.check.adminHref,
  };
}

/**
 * Per engine: which provider answers, whether it is configured and why not.
 * Pass the workspace so local agents are only counted when they serve that workspace.
 */
export async function getEngineAvailability(opts: { workspaceId?: string | null } = {}): Promise<EngineAvailability[]> {
  const env = await loadEnv(opts.workspaceId);
  return Promise.all(ENGINES.map((e) => resolveOne(e, env)));
}

export async function getEngineAvailabilityFor(id: string, opts: { workspaceId?: string | null } = {}): Promise<EngineAvailability | null> {
  const engine = getEngine(id);
  if (!engine) return null;
  const env = await loadEnv(opts.workspaceId);
  return resolveOne(engine, env);
}

/** Model override configured by the admin for an engine ("" = provider default). */
export async function getEngineModelOverride(id: EngineId): Promise<string> {
  const engines = (await getSetting("engines")) as Record<string, { provider: string; model: string } | undefined>;
  return engines[id]?.model ?? "";
}
