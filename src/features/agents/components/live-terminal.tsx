"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser, Pause, Play, Radio } from "lucide-react";
import { TerminalView, type TerminalHandle } from "@/components/agent-ui";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

export type LiveLine = { seq: number; jobId: string | null; stream: string; data: string; ts: string };
export type LiveStatusPayload = {
  status: string;
  state: string;
  runningJobs: number;
  lastSeenAt: string | null;
  agentVersion: string | null;
  jobs: { id: string; purpose: string; kind: string; status: string; startedAt: string | null }[];
};

const JOB_COLORS = [36, 35, 33, 34, 32, 96, 95, 93, 94];
const ESC = "\x1b[";

function colorFor(jobId: string): number {
  let h = 0;
  for (let i = 0; i < jobId.length; i++) h = (h * 31 + jobId.charCodeAt(i)) | 0;
  return JOB_COLORS[Math.abs(h) % JOB_COLORS.length]!;
}

function formatLine(l: LiveLine, showJobTag: boolean): string {
  const t = new Date(l.ts);
  const time = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}:${String(t.getSeconds()).padStart(2, "0")}`;
  let tag = "";
  if (showJobTag) tag = l.jobId ? `${ESC}${colorFor(l.jobId)}m${l.jobId.slice(4, 10)}${ESC}0m ` : `${ESC}90magent ${ESC}0m `;
  const prefix = `${ESC}90m${time}${ESC}0m ${tag}`;
  const lines = l.data.replace(/\n$/, "").split("\n");
  return lines
    .map((line) => {
      if (l.stream === "stderr") return `${prefix}${ESC}31m${line}${ESC}0m`;
      if (l.stream === "system") return `${prefix}${ESC}33m${line}${ESC}0m`;
      return `${prefix}${line}`;
    })
    .join("\r\n");
}

/**
 * Live terminal for an agent: streams agent log lines and job output over SSE and renders them with
 * xterm (ANSI colours preserved). With `jobId` it follows a single job from its first line.
 */
export function LiveTerminal({
  agentId,
  jobId,
  jobs,
  className,
  minHeight = 360,
  onStatus,
  compactToolbar,
  terminalClassName,
}: {
  agentId: string;
  jobId?: string | null;
  /** Running jobs, offered as a filter. */
  jobs?: { id: string; purpose: string }[];
  className?: string;
  minHeight?: number;
  onStatus?: (s: LiveStatusPayload) => void;
  compactToolbar?: boolean;
  /** e.g. a fixed height (`h-[65dvh]`) for the terminal itself. */
  terminalClassName?: string;
}) {
  const term = useRef<TerminalHandle | null>(null);
  const [filter, setFilter] = useState<string>(jobId ?? "all");
  const [conn, setConn] = useState<"connecting" | "live" | "reconnecting">("connecting");
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const buffered = useRef<string[]>([]);
  const onStatusRef = useRef(onStatus);
  useEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);

  const write = useCallback((text: string) => {
    if (pausedRef.current) {
      buffered.current.push(text);
      if (buffered.current.length > 5000) buffered.current.splice(0, buffered.current.length - 5000);
      return;
    }
    term.current?.write(text);
  }, []);

  const effectiveJob = jobId ?? (filter !== "all" && filter !== "agent" ? filter : null);

  useEffect(() => {
    term.current?.reset();
    buffered.current = [];
    const params = new URLSearchParams();
    if (effectiveJob) {
      params.set("jobId", effectiveJob);
      params.set("backlog", "2000");
    } else params.set("backlog", "400");
    const es = new EventSource(`/api/agent/live/${agentId}?${params}`);
    const showTag = !effectiveJob;
    const agentOnly = filter === "agent";
    let lines = 0;
    const accept = (l: LiveLine) => !agentOnly || !l.jobId;
    es.addEventListener("open", () => setConn("live"));
    es.addEventListener("error", () => setConn("reconnecting"));
    es.addEventListener("backlog", (e) => {
      const list = JSON.parse((e as MessageEvent).data) as LiveLine[];
      const out = list.filter(accept).map((l) => formatLine(l, showTag));
      if (out.length) write(`${out.join("\r\n")}\r\n`);
      lines += out.length;
    });
    es.addEventListener("ready", () => {
      setConn("live");
      if (!lines) write(`${ESC}90m${effectiveJob ? "Waiting for output from this job…" : "Connected — waiting for agent output…"}${ESC}0m\r\n`);
    });
    es.addEventListener("log", (e) => {
      const l = JSON.parse((e as MessageEvent).data) as LiveLine;
      if (!accept(l)) return;
      lines++;
      write(`${formatLine(l, showTag)}\r\n`);
    });
    es.addEventListener("status", (e) => onStatusRef.current?.(JSON.parse((e as MessageEvent).data) as LiveStatusPayload));
    es.addEventListener("gone", () => {
      write(`${ESC}31mThis agent was deleted.${ESC}0m\r\n`);
      es.close();
    });
    return () => es.close();
  }, [agentId, effectiveJob, filter, write]);

  const togglePause = () => {
    const next = !paused;
    setPaused(next);
    pausedRef.current = next;
    if (!next && buffered.current.length) {
      term.current?.write(buffered.current.join(""));
      buffered.current = [];
      term.current?.scrollToBottom();
    }
  };

  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
            conn === "live" ? "bg-success/10 text-success ring-success/25" : "bg-warning/12 text-warning ring-warning/30",
          )}
        >
          <Radio className={cn("size-3", conn === "live" && "animate-pulse")} />
          {conn === "live" ? "Live" : conn === "connecting" ? "Connecting…" : "Reconnecting…"}
        </span>
        {!jobId && (
          <NativeSelect value={filter} onChange={(e) => setFilter(e.target.value)} className="h-7 w-auto max-w-56 text-xs" aria-label="Output filter">
            <NativeSelectOption value="all">All output</NativeSelectOption>
            <NativeSelectOption value="agent">Agent log only</NativeSelectOption>
            {(jobs ?? []).map((j) => (
              <NativeSelectOption key={j.id} value={j.id}>
                Job: {j.purpose} ({j.id.slice(4, 10)})
              </NativeSelectOption>
            ))}
            {filter !== "all" && filter !== "agent" && !(jobs ?? []).some((j) => j.id === filter) && (
              <NativeSelectOption value={filter}>Job {filter.slice(4, 10)}</NativeSelectOption>
            )}
          </NativeSelect>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={togglePause} className="h-7 gap-1 text-xs">
            {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
            {!compactToolbar && (paused ? "Resume" : "Pause")}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => term.current?.clear()} className="h-7 gap-1 text-xs">
            <Eraser className="size-3.5" />
            {!compactToolbar && "Clear"}
          </Button>
        </div>
      </div>
      <TerminalView ref={term} minHeight={minHeight} className={cn("min-w-0", terminalClassName)} />
    </div>
  );
}
