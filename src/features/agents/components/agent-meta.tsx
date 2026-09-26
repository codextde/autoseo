"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Apple, Monitor, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_META, type AgentStatusValue } from "../status";

export { STATUS_META, type AgentStatusValue };

export function AgentStatusChip({ status, busy, className }: { status: AgentStatusValue; busy?: boolean; className?: string }) {
  const meta = STATUS_META[status];
  return (
    <span
      title={meta.hint}
      className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset", meta.chip, className)}
    >
      <span className="relative flex size-1.5">
        {(status === "online" || status === "updating") && (
          <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-60", meta.dot)} />
        )}
        <span className={cn("relative inline-flex size-1.5 rounded-full", meta.dot)} />
      </span>
      {meta.label}
      {busy && status === "online" ? <span className="font-normal opacity-80">· busy</span> : null}
    </span>
  );
}

export function runtimeLabel(r: string | null | undefined): string {
  if (r === "claude") return "Claude Code";
  if (r === "codex") return "Codex";
  if (r === "detect") return "Detect";
  if (r === "any") return "Any";
  return "—";
}

export function osLabel(os: string | null | undefined, arch?: string | null): string {
  const name = os === "darwin" ? "macOS" : os === "win32" ? "Windows" : os === "linux" ? "Linux" : (os ?? "—");
  return arch ? `${name} · ${arch}` : name;
}

export function OsIcon({ os, className }: { os: string | null | undefined; className?: string }) {
  if (os === "darwin") return <Apple className={cn("size-3.5", className)} />;
  if (os === "win32") return <Monitor className={cn("size-3.5", className)} />;
  return <Terminal className={cn("size-3.5", className)} />;
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

export function formatMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  const rest = Math.round(s % 60);
  if (m < 60) return `${m}m ${rest}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function shortVersion(v: string | null | undefined): string {
  if (!v) return "—";
  return v.length > 18 ? `${v.slice(0, 18)}…` : v;
}

export const JOB_STATUS_TONE: Record<string, string> = {
  queued: "queued",
  assigned: "running",
  running: "running",
  succeeded: "succeeded",
  failed: "failed",
  timeout: "warning",
  cancelled: "cancelled",
};

export const JOB_KIND_LABEL: Record<string, string> = { llm: "LLM", "web-search": "Web search", chat: "Chat", test: "Self-test" };

export const CLI_MODE_LABEL: Record<string, string> = {
  auto: "Auto (Full for chat & agentic, Lean for bulk)",
  lean: "Lean (no local MCP/config)",
  full: "Full (local MCP servers & config)",
};

/** Re-renders server data periodically while the tab is visible. */
export function useAutoRefresh(intervalMs: number, enabled = true) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = window.setInterval(tick, intervalMs);
    const onVis = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [router, intervalMs, enabled]);
}
