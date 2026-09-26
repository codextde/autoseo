"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { Briefcase, Building2, Check, ChevronRight, Clock, EyeOff, Loader2, Play, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Panel } from "@/components/app/page";
import { ScoreRing } from "@/components/app/charts";
import { Meter } from "@/components/app/metrics";
import { NavIcon } from "@/components/app/nav-icon";
import { ConfirmButton } from "@/components/app/misc";
import { useUrlState } from "@/hooks/use-url-state";
import { cn } from "@/lib/utils";
import { saveTourStateAction } from "../actions";
import { publishTourState } from "../store";
import { stepHref, stepsForTrack, topicsForTrack, trackProgress, TOUR_TRACKS, type TourState, type TourTrack } from "../steps";

const TRACK_ICON: Record<TourTrack, typeof Building2> = { business: Building2, agency: Briefcase };

export function TourOverview({
  projectId,
  initialState,
  enabled,
  isAdmin,
  appName,
}: {
  projectId: string;
  initialState: TourState;
  enabled: boolean;
  isAdmin: boolean;
  appName: string;
}) {
  const router = useRouter();
  const [trackParam, setTrackParam] = useUrlState("track", initialState.track);
  const track: TourTrack = trackParam === "agency" ? "agency" : "business";
  const [state, setState] = useState<TourState>(initialState);
  const [busy, setBusy] = useState<string | null>(null);

  const steps = useMemo(() => stepsForTrack(track), [track]);
  const topics = useMemo(() => topicsForTrack(track), [track]);
  const progress = trackProgress(track, state.completed);
  const resumable = state.track === track && state.stepIndex > 0 && state.stepIndex < steps.length;
  const minutes = Math.max(2, Math.round(steps.length * 0.2));

  const start = async (stepIndex: number, key: string, resetCompleted = false) => {
    const step = steps[stepIndex];
    if (!step) return;
    const next: TourState = {
      track,
      active: true,
      stepIndex,
      completed: resetCompleted ? [] : state.completed,
      projectId,
    };
    setBusy(key);
    try {
      const res = await saveTourStateAction(next);
      if (!res.ok) return void toast.error(res.error);
      setState(res.data);
      publishTourState(res.data);
      router.push(stepHref(step, projectId));
    } finally {
      setBusy(null);
    }
  };

  const reset = async () => {
    const next: TourState = { track, active: false, stepIndex: 0, completed: [], projectId };
    const res = await saveTourStateAction(next);
    if (!res.ok) return void toast.error(res.error);
    setState(res.data);
    publishTourState(res.data);
    toast.success("Tour progress reset");
  };

  return (
    <div className="space-y-5">
      {!enabled && (
        <Panel contentClassName="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <EyeOff className="size-4" />
            </span>
            <div>
              <p className="text-sm font-medium">The interactive tour is turned off for this instance</p>
              <p className="text-sm text-muted-foreground">
                You can still browse what&apos;s covered below. {isAdmin ? "Turn it on in Admin → Branding (“Product tour”)." : "Ask an admin to enable it."}
              </p>
            </div>
          </div>
          {isAdmin && (
            <Button asChild variant="outline" size="sm" className="shrink-0">
              <Link href="/admin/branding">Open branding settings</Link>
            </Button>
          )}
        </Panel>
      )}

      <section className="relative overflow-hidden rounded-2xl border bg-card shadow-soft">
        <div className="bg-dots pointer-events-none absolute inset-0 opacity-40 [mask-image:linear-gradient(to_left,black,transparent_60%)]" />
        <div className="relative flex flex-col gap-6 p-5 sm:p-6 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0 space-y-4">
            <div className="space-y-1.5">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand">
                <Clock className="size-3" /> {minutes} min · {steps.length} steps
              </div>
              <h2 className="text-xl font-semibold tracking-tight text-balance sm:text-2xl">
                {progress.done === steps.length ? "You've seen everything 🎉" : `Get to know ${appName} in a few minutes`}
              </h2>
              <p className="max-w-xl text-sm text-muted-foreground">
                The tour opens the real pages of your project one by one and explains what each one is for. Close it any time — your progress is
                saved to your account.
              </p>
            </div>

            <div className="grid max-w-xl grid-cols-2 gap-2">
              {TOUR_TRACKS.map((t) => {
                const Icon = TRACK_ICON[t.key];
                const p = trackProgress(t.key, state.completed);
                const selected = track === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTrackParam(t.key)}
                    aria-pressed={selected}
                    className={cn(
                      "flex min-w-0 flex-col gap-1.5 rounded-xl border p-3 text-left transition-all",
                      selected ? "border-foreground bg-background shadow-xs ring-1 ring-foreground" : "bg-background/60 hover:bg-background",
                    )}
                  >
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <Icon className="size-4 shrink-0" /> <span className="truncate">{t.label}</span>
                    </span>
                    <span className="line-clamp-2 hidden text-xs text-muted-foreground sm:block">{t.description}</span>
                    <span className="flex items-center gap-2 text-[11px] text-muted-foreground tabular">
                      <Meter value={p.pct} className="h-1" /> {p.pct}%
                    </span>
                  </button>
                );
              })}
            </div>

            {enabled && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                {resumable ? (
                  <Button size="lg" className="h-10 px-4" disabled={busy !== null} onClick={() => start(state.stepIndex, "resume")}>
                    {busy === "resume" ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4 fill-current" />}
                    Resume · step {state.stepIndex + 1} of {steps.length}
                  </Button>
                ) : (
                  <Button size="lg" className="h-10 px-4" disabled={busy !== null} onClick={() => start(0, "start", progress.done === steps.length)}>
                    {busy === "start" ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4 fill-current" />}
                    {progress.done === steps.length ? "Take the tour again" : progress.done > 0 ? "Continue tour" : "Start tour"}
                  </Button>
                )}
                {(resumable || progress.done > 0) && (
                  <Button variant="outline" size="lg" className="h-10 px-4" disabled={busy !== null} onClick={() => start(0, "restart", true)}>
                    {busy === "restart" ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />} Restart tour
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-4 md:flex-col md:gap-2">
            <ScoreRing value={progress.pct} size={128} stroke={10} label="% done" />
            <p className="text-xs text-muted-foreground tabular">
              {progress.done} of {progress.total} steps seen
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-2">
        {topics.map((topic, ti) => {
          const done = topic.steps.filter((s) => state.completed.includes(s.id)).length;
          const pct = Math.round((done / topic.steps.length) * 100);
          const firstIndex = steps.findIndex((s) => s.id === topic.steps[0]!.id);
          return (
            <motion.div
              key={`${track}-${topic.key}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: ti * 0.03 }}
            >
              <Collapsible className="group/topic rounded-2xl border bg-card shadow-soft">
                <div className="flex items-start gap-3 p-4">
                  <span
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-xl",
                      pct === 100 ? "bg-brand text-brand-foreground" : "bg-muted text-foreground",
                    )}
                  >
                    {pct === 100 ? <Check className="size-4" /> : <NavIcon name={topic.icon} className="size-4" />}
                  </span>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold">{topic.title}</h3>
                        <p className="text-xs text-muted-foreground">{topic.description}</p>
                      </div>
                      <span className="shrink-0 text-xs font-medium tabular">{pct}%</span>
                    </div>
                    <Meter value={pct} className="h-1" />
                    <div className="flex items-center justify-between gap-2">
                      <CollapsibleTrigger className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                        <ChevronRight className="size-3.5 transition-transform group-data-[state=open]/topic:rotate-90" />
                        {done}/{topic.steps.length} steps
                      </CollapsibleTrigger>
                      {enabled && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7"
                          disabled={busy !== null}
                          onClick={() => start(firstIndex, `topic-${topic.key}`)}
                        >
                          {busy === `topic-${topic.key}` ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3 fill-current" />}
                          {pct === 100 ? "Replay" : done > 0 ? "Continue" : "Start here"}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
                <CollapsibleContent>
                  <ol className="space-y-0.5 border-t px-2 py-2">
                    {topic.steps.map((s) => {
                      const seen = state.completed.includes(s.id);
                      const idx = steps.findIndex((x) => x.id === s.id);
                      return (
                        <li key={s.id}>
                          <button
                            type="button"
                            disabled={!enabled || busy !== null}
                            onClick={() => start(idx, `step-${s.id}`)}
                            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors enabled:hover:bg-muted/60 disabled:cursor-default"
                          >
                            <span
                              className={cn(
                                "flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] tabular",
                                seen ? "border-brand bg-brand text-brand-foreground" : "text-muted-foreground",
                              )}
                            >
                              {seen ? <Check className="size-3" /> : idx + 1}
                            </span>
                            <span className={cn("min-w-0 flex-1 truncate", seen && "text-muted-foreground")}>{s.title}</span>
                            {busy === `step-${s.id}` && <Loader2 className="size-3.5 animate-spin" />}
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </CollapsibleContent>
              </Collapsible>
            </motion.div>
          );
        })}
      </div>

      {progress.done > 0 && (
        <div className="flex justify-center">
          <ConfirmButton title="Reset tour progress?" description="All steps are marked as unseen again." confirmLabel="Reset" onConfirm={reset}>
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              <RotateCcw className="size-3.5" /> Reset progress
            </Button>
          </ConfirmButton>
        </div>
      )}
    </div>
  );
}
