import "server-only";
import { dispatchAgentChat, type AgentChatEvent, type AgentRuntime } from "@/server/agents/dispatch";
import { createEphemeralApiKey, revokeApiKey } from "@/server/api/keys";
import type { ApiScope } from "@/features/api-settings/scopes";
import { env } from "@/server/env";
import { getSetting } from "@/server/settings";
import { displayToolName, isAutoseoTool } from "@/features/chat/lib/parts";
import { toolTitle } from "../tools";
import { agentRuntimeNote } from "../context";
import { ChatAbortedError, ProviderUnavailableError, type ProviderOutcome, type ProviderTurn } from "./types";

/**
 * Primary path: a fresh Claude Code / Codex session on the user's local agent, connected to the
 * AutoSEO MCP server with a short-lived token restricted to this project (plus the machine's own
 * MCP servers). Events are streamed back through the agents module.
 */

/**
 * CLI tool results arrive as plain strings: MCP structured content (JSON) or AutoSEO's
 * "markdown\n\n---\nJSON:\n{…}" format. Split them so the UI can render tables / summaries.
 */
function splitToolOutput(raw: string): { text: string; data?: unknown } {
  const out = raw ?? "";
  const marker = out.indexOf("\n\n---\nJSON:\n");
  const tryParse = (s: string): unknown => {
    const t = s.trim();
    if (!(t.startsWith("{") || t.startsWith("[")) || t.length > 60_000) return undefined;
    try {
      return JSON.parse(t);
    } catch {
      return undefined;
    }
  };
  if (marker !== -1) {
    const data = tryParse(out.slice(marker + 12));
    return { text: out.slice(0, marker).slice(0, 20_000), data };
  }
  const data = tryParse(out);
  if (data !== undefined) return { text: "", data };
  return { text: out.slice(0, 20_000) };
}

export type AgentTurnConfig = {
  runtime: AgentRuntime | "any";
  workspaceId: string;
  userId: string;
  projectId: string;
  projectName: string;
  scopes: ApiScope[];
};

export async function runAgentTurn(turn: ProviderTurn, cfg: AgentTurnConfig): Promise<ProviderOutcome> {
  const ai = await getSetting("ai");
  const agents = await getSetting("agents");
  const timeoutMs = Math.max(ai.agentTimeoutSeconds * 1000, agents.jobTimeoutMinutes * 60_000);
  let key: { id: string; token: string } | null = null;
  try {
    key = await createEphemeralApiKey({
      workspaceId: cfg.workspaceId,
      userId: cfg.userId,
      projectIds: [cfg.projectId],
      scopes: cfg.scopes,
      ttlMs: timeoutMs + 10 * 60_000,
      label: `Agent chat · ${cfg.projectName}`,
    });
  } catch (err) {
    console.error("[chat] could not mint the MCP token for the local agent", err);
  }
  try {
    return await streamAgentTurn(turn, cfg, timeoutMs, key?.token ?? null);
  } finally {
    // The session key is only needed while the CLI runs.
    if (key) await revokeApiKey(key.id).catch(() => null);
  }
}

async function streamAgentTurn(turn: ProviderTurn, cfg: AgentTurnConfig, timeoutMs: number, token: string | null): Promise<ProviderOutcome> {

  const last = turn.transcript[turn.transcript.length - 1];
  const system = `${turn.system.stable}\n\n${turn.system.project}\n${agentRuntimeNote(cfg.runtime === "any" ? "claude" : cfg.runtime, !!token)}`;
  const messages = turn.transcript
    .filter((m) => m.role === "user" || m.text.trim())
    .map((m) => ({
      role: m.role,
      content:
        m.role === "user" && m.attachments.length
          ? `${m.text}\n\n[Attached: ${m.attachments.map((a) => a.ref.name).join(", ")}]`
          : m.text,
    }));
  const attachments = (last?.attachments ?? []).map((a) => ({ name: a.ref.name, mimeType: a.ref.mimeType, dataBase64: a.data.toString("base64") }));

  turn.emit({ type: "status", phase: "connecting", text: "Looking for your local agent…" });
  const stream = await dispatchAgentChat(
    {
      purpose: "agent_chat",
      system,
      messages,
      runtime: cfg.runtime,
      mcp: token ? { url: `${env.appUrl}/api/mcp`, token } : null,
      attachments,
      webSearch: true,
      timeoutMs,
      projectId: cfg.projectId,
      workspaceId: cfg.workspaceId,
      userId: cfg.userId,
    },
    turn.signal,
  );
  if (!stream) {
    if (turn.signal.aborted) throw new ChatAbortedError();
    throw new ProviderUnavailableError("No local agent is online to answer.");
  }

  const startedAt = Date.now();
  let runtime: ProviderOutcome["runtime"] = { kind: "agent", provider: cfg.runtime === "any" ? "claude" : cfg.runtime };
  let produced = false;
  let text = "";
  let thinkingOpen = false;
  const closeThinking = () => {
    if (thinkingOpen) {
      thinkingOpen = false;
      turn.emit({ type: "thinking_end", at: Date.now() });
    }
  };

  for await (const ev of stream as AsyncIterable<AgentChatEvent>) {
    switch (ev.type) {
      case "status": {
        runtime = {
          kind: "agent",
          provider: ev.runtime ?? runtime.provider,
          agentId: ev.agentId ?? runtime.agentId ?? null,
          agentName: ev.agentName ?? runtime.agentName ?? null,
          model: runtime.model ?? null,
        };
        const who = ev.agentName ? ` on ${ev.agentName}` : "";
        const label =
          ev.status === "queued" ? "Waiting for your local agent…" : ev.status === "assigned" ? `Starting ${runtime.provider === "codex" ? "Codex" : "Claude Code"}${who}…` : `Running${who}`;
        turn.emit({ type: "status", phase: ev.status, text: label, runtime });
        break;
      }
      case "thinking":
        thinkingOpen = true;
        turn.emit({ type: "thinking", delta: ev.delta, at: Date.now() });
        break;
      case "text":
        closeThinking();
        if (ev.delta) {
          produced = true;
          text += ev.delta;
          turn.emit({ type: "text", delta: ev.delta });
        }
        break;
      case "tool_call": {
        closeThinking();
        produced = true;
        const name = displayToolName(ev.name);
        const ours = isAutoseoTool(ev.name);
        turn.emit({ type: "tool_call", id: ev.id, name, title: ours ? toolTitle(name) : undefined, input: ev.input, source: ours ? "autoseo" : "external", at: Date.now() });
        break;
      }
      case "tool_result": {
        const r = splitToolOutput(ev.output);
        turn.emit({ type: "tool_result", id: ev.id, output: r.text, data: r.data, isError: ev.isError, error: ev.isError ? ev.output.slice(0, 2000) : undefined, at: Date.now() });
        break;
      }
      case "done":
        closeThinking();
        if (!text.trim() && ev.text.trim()) turn.emit({ type: "text", delta: ev.text });
        runtime = { ...runtime, model: ev.model ?? runtime.model ?? null };
        return {
          runtime,
          usage: { durationMs: ev.durationMs || Date.now() - startedAt },
          costUsd: 0,
          units: 1,
        };
      case "error":
        closeThinking();
        if (turn.signal.aborted) throw new ChatAbortedError();
        if (!produced) throw new ProviderUnavailableError(ev.message);
        throw new Error(ev.message);
    }
  }
  if (turn.signal.aborted) throw new ChatAbortedError();
  throw new Error("The local agent stream ended unexpectedly.");
}
