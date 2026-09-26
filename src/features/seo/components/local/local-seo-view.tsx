"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Building2, Grid3x3, History, Loader2, MapPinned, MessagesSquare, Newspaper, RotateCw, Star, Store, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Panel } from "@/components/app/page";
import { EmptyState } from "@/components/app/empty-state";
import { ConfirmButton, StatusBadge } from "@/components/app/misc";
import type { LocalRun, LocalRunTool, LocalToolInput, listLocalRuns } from "@/server/seo/local";
import { formatUsd } from "@/server/seo/lib/costs";
import { createLocalRunAction, deleteLocalRunAction, getLocalRunAction, listLocalRunsAction, retryLocalCollectAction } from "../../actions/local";
import { useQueryParams } from "../../hooks/use-query-params";
import { formatDateTime, toastError, unwrap } from "../../lib/client";
import type { ClientPageInfo } from "../../server/page-context";
import { DataForSeoNotConfigured, ReadOnlyNote } from "../shared/empty-states";
import { BusinessSearchForm, LocalSerpForm, PostsForm, ProfileForm, QuestionsForm, RankGridForm, ReviewsForm, type FormCommon, type FormSeed } from "./forms";
import { BusinessSearchResult, LocalSerpResult, PostsResult, ProfileResult, QuestionsResult, ReviewsResult } from "./results";
import { RankGridResult } from "./rank-grid";
import { ACTIVE_STATUSES, isLocalTool, LOCAL_TOOLS, type PickedBusiness } from "./shared";
import { cn } from "@/lib/utils";

type HistoryItem = Awaited<ReturnType<typeof listLocalRuns>>[number];

const TOOL_ICONS: Record<LocalRunTool, typeof Store> = {
  business_search: Store,
  local_serp: MapPinned,
  rank_grid: Grid3x3,
  business_profile: Building2,
  reviews: Star,
  questions: MessagesSquare,
  posts: Newspaper,
};

const STATUS_LABEL: Record<string, { tone: string; label: string }> = {
  queued: { tone: "queued", label: "Queued" },
  running: { tone: "running", label: "Running" },
  processing: { tone: "running", label: "Collecting" },
  completed: { tone: "completed", label: "Completed" },
  failed: { tone: "failed", label: "Failed" },
};

function RunStatus({ status }: { status: string }) {
  const s = STATUS_LABEL[status] ?? { tone: status, label: status };
  return <StatusBadge status={s.tone} label={s.label} />;
}

function progressCopy(tool: LocalRunTool, status: string): { title: string; detail: string } {
  if (status === "queued") return { title: "Queued", detail: "Waiting for a background worker to pick up the run…" };
  switch (tool) {
    case "reviews":
      return { title: "Collecting reviews", detail: "DataForSEO is collecting reviews — usually ~20 s. Collecting a queued task is free." };
    case "posts":
      return { title: "Collecting posts", detail: "DataForSEO is collecting the business's posts — usually ~20 s. Collecting a queued task is free." };
    case "rank_grid":
      return { title: "Searching grid points", detail: "One Google Maps search per grid point, 3 at a time — a 3 × 3 grid takes ~20–40 s." };
    case "business_search":
      return { title: "Searching businesses", detail: "Querying Google Business listings around the location…" };
    case "local_serp":
      return { title: "Loading the local SERP", detail: "Rendering Google Maps results at the chosen coordinate…" };
    case "business_profile":
      return { title: "Reading the profile", detail: "Loading the Google Business Profile…" };
    case "questions":
      return { title: "Loading questions", detail: "Reading questions & answers from the profile…" };
  }
}

