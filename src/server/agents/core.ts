import "server-only";
import { db } from "@/server/db/client";
import { agentEvents, agents } from "@/server/db/schema";
import { randomToken, sha256 } from "@/server/crypto";
import type { Settings } from "@/server/settings";

export type AgentRow = typeof agents.$inferSelect;
export type AgentStatus = "pending" | "online" | "offline" | "updating" | "paused";
export type AgentEventLevel = "info" | "success" | "warning" | "error";

export const TOKEN_PREFIX = "asa_";

/** New agent token: shown once, only its SHA-256 is stored. Tokens never expire. */
export function newAgentToken(): { token: string; hash: string; prefix: string } {
  const token = `${TOKEN_PREFIX}${randomToken(32)}`;
  return { token, hash: hashAgentToken(token), prefix: token.slice(0, TOKEN_PREFIX.length + 6) };
}

export function hashAgentToken(token: string): string {
  return sha256(token.trim());
}

/** Seconds without any request after which an agent counts as offline. */
export function offlineAfterSeconds(settings: Settings<"agents">): number {
  return Math.max(45, settings.checkinIntervalSeconds * 3 + 15);
}

export function isAgentOnline(agent: Pick<AgentRow, "lastSeenAt">, settings: Settings<"agents">, now = Date.now()): boolean {
  if (!agent.lastSeenAt) return false;
  return now - agent.lastSeenAt.getTime() < offlineAfterSeconds(settings) * 1000;
}

export function agentStatus(
  agent: Pick<AgentRow, "lastSeenAt" | "firstCheckinAt" | "enabled" | "state">,
  settings: Settings<"agents">,
  now = Date.now(),
): AgentStatus {
  if (!agent.firstCheckinAt) return "pending";
  const online = isAgentOnline(agent, settings, now);
  if (!online) return "offline";
  if (agent.state === "updating") return "updating";
  if (!agent.enabled) return "paused";
  return "online";
}

export async function logAgentEvent(
  agentId: string,
  type: string,
  message: string,
  opts: { level?: AgentEventLevel; jobId?: string | null; meta?: Record<string, unknown>; actorId?: string | null } = {},
): Promise<void> {
  try {
    await db.insert(agentEvents).values({
      agentId,
      type,
      message,
      level: opts.level ?? "info",
      jobId: opts.jobId ?? null,
      meta: opts.meta ?? {},
      actorId: opts.actorId ?? null,
    });
  } catch (err) {
    console.error("[agents] failed to log event", type, err);
  }
}

/**
 * Auto mode: chat and agentic work (content generation, report agent, anything that should see the
 * machine's MCP servers) runs in Full mode; bulk structured analysis stays Lean. Callers can hint.
 */
const AGENTIC_PURPOSES = [/^chat\b/, /^agent[._]/, /^content\.(draft|write|rewrite|generate|brief)/, /^reports\.agent/];

export function autoJobMode(kind: string, purpose: string, hint?: "lean" | "full" | null): "lean" | "full" {
  if (hint) return hint;
  if (kind === "chat") return "full";
  if (kind === "test") return "lean";
  return AGENTIC_PURPOSES.some((re) => re.test(purpose)) ? "full" : "lean";
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}
