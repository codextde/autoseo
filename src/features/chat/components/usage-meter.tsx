"use client";

import Link from "next/link";
import { Cpu, Cloud } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatUsageMeter } from "../types";

function usd(v: number) {
  return v >= 100 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`;
}

/** Sidebar footer meter: local agent runs vs paid API usage this month (workspace-wide). */
export function UsageMeter({ usage, href }: { usage: ChatUsageMeter | null; href?: string | null }) {
  if (!usage) {
    return <div className="h-[92px] animate-pulse rounded-xl bg-sidebar-accent/60" aria-hidden />;
  }
  const total = usage.agentRuns + usage.apiCalls;
  const localShare = total ? Math.round((usage.agentRuns / total) * 100) : 0;
  const budgetShare = usage.budgetUsd ? Math.min(100, (usage.apiCostUsd / usage.budgetUsd) * 100) : null;
  const body = (
    <div className="space-y-2 rounded-xl border border-sidebar-border bg-background/60 p-3 text-xs transition-colors group-hover/meter:bg-background">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-foreground">AI usage · {usage.monthLabel}</span>
        {total > 0 && <span className="text-muted-foreground tabular">{localShare}% local</span>}
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${localShare}% of AI runs on local agents`}>
        {total > 0 ? (
          <>
            <span className="h-full bg-brand" style={{ width: `${localShare}%` }} />
            <span className="h-full bg-foreground/35" style={{ width: `${100 - localShare}%` }} />
          </>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Cpu className="size-3 text-brand" /> Local
          </div>
          <div className="truncate font-medium text-foreground tabular">
            {usage.agentRuns.toLocaleString()} <span className="font-normal text-muted-foreground">runs · free</span>
          </div>
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Cloud className="size-3" /> API
          </div>
          <div className="truncate font-medium text-foreground tabular">
            {usd(usage.apiCostUsd)} <span className="font-normal text-muted-foreground">· {usage.apiCalls.toLocaleString()} calls</span>
          </div>
        </div>
      </div>
      {budgetShare != null && (
        <div className="space-y-1">
          <div className="flex justify-between text-muted-foreground tabular">
            <span>Monthly budget</span>
            <span>
              {usd(usage.apiCostUsd)} / {usd(usage.budgetUsd!)}
            </span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <span className={cn("block h-full", budgetShare > 90 ? "bg-destructive" : budgetShare > 70 ? "bg-warning" : "bg-brand")} style={{ width: `${budgetShare}%` }} />
          </div>
        </div>
      )}
      <div className="text-[11px] text-muted-foreground tabular">
        Your chats: {usage.chatAgentMessages} local · {usage.chatApiMessages} API
      </div>
    </div>
  );
  return href ? (
    <Link href={href} className="group/meter block rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" title="Open usage">
      {body}
    </Link>
  ) : (
    body
  );
}
