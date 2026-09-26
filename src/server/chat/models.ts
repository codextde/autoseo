import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { agents } from "@/server/db/schema";
import { getSetting } from "@/server/settings";
import { hasOnlineOwnAgent } from "@/server/agents/dispatch";
import type { ModelOption, ModelOptionsView, ModelSelection } from "@/features/chat/types";

export type ApiProvider = "anthropic" | "openai" | "openrouter";

export type RoutePlan =
  | { kind: "auto" }
  | { kind: "agent"; runtime: "claude" | "codex" }
  | { kind: "api"; provider: ApiProvider };

export const MODEL_SELECTIONS = ["auto", "agent:claude", "agent:codex", "api:anthropic", "api:openai", "api:openrouter"] as const;

export function parseSelection(sel: string | null | undefined): RoutePlan {
  switch (sel) {
    case "agent:claude":
      return { kind: "agent", runtime: "claude" };
    case "agent:codex":
      return { kind: "agent", runtime: "codex" };
    case "api:anthropic":
    case "api:openai":
    case "api:openrouter":
      return { kind: "api", provider: sel.slice(4) as ApiProvider };
    default:
      return { kind: "auto" };
  }
}

/** Approximate list prices (USD per 1M input / output tokens) — for estimates only. */
const PRICES: Record<string, [number, number]> = {
  "claude-fable-5-1": [10, 50],
  "claude-fable-5": [10, 50],
  "claude-opus-5-5": [4, 20],
  "claude-opus-5": [5, 25],
  "claude-opus-4-8": [5, 25],
  "claude-sonnet-5": [2, 10],
  "claude-haiku-4-5": [1, 5],
};

export function modelPrice(model: string): [number, number] | null {
  const bare = model.replace(/^anthropic\//, "");
  return PRICES[bare] ?? null;
}

export function estimateCostUsd(model: string, u: { input: number; output: number; cacheRead?: number; cacheWrite?: number; searches?: number }): number {
  const [inP, outP] = modelPrice(model) ?? [5, 25];
  const cost = u.input * inP + (u.cacheWrite ?? 0) * inP * 1.25 + (u.cacheRead ?? 0) * inP * 0.1 + u.output * outP;
  return cost / 1_000_000 + (u.searches ?? 0) * 0.01;
}

function priceHint(model: string): string | null {
  const p = modelPrice(model);
  return p ? `$${p[0]} / $${p[1]} per 1M tokens` : "Billed per token by the provider";
}

export type Availability = {
  agentsEnabled: boolean;
  preferLocalAgent: boolean;
  /** The requesting user has at least one enabled local agent in this workspace. */
  agentInstalled: boolean;
  /** Chat runs only on the requesting user's own agent: is one online (per runtime)? */
  claudeOnline: boolean;
  codexOnline: boolean;
  keys: Record<ApiProvider, boolean>;
  models: Record<ApiProvider, string>;
  fallbackOrder: ApiProvider[];
};

/** Whether the user has any enabled local agent in this workspace (to tell "install" from "start" apart). */
async function hasOwnAgent(workspaceId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.workspaceId, workspaceId), eq(agents.userId, userId), eq(agents.enabled, true)))
    .limit(1);
  return !!row;
}

export async function getAvailability(workspaceId: string, userId: string): Promise<Availability> {
  const [ai, agentSettings] = await Promise.all([getSetting("ai"), getSetting("agents")]);
  const [installed, claude, codex] = agentSettings.enabled
    ? await Promise.all([
        hasOwnAgent(workspaceId, userId),
        hasOnlineOwnAgent({ userId, workspaceId, kind: "chat", runtime: "claude" }),
        hasOnlineOwnAgent({ userId, workspaceId, kind: "chat", runtime: "codex" }),
      ])
    : [false, false, false];
  const own = { installed, claude, codex };
  return {
    agentsEnabled: agentSettings.enabled,
    preferLocalAgent: ai.preferLocalAgent,
    agentInstalled: own.installed,
    claudeOnline: own.claude,
    codexOnline: own.codex,
    keys: { anthropic: !!ai.anthropicApiKey, openai: !!ai.openaiApiKey, openrouter: !!ai.openrouterApiKey },
    models: { anthropic: ai.anthropicModel, openai: ai.openaiModel, openrouter: ai.openrouterModel },
    fallbackOrder: ai.fallbackOrder,
  };
}

