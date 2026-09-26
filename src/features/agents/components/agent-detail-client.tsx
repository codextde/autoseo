"use client";

import { useState } from "react";
import { useAutoRefresh } from "./agent-meta";
import { LiveTerminal, type LiveStatusPayload } from "./live-terminal";

/** Periodically re-renders the server page while visible. */
export function AutoRefresh({ ms }: { ms: number }) {
  useAutoRefresh(ms);
  return null;
}

/** Full-height live terminal (Terminal tab) with running jobs offered as filters. */
export function LiveTerminalPanel({ agentId }: { agentId: string }) {
  const [status, setStatus] = useState<LiveStatusPayload | null>(null);
  return (
    <div className="space-y-2">
      <LiveTerminal agentId={agentId} jobs={status?.jobs ?? []} onStatus={setStatus} minHeight={360} terminalClassName="h-[65dvh]" />
      <p className="text-xs text-muted-foreground">
        {status ? `${status.jobs.length} job${status.jobs.length === 1 ? "" : "s"} running · agent ${status.state}` : "Connecting…"} · Output of every job is also kept in its own
        folder on the machine.
      </p>
    </div>
  );
}
