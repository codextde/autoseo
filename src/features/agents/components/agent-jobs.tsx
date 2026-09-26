"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Braces, ExternalLink, FileText, FlaskConical, Globe, Link2, ListTree, Loader2, ScrollText } from "lucide-react";
import { toast } from "sonner";
import { StreamingText, ThinkingState, ToolCallCard, type ToolCallStatus } from "@/components/agent-ui";
import { DataTable, type Column } from "@/components/app/data-table";
import { FilterBar, MultiSelect } from "@/components/app/filters";
import { EmptyState } from "@/components/app/empty-state";
import { StatusBadge, TimeAgo, CopyButton } from "@/components/app/misc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useUrlListState, useUrlState } from "@/hooks/use-url-state";
import { cn } from "@/lib/utils";
import type { AgentJobDetail, AgentJobView } from "@/server/agents/queries";
import { cancelAgentJobAction, getAgentJobDetailAction } from "../actions";
import { JOB_KIND_LABEL, JOB_STATUS_TONE, formatMs, runtimeLabel } from "./agent-meta";
import { LiveTerminal } from "./live-terminal";
import { ActivityList } from "./agent-activity";

const ACTIVE = new Set(["queued", "assigned", "running"]);

export function JobStatus({ status, cancelRequested }: { status: string; cancelRequested?: boolean }) {
  const label =
    status === "assigned" ? "Starting" : status === "timeout" ? "Timed out" : cancelRequested && ACTIVE.has(status) ? "Cancelling" : undefined;
  return <StatusBadge status={JOB_STATUS_TONE[status] ?? status} label={label ?? status.charAt(0).toUpperCase() + status.slice(1)} />;
}

export function CancelJobButton({ jobId, size = "sm", onDone }: { jobId: string; size?: "sm" | "xs"; onDone?: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      disabled={busy}
      onClick={async (e) => {
        e.stopPropagation();
        setBusy(true);
        const res = await cancelAgentJobAction(jobId);
        setBusy(false);
        if (!res.ok) toast.error(res.error);
        else {
          toast.success("Cancel requested — the agent stops the CLI within seconds");
          onDone?.();
          router.refresh();
        }
      }}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Ban className="size-3.5" />}
      Cancel
    </Button>
  );
}

