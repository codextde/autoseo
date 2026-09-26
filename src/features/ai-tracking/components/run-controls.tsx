"use client";

import { useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusBadge, TimeAgo } from "@/components/app/misc";
import { EngineIcon } from "@/components/app/engine-icon";
import { useCan } from "@/components/app/shell-context";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getEngine } from "@/lib/engines";
import { runNowAction } from "../actions";
import type { EngineAvailabilityView, RunInfo } from "../types";

export function RunNowButton({ projectId, promptIds, label = "Run now", variant = "outline" }: { projectId: string; promptIds?: string[]; label?: string; variant?: "outline" | "default" }) {
  const can = useCan();
  const [pending, start] = useTransition();
  if (!can("prompts.manage")) return null;
  return (
    <Button
      size="sm"
      variant={variant}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await runNowAction(projectId, promptIds);
          if (!res.ok) {
            toast.error("Run could not start", { description: res.error });
            return;
          }
          const skipped = res.data.skipped.map((s) => getEngine(s.engine)?.name ?? s.engine);
          toast.success(res.data.tasks ? `${res.data.tasks} answers queued` : "Everything is already queued for today", {
            description: skipped.length ? `Skipped (not configured): ${skipped.join(", ")}` : undefined,
          });
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <Play />}
      {label}
    </Button>
  );
}

export function LastRunBadge({ run }: { run: RunInfo | null }) {
  if (!run) return <span className="text-xs text-muted-foreground">No runs yet</span>;
  const progress = run.totalTasks ? `${run.doneTasks + run.failedTasks}/${run.totalTasks}` : "";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <StatusBadge status={run.status === "partial" ? "warning" : run.status} label={run.status === "partial" ? "Partial" : undefined} />
          {(run.status === "running" || run.status === "queued") && progress && <span className="tabular">{progress}</span>}
          <TimeAgo date={run.createdAt} />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-80">
        <div className="space-y-1">
          <div>
            Last run ({run.trigger}) · {run.doneTasks} answered · {run.failedTasks} failed · ${run.costUsd.toFixed(3)}
          </div>
          {run.error && <div className="opacity-80">{run.error}</div>}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/** Warns when enabled engines cannot answer (missing provider configuration). */
export function EngineConfigBanner({ engines, enabled, isAdmin }: { engines: EngineAvailabilityView[]; enabled: string[]; isAdmin: boolean }) {
  const broken = engines.filter((e) => enabled.includes(e.id) && !e.configured);
  if (!broken.length) return null;
  const none = broken.length === enabled.length;
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm sm:flex-row sm:items-start">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="font-medium">
          {none ? "None of the enabled AI models can answer yet" : `${broken.length} enabled AI model${broken.length > 1 ? "s" : ""} cannot answer yet`}
        </p>
        <ul className="space-y-1 text-xs text-muted-foreground">
          {broken.map((e) => (
            <li key={e.id} className="flex items-start gap-1.5">
              <EngineIcon id={e.id} size="xs" withTooltip={false} />
              <span>
                <span className="font-medium text-foreground">{e.name}:</span> {e.reason}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {isAdmin && (
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <Button asChild size="sm" variant="outline">
            <Link href="/admin/data">Data Providers</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/admin/ai">AI Providers</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
