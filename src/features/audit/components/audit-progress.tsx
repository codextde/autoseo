"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Check, Loader2, Radar, Square } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Panel } from "@/components/app/page";
import { cn } from "@/lib/utils";
import { stopAuditAction } from "../actions";
import { HttpStatusBadge, pathOf, PHASES } from "./bits";

type Status = {
  status: string;
  currentPhase: string;
  pagesCrawled: number;
  pagesTotal: number;
  lighthouseTotal: number;
  lighthouseCompleted: number;
  lighthouseFailed: number;
  stopRequested: boolean;
  heartbeatAt: string | null;
  feed: Array<{ url: string; statusCode: number | null; title: string | null; crawledAt: string; fetchClass: string }>;
};

export function AuditProgress({
  projectId,
  auditId,
  initial,
  canRun,
  lighthouseEnabled,
  predominantHost,
}: {
  projectId: string;
  auditId: string;
  initial: Status;
  canRun: boolean;
  lighthouseEnabled: boolean;
  predominantHost: string | null;
}) {
  const router = useRouter();
  const [s, setS] = useState<Status>(initial);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [pending, start] = useTransition();
  const doneRef = useRef(false);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const res = await fetch(`/p/${projectId}/seo/audit/${auditId}/status`, { cache: "no-store" });
        if (res.ok) {
          const next = (await res.json()) as Status;
          if (!alive) return;
          setS(next);
          setUpdatedAt(new Date());
          if (!["queued", "running"].includes(next.status) && !doneRef.current) {
            doneRef.current = true;
            router.refresh();
            return;
          }
        }
      } catch {
        /* transient */
      }
      if (alive) timer = setTimeout(tick, document.hidden ? 5000 : 2000);
    };
    timer = setTimeout(tick, 1500);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [projectId, auditId, router]);

  const phases = PHASES.filter((p) => p.key !== "lighthouse" || lighthouseEnabled);
  const phaseKey = s.currentPhase === "queued" ? "discovery" : s.currentPhase;
  const phaseIdx = Math.max(0, phases.findIndex((p) => p.key === phaseKey));
  const inLighthouse = s.currentPhase === "lighthouse";
  const pct = inLighthouse
    ? Math.round(((s.lighthouseCompleted + s.lighthouseFailed) / Math.max(1, s.lighthouseTotal)) * 100)
    : s.currentPhase === "finalizing"
      ? 100
      : Math.round((s.pagesCrawled / Math.max(1, s.pagesTotal)) * 100);

  const stop = () =>
    start(async () => {
      const res = await stopAuditAction(projectId, auditId);
      if (res.ok) {
        toast.success(res.data.finalizing ? "Stopping — finalizing results for the pages crawled so far" : "Audit cancelled");
        router.refresh();
      } else toast.error(res.error);
    });

  return (
    <div className="space-y-4">
      <Panel
        title={inLighthouse ? "Running Lighthouse checks" : s.currentPhase === "finalizing" ? "Finalizing results" : s.currentPhase === "queued" ? "Waiting for a worker" : "Crawling pages"}
        icon={<Radar className="size-4 animate-pulse text-brand" />}
        actions={
          canRun && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={stop} disabled={pending || s.stopRequested}>
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Square className="size-3.5" />}
              {s.stopRequested ? "Stopping…" : "Stop"}
            </Button>
          )
        }
      >
        <ol className="mb-5 grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-0">
          {phases.map((p, i) => {
            const done = i < phaseIdx;
            const active = i === phaseIdx;
            return (
              <li key={p.key} className="flex items-center sm:flex-1">
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
                    done && "border-brand bg-brand text-brand-foreground",
                    active && "border-brand text-brand",
                    !done && !active && "text-muted-foreground",
                  )}
                >
                  {done ? <Check className="size-3.5" /> : active ? <Loader2 className="size-3.5 animate-spin" /> : i + 1}
                </span>
                <span className={cn("ml-2 text-xs", active ? "font-medium text-foreground" : "text-muted-foreground")}>{p.label}</span>
                {i < phases.length - 1 && <span className={cn("mx-3 hidden h-px flex-1 sm:block", done ? "bg-brand" : "bg-border")} />}
              </li>
            );
          })}
        </ol>
        <Progress value={pct} className="h-2 [&>div]:bg-brand" />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="tabular">
            {inLighthouse ? (
              <>
                <strong>{s.lighthouseCompleted + s.lighthouseFailed}</strong> / {s.lighthouseTotal} checks
                {s.lighthouseFailed > 0 && <span className="text-destructive"> ({s.lighthouseFailed} failed)</span>}
              </>
            ) : (
              <>
                <strong>{s.pagesCrawled.toLocaleString()}</strong> / {s.pagesTotal.toLocaleString()} pages
              </>
            )}
          </span>
          <span className="text-xs text-muted-foreground tabular">
            {pct}%{updatedAt ? ` · updated ${format(updatedAt, "HH:mm:ss")}` : ""}
          </span>
        </div>
      </Panel>

      <Panel title={`Crawled pages (${s.pagesCrawled.toLocaleString()})`} description="Live feed — newest first" contentClassName="p-0">
        {s.feed.length === 0 ? (
          <div className="flex items-center gap-2 px-5 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Reading robots.txt and sitemaps…
          </div>
        ) : (
          <ul className="max-h-[420px] divide-y overflow-y-auto">
            <AnimatePresence initial={false}>
              {s.feed.map((f, i) => (
                <motion.li
                  key={f.url}
                  layout
                  initial={{ opacity: 0, y: -6, backgroundColor: "var(--brand-soft)" }}
                  animate={{ opacity: 1, y: 0, backgroundColor: i === 0 ? "var(--brand-soft)" : "transparent" }}
                  transition={{ duration: 0.35 }}
                  className="flex items-center gap-3 px-4 py-2 sm:px-5"
                >
                  <HttpStatusBadge status={f.statusCode} fetchClass={f.fetchClass} className="w-14 justify-center" />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs" title={f.url}>
                    {pathOf(f.url, predominantHost)}
                  </span>
                  <span className="hidden max-w-[40%] truncate text-xs text-muted-foreground md:block">{f.title}</span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </Panel>
    </div>
  );
}
