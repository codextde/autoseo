import "server-only";
import { dispatchAgentLlm } from "@/server/agents/dispatch";
import { getEngine } from "@/lib/engines";
import { getSetting } from "@/server/settings";
import { recordUsage } from "@/server/usage";
import type { AnswerRequest, AnswerResult } from "./types";
import { EngineUnavailableError } from "./types";
import { CitationCollector, countryName, trimRaw } from "./util";

/**
 * Local agent (Claude Code / Codex CLI on a user's machine) emulating a consumer AI assistant
 * with web search. Returns null from dispatch when no agent is online → EngineUnavailableError.
 */
export async function answerViaAgent(req: AnswerRequest): Promise<AnswerResult> {
  const engine = getEngine(req.engine);
  if (!engine?.agentRuntime) throw new EngineUnavailableError(`No local agent can emulate ${req.engine}.`, "unsupported");
  const agents = await getSetting("agents");
  if (!agents.enabled) throw new EngineUnavailableError("Local agents are disabled in Admin → Local Agents.", "agent_offline");
  const ai = await getSetting("ai");
  const product = engine.id === "claude" ? "Claude (claude.ai)" : "ChatGPT (chatgpt.com)";
  const system = `You are answering exactly like the consumer product ${product} would answer a regular user, with web search enabled.
The user is located in ${countryName(req.country)}; answer in the language of the question.
Search the web for current information, then write a helpful, natural answer in markdown (the way ${product} formats answers: short intro, headings or lists where useful, concrete recommendations with brand/product names when the question asks for them).
Do not mention that you are an agent, a CLI or that you are emulating anything.
At the very end add a line "Sources:" followed by one markdown bullet per source URL you used ("- [Title](https://…)").`;
  const started = Date.now();
  const res = await dispatchAgentLlm({
    purpose: "ai_tracking_answer",
    system,
    prompt: req.prompt,
    webSearch: true,
    runtime: engine.agentRuntime,
    timeoutMs: Math.max(60_000, ai.agentTimeoutSeconds * 1000),
    projectId: req.project.id,
    workspaceId: req.project.workspaceId,
    userId: req.userId ?? null,
  });
  if (!res) {
    const cli = engine.agentRuntime === "claude" ? "Claude Code" : "Codex";
    throw new EngineUnavailableError(`No local ${cli} agent answered (none online or it timed out).`, "agent_offline");
  }
  const cites = new CitationCollector();
  for (const c of res.citations ?? []) cites.add(c.url, c.title ?? null);
  // Split the trailing "Sources:" list off the answer and use it as citations.
  let text = res.text.trim();
  const m = text.match(/\n+\**Sources:?\**\s*\n([\s\S]*)$/i);
  if (m) {
    for (const line of m[1]!.split("\n")) {
      const link = line.match(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/) ?? line.match(/()(https?:\/\/\S+)/);
      if (link) cites.add(link[2], link[1] || null);
    }
    text = text.slice(0, m.index).trim();
  }
  if (!text) throw new EngineUnavailableError("The local agent returned an empty answer.", "no_answer");
  await recordUsage({
    provider: "local_agent",
    feature: "ai_tracking",
    endpoint: `${req.engine}:${res.runtime}`,
    projectId: req.project.id,
    workspaceId: req.project.workspaceId,
    userId: req.userId ?? null,
    meta: { agentId: res.agentId, jobId: res.jobId, durationMs: res.durationMs ?? Date.now() - started },
  });
  return {
    text,
    citations: cites.list,
    fanouts: [],
    shopping: [],
    ads: [],
    model: res.model ?? res.runtime,
    provider: "agent",
    costUsd: 0,
    raw: trimRaw({ endpoint: "local_agent", runtime: res.runtime, agentId: res.agentId, jobId: res.jobId }),
  };
}