export function AgentJobsTable({ jobs, compact }: { jobs: AgentJobView[]; compact?: boolean }) {
  const [, setJob] = useUrlState("job", "");
  const [statuses, setStatuses] = useUrlListState("jstatus");
  const [kinds, setKinds] = useUrlListState("jkind");

  const filtered = useMemo(
    () => jobs.filter((j) => (!statuses.length || statuses.includes(j.status)) && (!kinds.length || kinds.includes(j.kind))),
    [jobs, statuses, kinds],
  );
  const count = (fn: (j: AgentJobView) => boolean) => jobs.filter(fn).length;

  const columns: Column<AgentJobView>[] = [
    { id: "status", header: "Status", sortValue: (j) => j.status, cell: (j) => <JobStatus status={j.status} cancelRequested={j.cancelRequested} /> },
    {
      id: "purpose",
      header: "Job",
      sortValue: (j) => j.purpose,
      cell: (j) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-medium">{j.purpose}</span>
            <Badge variant="outline" className="h-4 shrink-0 px-1 text-[10px] font-normal">
              {JOB_KIND_LABEL[j.kind] ?? j.kind}
            </Badge>
          </div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">{j.id}</div>
        </div>
      ),
    },
    {
      id: "runtime",
      header: "CLI",
      hideBelow: "md",
      sortValue: (j) => j.runtimeUsed ?? j.runtime,
      cell: (j) => (
        <div className="text-sm whitespace-nowrap">
          {runtimeLabel(j.runtimeUsed ?? j.runtime)}
          {j.cliVersion && <span className="ml-1 font-mono text-[11px] text-muted-foreground">{j.cliVersion}</span>}
          {(j.cliMode ?? j.requestedMode) && (
            <Badge
              variant="outline"
              className={cn("ml-1.5 h-4 px-1 text-[10px] font-normal", (j.cliMode ?? j.requestedMode) === "full" && "border-info/30 text-info")}
              title={j.cliMode ? "CLI mode used" : "Requested CLI mode (Auto)"}
            >
              {j.cliMode ?? j.requestedMode}
            </Badge>
          )}
        </div>
      ),
    },
    {
      id: "attempts",
      header: "Attempt",
      hideBelow: "lg",
      align: "right",
      sortValue: (j) => j.attempts,
      cell: (j) => (
        <span className="text-sm text-muted-foreground tabular">
          {j.attempts}/{j.maxAttempts}
        </span>
      ),
    },
    {
      id: "duration",
      header: "Duration",
      align: "right",
      sortValue: (j) => j.durationMs ?? -1,
      cell: (j) => <span className="text-sm tabular">{formatMs(j.durationMs)}</span>,
    },
    {
      id: "created",
      header: "Created",
      align: "right",
      hideBelow: "sm",
      sortValue: (j) => new Date(j.createdAt).getTime(),
      cell: (j) => <TimeAgo date={j.createdAt} className="text-sm text-muted-foreground" />,
    },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (j) => (ACTIVE.has(j.status) && !j.cancelRequested ? <CancelJobButton jobId={j.id} size="xs" /> : null),
    },
  ];

  return (
    <div className="space-y-3">
      {!compact && (
        <FilterBar activeCount={statuses.length + kinds.length}>
          <MultiSelect
            label="Status"
            value={statuses}
            onChange={setStatuses}
            options={["queued", "assigned", "running", "succeeded", "failed", "timeout", "cancelled"].map((s) => ({
              value: s,
              label: s === "assigned" ? "Starting" : s.charAt(0).toUpperCase() + s.slice(1),
              count: count((j) => j.status === s),
            }))}
          />
          <MultiSelect
            label="Kind"
            value={kinds}
            onChange={setKinds}
            options={Object.entries(JOB_KIND_LABEL).map(([value, label]) => ({ value, label, count: count((j) => j.kind === value) }))}
          />
        </FilterBar>
      )}
      <DataTable
        columns={columns}
        data={filtered}
        getRowId={(j) => j.id}
        onRowClick={(j) => setJob(j.id)}
        initialSort={{ id: "created", dir: "desc" }}
        pageSize={compact ? 8 : 50}
        paginate={!compact}
        empty={
          <EmptyState
            compact
            icon={ScrollText}
            title={jobs.length ? "No jobs match these filters" : "No jobs yet"}
            description={jobs.length ? undefined : "AI work routed to this agent shows up here — or run a self-test."}
          />
        }
        mobileCard={(j) => (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium">{j.purpose}</span>
              <JobStatus status={j.status} cancelRequested={j.cancelRequested} />
            </div>
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              <span>{JOB_KIND_LABEL[j.kind] ?? j.kind}</span>
              <span>{runtimeLabel(j.runtimeUsed ?? j.runtime)}</span>
              <span className="tabular">{formatMs(j.durationMs)}</span>
              <TimeAgo date={j.createdAt} />
            </div>
          </div>
        )}
      />
    </div>
  );
}


const ANSI = /\x1b\[[0-9;]*m/g;

type ParsedCall = { name: string; args?: unknown; status: ToolCallStatus; result?: string; error?: string };

function parseArgs(raw: string): unknown {
  const t = raw.trim().replace(/…$/, "");
  if (!t) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return raw.trim();
  }
}

/** Rebuilds tool calls and reasoning snippets from the agent's pretty-printed job output. */
function parseTranscript(logs: AgentJobDetail["logs"], finalStatus: string) {
  const calls: ParsedCall[] = [];
  const thoughts: string[] = [];
  for (const entry of logs) {
    if (entry.stream !== "stdout") continue;
    for (const rawLine of entry.data.split("\n")) {
      const line = rawLine.replace(ANSI, "");
      let m: RegExpMatchArray | null;
      if ((m = line.match(/^⚙ (\S+)\s?(.*)$/))) calls.push({ name: m[1]!, args: parseArgs(m[2] ?? ""), status: "running" });
      else if ((m = line.match(/^\s+↳ (\S+) error: (.*)$/))) {
        const c = [...calls].reverse().find((x) => x.name === m![1] && x.status === "running");
        if (c) Object.assign(c, { status: "error", error: m[2] });
      } else if ((m = line.match(/^\s+↳ (\S+)\s*(.*)$/))) {
        const c = [...calls].reverse().find((x) => x.name === m![1] && x.status === "running");
        if (c) Object.assign(c, { status: "success", result: m[2] ? `Returned ${m[2]}` : undefined });
      } else if ((m = line.match(/^⌕ web search\s*(.*)$/))) calls.push({ name: "web_search", args: { query: m[1] }, status: "success" });
      else if ((m = line.match(/^\$ (.*)$/))) calls.push({ name: "shell", args: { command: m[1] }, status: "success" });
      else if ((m = line.match(/^✻ (.*)$/)) && m[1] && m[1] !== "thinking…") thoughts.push(m[1]);
    }
  }
  const done = !ACTIVE.has(finalStatus);
  for (const c of calls) if (c.status === "running" && done) c.status = finalStatus === "succeeded" ? "success" : "error";
  return { calls, thoughts };
}