/** Status line of a local runtime option in the model picker. */
function localStatus(a: Availability, online: boolean, name: string): string {
  if (!a.agentsEnabled) return "Local agents are disabled on this instance";
  if (online) return "Your agent is online";
  if (!a.agentInstalled) return `Install a local agent to use ${name}`;
  return `Your local agent is offline or has no ${name}`;
}

const PROVIDER_LABEL: Record<ApiProvider, string> = { anthropic: "Anthropic API", openai: "OpenAI API", openrouter: "OpenRouter" };

export function providerLabel(p: string): string {
  if (p === "claude") return "Claude Code";
  if (p === "codex") return "Codex";
  return PROVIDER_LABEL[p as ApiProvider] ?? p;
}

export async function getModelOptions(input: { workspaceId: string; userId: string; isAdmin: boolean; canManageAgents: boolean }): Promise<ModelOptionsView> {
  const a = await getAvailability(input.workspaceId, input.userId);
  const agentOnline = a.agentsEnabled && (a.claudeOnline || a.codexOnline);
  const firstApi = a.fallbackOrder.find((p) => a.keys[p]);

  let autoStatus: string;
  if (agentOnline && a.preferLocalAgent) {
    autoStatus = `Your local agent is online (${a.claudeOnline ? "Claude Code" : "Codex"})${firstApi ? ` · falls back to ${PROVIDER_LABEL[firstApi]}` : ""}`;
  } else if (firstApi) {
    const why = agentOnline ? "API preferred" : a.agentInstalled ? "Your local agent is offline" : "Install a local agent to use Claude Code / Codex";
    autoStatus = `${why} · using ${PROVIDER_LABEL[firstApi]}`;
  } else {
    autoStatus = a.agentInstalled ? "Your local agent is offline and no API key is configured" : "Install a local agent or add an API key";
  }

  const options: ModelOption[] = [
    {
      id: "auto",
      label: "Auto",
      description: "Your local agent first, API providers as fallback",
      group: "auto",
      available: (agentOnline && a.preferLocalAgent) || !!firstApi,
      status: autoStatus,
      price: null,
    },
    {
      id: "agent:claude",
      label: "Claude Code",
      description: "Runs on your machine with AutoSEO + your MCP servers",
      group: "local",
      available: a.agentsEnabled && a.claudeOnline,
      status: localStatus(a, a.claudeOnline, "Claude Code"),
      price: "Free · uses your Claude subscription",
    },
    {
      id: "agent:codex",
      label: "Codex",
      description: "Runs on your machine with AutoSEO + your MCP servers",
      group: "local",
      available: a.agentsEnabled && a.codexOnline,
      status: localStatus(a, a.codexOnline, "Codex"),
      price: "Free · uses your ChatGPT subscription",
    },
  ];
  for (const p of ["anthropic", "openai", "openrouter"] as ApiProvider[]) {
    options.push({
      id: `api:${p}`,
      label: PROVIDER_LABEL[p],
      description: a.keys[p] ? a.models[p] : "Server-side tool loop over the AutoSEO tools",
      group: "api",
      available: a.keys[p],
      status: a.keys[p] ? "API key configured" : "No API key configured",
      model: a.models[p],
      price: a.keys[p] ? priceHint(a.models[p]) : null,
    });
  }
  const manage: ModelOptionsView["manage"] = [];
  if (input.isAdmin) manage.push({ label: "AI Providers", href: "/admin/ai" });
  if (input.canManageAgents || input.isAdmin) manage.push({ label: "Local Agents", href: "/agents" });
  return { options, defaultSelection: "auto", manage };
}

export function isValidSelection(sel: string): sel is ModelSelection {
  return (MODEL_SELECTIONS as readonly string[]).includes(sel);
}
