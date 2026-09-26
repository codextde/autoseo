"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNowStrict } from "date-fns";
import { AlertTriangle, Loader2, Play, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { AnalysisRunning } from "../shared/analysis-running";
import { useJobPoll } from "../shared/use-job-poll";
import { startAnalysisAction } from "../../actions/knowledge";
import type { KnowledgeKind, KnowledgeState } from "../../types";

export function useStartAnalysis(projectId: string, kind: KnowledgeKind) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const res = await startAnalysisAction(projectId, kind);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Analysis started — we'll email you when it's ready.");
      router.refresh();
    });
  return { run, pending };
}

/**
 * Wraps a Brand Knowledge tab: idle intro → running state (finseo diagram) → failed → results.
 * Re-runs keep showing the previous results with a slim progress banner.
 */
export function AnalysisShell({
  projectId,
  kind,
  state,
  canManage,
  source,
  intro,
  startLabel = "Start analysis",
  estimate,
  blocked,
  children,
  hasData,
  showPromptResearchNote = true,
}: {
  projectId: string;
  kind: KnowledgeKind;
  state: KnowledgeState<unknown>;
  canManage: boolean;
  source: string;
  intro: React.ReactNode;
  startLabel?: string;
  estimate?: string;
  /** Reason why the analysis cannot run (missing provider) — shown instead of the start button. */
  blocked?: React.ReactNode;
  children?: React.ReactNode;
  hasData: boolean;
  showPromptResearchNote?: boolean;
}) {
  const running = state.status === "running";
  const job = useJobPoll(projectId, running ? state.jobId : null, { intervalMs: 4000 });
  const { run, pending } = useStartAnalysis(projectId, kind);

  if (running && !hasData) {
    return <AnalysisRunning source={source} status={job} estimate={estimate} showPromptResearchNote={showPromptResearchNote} />;
  }

  if (!hasData) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border bg-card px-5 py-12 text-center shadow-soft">
        {state.status === "failed" && state.error && (
          <div className="flex max-w-lg items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-left text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <span>{state.error}</span>
          </div>
        )}
        <div className="max-w-xl space-y-1.5 text-sm text-muted-foreground">{intro}</div>
        {blocked ? (
          <div className="max-w-lg text-sm">{blocked}</div>
        ) : canManage ? (
          <Button onClick={run} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            {state.status === "failed" ? "Try again" : startLabel}
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">Ask a project member with “manage prompts” permission to run this analysis.</p>
        )}
      </div>
    );
  }

  const p = job?.progress;
  const pct = p?.total ? Math.round(((p.done ?? 0) / p.total) * 100) : null;
  return (
    <div className="space-y-4">
      {running ? (
        <div className="rounded-xl border bg-card p-3 shadow-soft">
          <div className="flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin text-brand" />
            <span className="font-medium">Analysis running</span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{p?.message ?? "Queued…"} · results update automatically</span>
          </div>
          {pct != null && <Progress value={pct} className="mt-2" />}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className={cn(state.status === "failed" && "text-destructive")}>
            {state.status === "failed"
              ? `Last run failed: ${state.error ?? "unknown error"}`
              : state.finishedAt
                ? `Last analysed ${formatDistanceToNowStrict(new Date(state.finishedAt), { addSuffix: true })}`
                : state.updatedAt
                  ? `Updated ${formatDistanceToNowStrict(new Date(state.updatedAt), { addSuffix: true })}`
                  : null}
          </span>
          {canManage && !blocked && (
            <Button variant="outline" size="sm" onClick={run} disabled={pending}>
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              Re-run analysis
            </Button>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
