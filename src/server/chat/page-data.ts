import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { competitors } from "@/server/db/schema";
import type { ProjectContext } from "@/server/auth/context";
import { getCountry } from "@/lib/countries";
import type { ExampleContext } from "@/features/chat/lib/examples";
import type { ModelOptionsView } from "@/features/chat/types";
import { getAvailability, getModelOptions, providerLabel } from "./models";

export type AgentPageData = {
  userName: string;
  canChat: boolean;
  modelOptions: ModelOptionsView;
  examples: ExampleContext;
  routeHint: string;
};

function firstName(ctx: ProjectContext): string {
  const name = ctx.user.name?.trim();
  if (name) return name.split(/\s+/)[0]!;
  return ctx.user.email.split("@")[0]!.replace(/[._-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Everything the Agent home / conversation pages need besides the messages. */
export async function getAgentPageData(ctx: ProjectContext): Promise<AgentPageData> {
  const p = ctx.project;
  const [modelOptions, avail, comps] = await Promise.all([
    getModelOptions({
      workspaceId: p.workspaceId,
      userId: ctx.user.id,
      isAdmin: ctx.isInstanceAdmin,
      canManageAgents: ctx.permissions.has("agents.manage"),
    }),
    getAvailability(p.workspaceId, ctx.user.id),
    db
      .select({ name: competitors.name })
      .from(competitors)
      .where(and(eq(competitors.projectId, p.id), eq(competitors.tracked, true)))
      .orderBy(asc(competitors.createdAt))
      .limit(5),
  ]);
  const agentOnline = avail.agentsEnabled && (avail.claudeOnline || avail.codexOnline);
  const api = avail.fallbackOrder.find((k) => avail.keys[k]);
  let routeHint: string;
  if (agentOnline && avail.preferLocalAgent) {
    routeHint = `Answers run on your local ${avail.claudeOnline ? "Claude Code" : "Codex"} agent with every AutoSEO tool${api ? ` — ${providerLabel(api)} as fallback` : ""}.`;
  } else if (api) {
    routeHint = avail.agentInstalled
      ? `Your local agent is offline — answers use the ${providerLabel(api)} with every AutoSEO tool.`
      : `Answers use the ${providerLabel(api)} with every AutoSEO tool. Install a local agent to use Claude Code / Codex with your own subscription.`;
  } else {
    routeHint = avail.agentInstalled
      ? "Start your local agent (Claude Code / Codex) or ask an admin to add an API key in Admin → AI Providers to start chatting."
      : "Install a local agent (Claude Code / Codex) or ask an admin to add an API key in Admin → AI Providers to start chatting.";
  }
  const country = getCountry(p.country);
  return {
    userName: firstName(ctx),
    canChat: ctx.permissions.has("prompts.manage"),
    modelOptions,
    examples: { name: p.name, domain: p.domain, competitors: comps.map((c) => c.name), market: country?.name ?? p.country },
    routeHint,
  };
}
