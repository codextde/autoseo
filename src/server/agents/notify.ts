import "server-only";
import { EventEmitter } from "node:events";
import { rawSql } from "@/server/db/client";

/**
 * Tiny Postgres LISTEN/NOTIFY hub so long-polls and dispatchers wake up immediately when a job is
 * created, cancelled or finished (works across processes/replicas). Callers always combine it with
 * a periodic DB re-check, so a missed notification only costs latency.
 */
const CHANNEL = "autoseo_agents";

type Hub = { emitter: EventEmitter; listening: Promise<void> | null };

declare global {
  var __autoseoAgentHub: Hub | undefined;
}

function hub(): Hub {
  if (!globalThis.__autoseoAgentHub) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(0);
    globalThis.__autoseoAgentHub = { emitter, listening: null };
  }
  const h = globalThis.__autoseoAgentHub;
  if (!h.listening) {
    h.listening = rawSql
      .listen(CHANNEL, (payload) => h.emitter.emit("signal", payload))
      .then(() => undefined)
      .catch((err) => {
        console.error("[agents] LISTEN failed", err);
        h.listening = null;
      });
  }
  return h;
}

export type AgentSignal =
  | { type: "job-new" }
  | { type: "job-done"; jobId: string }
  | { type: "job-cancel"; jobId: string; agentId: string | null }
  | { type: "agent-changed"; agentId: string }
  | { type: "logs"; agentId: string }
  | { type: "chat"; jobId: string };

function encode(signal: AgentSignal): string {
  switch (signal.type) {
    case "job-new":
      return "job-new";
    case "job-done":
      return `job-done:${signal.jobId}`;
    case "job-cancel":
      return `job-cancel:${signal.jobId}:${signal.agentId ?? ""}`;
    case "agent-changed":
      return `agent-changed:${signal.agentId}`;
    case "logs":
      return `logs:${signal.agentId}`;
    case "chat":
      return `chat:${signal.jobId}`;
  }
}

export function decodeSignal(payload: string): AgentSignal | null {
  const [type, a, b] = payload.split(":");
  if (type === "job-new") return { type };
  if (type === "job-done" && a) return { type, jobId: a };
  if (type === "job-cancel" && a) return { type, jobId: a, agentId: b || null };
  if (type === "agent-changed" && a) return { type, agentId: a };
  if (type === "logs" && a) return { type, agentId: a };
  if (type === "chat" && a) return { type, jobId: a };
  return null;
}

export async function signal(s: AgentSignal): Promise<void> {
  try {
    await rawSql.notify(CHANNEL, encode(s));
  } catch (err) {
    console.error("[agents] NOTIFY failed", err);
  }
}

/**
 * Resolves when `match` returns true for a signal, after `timeoutMs`, or when `abort` fires.
 * Returns true if woken by a matching signal.
 */
export function waitForSignal(match: (s: AgentSignal) => boolean, timeoutMs: number, abort?: AbortSignal): Promise<boolean> {
  const h = hub();
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      h.emitter.off("signal", onSignal);
      abort?.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onSignal = (payload: string) => {
      const s = decodeSignal(payload);
      if (s && match(s)) finish(true);
    };
    const onAbort = () => finish(false);
    const timer = setTimeout(() => finish(false), Math.max(0, timeoutMs));
    h.emitter.on("signal", onSignal);
    if (abort) {
      if (abort.aborted) finish(false);
      else abort.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/** Subscribe to all signals (used by SSE streams). Returns an unsubscribe function. */
export function onSignal(fn: (s: AgentSignal) => void): () => void {
  const h = hub();
  const handler = (payload: string) => {
    const s = decodeSignal(payload);
    if (s) fn(s);
  };
  h.emitter.on("signal", handler);
  return () => h.emitter.off("signal", handler);
}