function Elapsed({ since }: { since: Date | string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.round((now - new Date(since).getTime()) / 1000));
  return <span className="tabular">{s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`}</span>;
}

export function LocalSeoView({ info, initialRuns }: { info: ClientPageInfo; initialRuns: HistoryItem[] }) {
  const { projectId } = info;
  const { params, set } = useQueryParams();
  const urlTool = params.get("tool");
  const runParam = params.get("run");

  const [history, setHistory] = useState<HistoryItem[]>(initialRuns);
  const [runs, setRuns] = useState<Record<string, LocalRun>>({});
  const [runErrors, setRunErrors] = useState<Record<string, string>>({});
  const [seeds, setSeeds] = useState<Partial<Record<LocalRunTool, FormSeed>>>({});
  const [busy, setBusy] = useState(false);
  const [pollNonce, setPollNonce] = useState(0);
  const runsRef = useRef(runs);
  useEffect(() => {
    runsRef.current = runs;
  });
  const lastSelected = useRef<Partial<Record<LocalRunTool, string>>>({});
  const startedHere = useRef(new Set<string>());

  const paramTool = runParam ? (history.find((h) => h.id === runParam)?.tool ?? runs[runParam]?.tool) : undefined;
  const activeTool: LocalRunTool = isLocalTool(urlTool) ? urlTool : isLocalTool(paramTool) ? paramTool : "business_search";
  const selectedRunId = runParam && (paramTool == null || paramTool === activeTool) ? runParam : (history.find((h) => h.tool === activeTool)?.id ?? null);
  useEffect(() => {
    if (selectedRunId) lastSelected.current[activeTool] = selectedRunId;
  }, [selectedRunId, activeTool]);

  // Fetch the selected run and poll every 2 s while it is queued / running / processing.
  useEffect(() => {
    if (!selectedRunId) return;
    const existing = runsRef.current[selectedRunId];
    if (existing && !ACTIVE_STATUSES.has(existing.status)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const res = await getLocalRunAction(projectId, selectedRunId);
      if (cancelled) return;
      if (!res.ok) {
        setRunErrors((e) => ({ ...e, [selectedRunId]: res.error }));
        return;
      }
      const run = res.data;
      const previous = runsRef.current[run.id];
      setRuns((r) => ({ ...r, [run.id]: run }));
      setHistory((h) => h.map((x) => (x.id === run.id ? { ...x, status: run.status, error: run.error, costUsd: run.costUsd, completedAt: run.completedAt } : x)));
      if (ACTIVE_STATUSES.has(run.status)) {
        timer = setTimeout(load, 2000);
      } else if (startedHere.current.has(run.id) && (!previous || ACTIVE_STATUSES.has(previous.status))) {
        startedHere.current.delete(run.id);
        if (run.status === "completed") toast.success(`${run.label} — done`);
        else toast.error(run.error ?? "The run failed");
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [projectId, selectedRunId, pollNonce]);

  const blockedReason = !info.configured
    ? "Connect DataForSEO (Admin → Data Providers) to run Local SEO tools."
    : !info.canRun
      ? "You need the “Run paid SEO research” permission to run Local SEO tools."
      : null;
  const common: FormCommon = { projectId, blockedReason, busy, languageCode: info.market.languageCode, marketLocationCode: info.market.locationCode };

  const switchTool = (tool: LocalRunTool) => set({ tool, run: lastSelected.current[tool] ?? null });

  const runTool = async <T extends LocalRunTool>(tool: T, input: LocalToolInput<T>) => {
    setBusy(true);
    try {
      const created = unwrap(await createLocalRunAction(projectId, tool, input));
      startedHere.current.add(created.id);
      const list = await listLocalRunsAction(projectId);
      if (list.ok) setHistory(list.data);
      lastSelected.current[tool] = created.id;
      set({ tool, run: created.id }, { push: true });
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  const useBusiness = (business: PickedBusiness, tool: LocalRunTool) => {
    setSeeds((s) => ({ ...s, [tool]: { key: Date.now(), business } }));
    set({ tool, run: lastSelected.current[tool] ?? null });
    toast.message(`${business.title ?? "Business"} loaded into ${LOCAL_TOOLS.find((t) => t.key === tool)?.label ?? tool}`);
  };

  const removeRun = async (id: string) => {
    try {
      unwrap(await deleteLocalRunAction(projectId, id));
      setHistory((h) => h.filter((x) => x.id !== id));
      setRuns((r) => {
        const next = { ...r };
        delete next[id];
        return next;
      });
      for (const [tool, runId] of Object.entries(lastSelected.current)) if (runId === id) delete lastSelected.current[tool as LocalRunTool];
      if (runParam === id) set({ run: null });
    } catch (err) {
      toastError(err);
    }
  };

  const retryCollect = async (id: string) => {
    try {
      unwrap(await retryLocalCollectAction(projectId, id));
      startedHere.current.add(id);
      setRuns((r) => {
        const next = { ...r };
        delete next[id];
        return next;
      });
      setHistory((h) => h.map((x) => (x.id === id ? { ...x, status: "processing", error: null } : x)));
      setPollNonce((n) => n + 1);
    } catch (err) {
      toastError(err);
    }
  };

  const toolHistory = useMemo(() => history.filter((h) => h.tool === activeTool), [history, activeTool]);
  const meta = LOCAL_TOOLS.find((t) => t.key === activeTool)!;
  const selectedRun = selectedRunId ? runs[selectedRunId] : undefined;
  const selectedError = selectedRunId ? runErrors[selectedRunId] : undefined;

  return (
    <div className="space-y-4">
      <nav className="scrollbar-none -mx-3 flex gap-1 overflow-x-auto px-3 sm:mx-0 sm:px-0" aria-label="Local SEO tools">
        <div className="flex gap-1 rounded-xl bg-muted/70 p-1">
          {LOCAL_TOOLS.map((t) => {
            const active = t.key === activeTool;
            const running = history.some((h) => h.tool === t.key && ACTIVE_STATUSES.has(h.status));
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => switchTool(t.key)}
                className={cn(
                  "relative flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
                aria-current={active ? "page" : undefined}
              >
                {active && <motion.span layoutId="local-tab" className="absolute inset-0 rounded-lg bg-background shadow-xs ring-1 ring-border" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
                <ToolIcon tool={t.key} className="relative size-3.5" />
                <span className="relative">{t.short}</span>
                {running && <span className="relative size-1.5 animate-pulse rounded-full bg-info" />}
              </button>
            );
          })}
        </div>
      </nav>

      {!info.canRun && info.configured && <ReadOnlyNote />}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Panel title={meta.label} description={meta.description} icon={<ToolIcon tool={activeTool} className="size-4 text-brand" />}>
            <div className={activeTool === "business_search" ? "" : "hidden"}>
              <BusinessSearchForm key={seeds.business_search?.key ?? 0} seed={seeds.business_search} common={common} onRun={(i) => runTool("business_search", i)} />
            </div>
            <div className={activeTool === "local_serp" ? "" : "hidden"}>
              <LocalSerpForm key={seeds.local_serp?.key ?? 0} seed={seeds.local_serp} common={common} onRun={(i) => runTool("local_serp", i)} />
            </div>
            <div className={activeTool === "rank_grid" ? "" : "hidden"}>
              <RankGridForm key={seeds.rank_grid?.key ?? 0} seed={seeds.rank_grid} common={common} onRun={(i) => runTool("rank_grid", i)} />
            </div>
            <div className={activeTool === "business_profile" ? "" : "hidden"}>
              <ProfileForm key={seeds.business_profile?.key ?? 0} seed={seeds.business_profile} common={common} onRun={(i) => runTool("business_profile", i)} />
            </div>
            <div className={activeTool === "reviews" ? "" : "hidden"}>
              <ReviewsForm key={seeds.reviews?.key ?? 0} seed={seeds.reviews} common={common} onRun={(i) => runTool("reviews", i)} />
            </div>
            <div className={activeTool === "questions" ? "" : "hidden"}>
              <QuestionsForm key={seeds.questions?.key ?? 0} seed={seeds.questions} common={common} onRun={(i) => runTool("questions", i)} />
            </div>
            <div className={activeTool === "posts" ? "" : "hidden"}>
              <PostsForm key={seeds.posts?.key ?? 0} seed={seeds.posts} common={common} onRun={(i) => runTool("posts", i)} />
            </div>
          </Panel>

          <Panel
            title="History"
            icon={<History className="size-4 text-muted-foreground" />}
            description={`${toolHistory.length} previous ${meta.short.toLowerCase()} run${toolHistory.length === 1 ? "" : "s"}`}
            contentClassName="p-2"
          >
            {toolHistory.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">Runs are saved here for the whole project.</p>
            ) : (
              <ul className="max-h-96 space-y-0.5 overflow-y-auto">
                <AnimatePresence initial={false}>
                  {toolHistory.map((h) => (
                    <motion.li
                      key={h.id}
                      layout
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, height: 0 }}
                      className={cn("group flex items-center gap-2 rounded-lg px-2 py-2 transition-colors", h.id === selectedRunId ? "bg-brand-soft/60" : "hover:bg-muted/60")}
                    >
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => set({ tool: h.tool, run: h.id })}>
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{h.label}</span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                          <RunStatus status={h.status} />
                          <span className="tabular" suppressHydrationWarning>
                            {formatDateTime(h.createdAt)}
                          </span>
                          {h.costUsd > 0 && <span className="tabular">{formatUsd(h.costUsd)}</span>}
                        </div>
                      </button>
                      {info.canRun && (
                        <ConfirmButton title="Delete this run?" description="The stored result is removed from the project history." confirmLabel="Delete" destructive onConfirm={() => removeRun(h.id)}>
                          <Button variant="ghost" size="icon-xs" className="opacity-60 group-hover:opacity-100" aria-label={`Delete ${h.label}`}>
                            <Trash2 />
                          </Button>
                        </ConfirmButton>
                      )}
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </Panel>
        </div>

        <Panel
          className="min-h-[24rem]"
          title={selectedRun?.label ?? "Results"}
          description={
            selectedRun ? (
              <span className="flex flex-wrap items-center gap-x-2">
                <span>{formatDateTime(selectedRun.createdAt)}</span>
                {selectedRun.costUsd > 0 && <span className="tabular">· cost {formatUsd(selectedRun.costUsd)}</span>}
              </span>
            ) : (
              meta.description
            )
          }
          actions={selectedRun ? <RunStatus status={selectedRun.status} /> : undefined}
        >
          {!selectedRunId ? (
            info.configured ? (
              <EmptyState
                icon={TOOL_ICONS[activeTool]}
                title={`No ${meta.label.toLowerCase()} yet`}
                description="Fill in the form and run it — results are stored in this project's history."
              />
            ) : (
              <DataForSeoNotConfigured isAdmin={info.isAdmin} feature="Local SEO" />
            )
          ) : selectedError && !selectedRun ? (
            <EmptyState icon={TriangleAlert} title="Couldn't load this run" description={selectedError} />
          ) : !selectedRun ? (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-40 w-full rounded-xl" />
            </div>
          ) : ACTIVE_STATUSES.has(selectedRun.status) ? (
            <RunProgress run={selectedRun} />
          ) : selectedRun.status === "failed" ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium">This run failed</p>
                  <p className="text-sm break-words text-muted-foreground">{selectedRun.error ?? "Unknown error"}</p>
                </div>
              </div>
              {selectedRun.taskId && (selectedRun.tool === "reviews" || selectedRun.tool === "posts") && info.canRun && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" onClick={() => retryCollect(selectedRun.id)}>
                    <RotateCw /> Retry collection
                  </Button>
                  <span className="text-xs text-muted-foreground">Free — the DataForSEO task was already paid for.</span>
                </div>
              )}
            </div>
          ) : (
            <RunResult run={selectedRun} onUse={useBusiness} />
          )}
        </Panel>
      </div>
    </div>
  );
}

function ToolIcon({ tool, className }: { tool: LocalRunTool; className?: string }) {
  const Icon = TOOL_ICONS[tool];
  return <Icon className={className} />;
}

function RunProgress({ run }: { run: LocalRun }) {
  const copy = progressCopy(run.tool as LocalRunTool, run.status);
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-4 py-14 text-center">
      <div className="relative flex size-14 items-center justify-center">
        <motion.span
          className="absolute inset-0 rounded-full bg-brand/20"
          animate={{ scale: [1, 1.35, 1], opacity: [0.6, 0, 0.6] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        />
        <span className="relative flex size-11 items-center justify-center rounded-full bg-brand-soft">
          <Loader2 className="size-5 animate-spin text-brand" />
        </span>
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold">{copy.title}…</p>
        <p className="max-w-sm text-sm text-muted-foreground">{copy.detail}</p>
        <p className="text-xs text-muted-foreground">
          Elapsed <Elapsed since={run.createdAt} />
          {run.status === "processing" && run.collectAttempts > 0 ? ` · check ${run.collectAttempts}` : ""}
        </p>
      </div>
    </div>
  );
}

function RunResult({ run, onUse }: { run: LocalRun; onUse: (b: PickedBusiness, tool: LocalRunTool) => void }) {
  switch (run.tool as LocalRunTool) {
    case "business_search":
      return <BusinessSearchResult result={run.result} onUse={onUse} />;
    case "local_serp":
      return <LocalSerpResult result={run.result} onUse={onUse} />;
    case "rank_grid":
      return <RankGridResult result={run.result} />;
    case "business_profile":
      return <ProfileResult result={run.result} onUse={onUse} />;
    case "reviews":
      return <ReviewsResult result={run.result} />;
    case "questions":
      return <QuestionsResult result={run.result} />;
    case "posts":
      return <PostsResult result={run.result} />;
  }
}
