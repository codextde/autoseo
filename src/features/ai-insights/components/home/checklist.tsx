"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRight, Check, ChevronDown, Clock, ShieldCheck } from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/app/page";
import { cn } from "@/lib/utils";
import type { ChecklistItem } from "@/server/ai/insights/dashboard";
import { setChecklistStepSkippedAction } from "../../actions";

/**
 * Merged setup checklist (AI visibility + workspace steps). Open steps first; "Skip for now" moves a
 * step to "saved for later" (per user). Hidden once nothing is left to do.
 */
export function SetupChecklist({ projectId, items, className, alwaysShow }: { projectId: string; items: ChecklistItem[]; className?: string; alwaysShow?: boolean }) {
  const [pending, start] = useTransition();
  const [showDone, setShowDone] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);
  const open = items.filter((i) => !i.done && !i.skipped);
  const skipped = items.filter((i) => i.skipped);
  const done = items.filter((i) => i.done);
  if (!open.length && !alwaysShow) return null;
  const pct = Math.round((done.length / (items.length || 1)) * 100);

  const setSkipped = (step: string, value: boolean) =>
    start(async () => {
      const r = await setChecklistStepSkippedAction(projectId, step, value);
      if (!r.ok) toast.error(r.error);
    });

  return (
    <Panel
      className={className}
      title="Set up your workspace"
      description={`${done.length} of ${items.length} done — add your website, connect your tools and invite your team.`}
      actions={
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
            <motion.div className="h-full rounded-full bg-brand" initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.6, ease: "easeOut" }} />
          </div>
          <span className="text-xs text-muted-foreground tabular">{pct}%</span>
        </div>
      }
      contentClassName="p-2 sm:p-3"
    >
      {open.length === 0 ? (
        <p className="px-2.5 py-3 text-sm text-muted-foreground">All set — nothing left to do here.</p>
      ) : (
        <ul className="space-y-0.5">
          {open.map((it, idx) => (
            <li key={it.key} className="flex flex-col gap-2 rounded-xl px-2.5 py-2.5 hover:bg-muted/50 sm:flex-row sm:items-center sm:gap-3">
              <span className="flex min-w-0 flex-1 items-start gap-3">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/40 text-[11px] text-muted-foreground tabular">
                  {idx + 1}
                </span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                    {it.title}
                    {it.startHere && <span className="rounded bg-brand-soft px-1.5 text-[10px] font-semibold text-brand">Start here</span>}
                    {it.adminOnly && (
                      <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1 text-[10px] font-normal text-muted-foreground">
                        <ShieldCheck className="size-3" /> Admin
                      </span>
                    )}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {it.allowed ? it.description : "Ask a workspace owner or admin to help with this step."}
                  </span>
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1 self-end sm:self-auto">
                <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" disabled={pending} onClick={() => setSkipped(it.key, true)}>
                  {it.key === "projects" ? "I only need one project" : "Skip for now"}
                </Button>
                {it.allowed && (
                  <Button asChild variant="outline" size="sm" className="h-7">
                    <Link href={it.href}>
                      {it.cta} <ArrowRight className="size-3.5" />
                    </Link>
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {(skipped.length > 0 || done.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t px-2.5 pt-2 text-xs text-muted-foreground">
          {skipped.length > 0 && (
            <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setShowSkipped((v) => !v)}>
              <Clock className="size-3.5" /> {skipped.length} saved for later
              <ChevronDown className={cn("size-3.5 transition-transform", showSkipped && "rotate-180")} />
            </button>
          )}
          {done.length > 0 && (
            <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setShowDone((v) => !v)}>
              <Check className="size-3.5" /> {done.length} completed
              <ChevronDown className={cn("size-3.5 transition-transform", showDone && "rotate-180")} />
            </button>
          )}
        </div>
      )}
      {showSkipped && skipped.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {skipped.map((it) => (
            <li key={it.key} className="flex items-center gap-3 rounded-lg px-2.5 py-1.5 text-sm">
              <Clock className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{it.title}</span>
              <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={pending} onClick={() => setSkipped(it.key, false)}>
                Restore
              </Button>
            </li>
          ))}
        </ul>
      )}
      {showDone && done.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {done.map((it) => (
            <li key={it.key} className="flex items-center gap-3 rounded-lg px-2.5 py-1.5 text-sm">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground">
                <Check className="size-3" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-muted-foreground line-through decoration-muted-foreground/40">{it.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{it.description}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