type HealthCheck = { runtime: string | null; cliVersion?: string | null; ok: boolean; latencyMs?: number; model?: string | null; error?: string | null };

function healthChecks(json: unknown): HealthCheck[] {
  if (!json || typeof json !== "object" || !Array.isArray((json as { checks?: unknown }).checks)) return [];
  return (json as { checks: HealthCheck[] }).checks;
}

function Section({ title, icon, children, actions }: { title: string; icon: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="min-w-0 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {icon}
          {title}
        </h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Pre({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <pre className={cn("max-h-80 overflow-auto rounded-xl border bg-muted/40 p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-words", className)}>
      {children}
    </pre>
  );
}

/** Job output drawer (opened via `?job=<id>`): prompt, answer, JSON, citations, live log, activity. */
export function JobDrawer({ agentId }: { agentId: string }) {
  const [jobId, setJob] = useUrlState("job", "");
  const [detail, setDetail] = useState<AgentJobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    const load = async () => {
      const res = await getAgentJobDetailAction(jobId);
      if (stop) return;
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setError(null);
      setDetail(res.data);
      if (ACTIVE.has(res.data.status)) timer = window.setTimeout(load, 2500);
    };
    let timer: number | undefined;
    void load();
    return () => {
      stop = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [jobId, version]);

  const current = detail?.id === jobId ? detail : null;
  const open = !!jobId;
  const transcript = useMemo(() => (current ? parseTranscript(current.logs, current.status) : { calls: [], thoughts: [] }), [current]);
  const checks = useMemo(() => (current?.kind === "test" ? healthChecks(current.resultJson) : []), [current]);

  return (
    <Sheet open={open} onOpenChange={(v) => !v && setJob(null)}>
      <SheetContent side="right" className="gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        <SheetHeader className="border-b px-4 py-4 sm:px-5">
          <SheetTitle className="flex flex-wrap items-center gap-2 pr-8">
            {current ? current.purpose : "Job"}
            {current && <JobStatus status={current.status} cancelRequested={current.cancelRequested} />}
          </SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px]">
            <span>{jobId}</span>
            {current && (
              <>
                <span>{JOB_KIND_LABEL[current.kind] ?? current.kind}</span>
                <span>
                  {runtimeLabel(current.runtimeUsed ?? current.runtime)} {current.cliVersion ?? ""}
                </span>
                {current.model && <span>{current.model}</span>}
                <span>
                  attempt {current.attempts}/{current.maxAttempts}
                </span>
              </>
            )}
          </SheetDescription>
        </SheetHeader>
        <div className="min-w-0 space-y-5 px-4 py-4 sm:px-5">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!current && !error && (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          )}
          {current && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { k: "Queued", v: <TimeAgo date={current.queuedAt} /> },
                  { k: "Started", v: current.startedAt ? <TimeAgo date={current.startedAt} /> : "—" },
                  { k: "Duration", v: formatMs(current.durationMs) },
                  { k: "Exit code", v: current.exitCode ?? "—" },
                ].map((x) => (
                  <div key={x.k} className="rounded-xl border bg-muted/30 px-3 py-2">
                    <div className="text-[11px] text-muted-foreground">{x.k}</div>
                    <div className="text-sm font-medium tabular">{x.v}</div>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted/20 px-3 py-1.5">
                <ThinkingState
                  active={ACTIVE.has(current.status)}
                  startedAt={current.startedAt ? new Date(current.startedAt) : undefined}
                  durationMs={current.durationMs ?? undefined}
                  label={current.status === "queued" ? "Waiting for an agent" : current.status === "assigned" ? "Starting CLI session" : "Working"}
                >
                  {transcript.thoughts.length ? transcript.thoughts.join("\n\n") : undefined}
                </ThinkingState>
                {ACTIVE.has(current.status) && !current.cancelRequested && <CancelJobButton jobId={current.id} onDone={() => setVersion((v) => v + 1)} />}
              </div>
              {checks.length > 0 && (
                <Section title="Health checks" icon={<FlaskConical className="size-3.5" />}>
                  <div className="space-y-2">
                    {checks.map((c, i) => (
                      <ToolCallCard
                        key={`${c.runtime}-${i}`}
                        name={c.runtime === "codex" ? "codex exec" : c.runtime === "claude" ? "claude -p" : "cli"}
                        title={`${runtimeLabel(c.runtime)} ${c.cliVersion ?? ""}`.trim()}
                        status={c.ok ? "success" : "error"}
                        durationMs={c.latencyMs}
                        args={{ prompt: "Reply with a JSON health payload", runtime: c.runtime }}
                        result={c.ok ? { ok: true, latencyMs: c.latencyMs, model: c.model ?? undefined } : undefined}
                        error={c.ok ? null : (c.error ?? "Failed")}
                      />
                    ))}
                  </div>
                </Section>
              )}
              {transcript.calls.length > 0 && (
                <Section title={`Tool calls (${transcript.calls.length})`} icon={<ListTree className="size-3.5" />}>
                  <div className="space-y-2">
                    {transcript.calls.map((c, i) => (
                      <ToolCallCard key={i} name={c.name} args={c.args} status={c.status} result={c.result} error={c.error} />
                    ))}
                  </div>
                </Section>
              )}
              {current.error && current.status !== "succeeded" && (
                <Section title="Error" icon={<Ban className="size-3.5" />}>
                  <Pre className="border-destructive/25 bg-destructive/5 text-destructive">{current.error}</Pre>
                </Section>
              )}
              {current.resultText && (
                <Section title="Answer" icon={<FileText className="size-3.5" />} actions={<CopyButton value={current.resultText} />}>
                  <div className="max-h-96 overflow-auto rounded-xl border bg-muted/40 p-3 text-sm leading-relaxed">
                    <StreamingText text={current.resultText} streaming={false} />
                  </div>
                </Section>
              )}
              {current.resultJson != null && (
                <Section
                  title={current.kind === "test" ? "Health payload" : "Parsed JSON"}
                  icon={<Braces className="size-3.5" />}
                  actions={<CopyButton value={JSON.stringify(current.resultJson, null, 2)} />}
                >
                  <Pre>{JSON.stringify(current.resultJson, null, 2)}</Pre>
                </Section>
              )}
              {current.citationList.length > 0 && (
                <Section title={`Citations (${current.citationList.length})`} icon={<Link2 className="size-3.5" />}>
                  <ul className="divide-y rounded-xl border">
                    {current.citationList.map((c) => (
                      <li key={c.url} className="flex min-w-0 items-center gap-2 px-3 py-2 text-sm">
                        <Globe className="size-3.5 shrink-0 text-muted-foreground" />
                        <a href={c.url} target="_blank" rel="noopener noreferrer nofollow" className="min-w-0 flex-1 truncate hover:underline">
                          {c.title || c.url}
                        </a>
                        <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
              <Section title="Live output" icon={<ScrollText className="size-3.5" />}>
                <LiveTerminal key={current.id} agentId={current.agentId ?? agentId} jobId={current.id} minHeight={280} compactToolbar />
              </Section>
              {current.payload.messages && current.payload.messages.length > 0 && (
                <Section title={`Chat transcript (${current.payload.messages.length})`} icon={<FileText className="size-3.5" />}>
                  <div className="max-h-96 space-y-2 overflow-auto rounded-xl border bg-muted/30 p-3">
                    {current.payload.messages.map((m, i) => (
                      <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                        <div
                          className={cn(
                            "max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words",
                            m.role === "user" ? "bg-foreground text-background" : "border bg-card",
                          )}
                        >
                          {m.content}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                    {current.payload.mcpUrl && <Badge variant="outline">MCP: {current.payload.mcpUrl}</Badge>}
                    {(current.payload.attachmentNames ?? []).map((n) => (
                      <Badge key={n} variant="outline">
                        📎 {n}
                      </Badge>
                    ))}
                  </div>
                </Section>
              )}
              {(current.payload.prompt || current.payload.system) && (
                <Section title="Prompt" icon={<FileText className="size-3.5" />} actions={current.payload.prompt ? <CopyButton value={current.payload.prompt} /> : null}>
                  {current.payload.system && <Pre className="max-h-40 text-muted-foreground">{current.payload.system}</Pre>}
                  {current.payload.prompt && <Pre>{current.payload.prompt}</Pre>}
                  <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                    {current.payload.webSearch && <Badge variant="outline">web search</Badge>}
                    {current.payload.jsonSchema && <Badge variant="outline">JSON schema</Badge>}
                    {current.workDir && <span className="font-mono break-all">{current.workDir}</span>}
                  </div>
                </Section>
              )}
              {current.events.length > 0 && (
                <Section title="Job activity" icon={<ScrollText className="size-3.5" />}>
                  <ActivityList events={current.events} dense />
                </Section>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
