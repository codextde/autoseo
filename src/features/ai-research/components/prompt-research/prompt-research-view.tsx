"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { AlertTriangle, ChevronsDownUp, ChevronsUpDown, Download, List, ListTree, Loader2, Plus, RefreshCw, SlidersHorizontal, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { PageHeader, Panel } from "@/components/app/page";
import { SearchInput } from "@/components/app/filters";
import { Meter } from "@/components/app/metrics";
import { EmptyState } from "@/components/app/empty-state";
import { useUrlListState, useUrlPatch, useUrlState } from "@/hooks/use-url-state";
import { cn } from "@/lib/utils";
import { HowWeGetDataDialog } from "../shared/info-dialog";
import { ProviderNotice } from "../shared/bits";
import { useJobPoll } from "../shared/use-job-poll";
import { downloadCsv, slugify } from "../../lib/csv";
import { addToTrackerAction, autoGenerateAction, deleteItemsAction, refreshVolumesAction } from "../../actions/research";
import { activeFilterCount, applyFilters, facetCounts, NO_PERSONA, topicKey, type FilterKey, type Filters } from "./filter-logic";
import { FilterPanel } from "./filter-panel";
import { ResearchTable } from "./research-table";
import { ListSwitcher } from "./list-switcher";
import { ImportDialog } from "./import-dialog";
import { PromptSetHelperDialog } from "./prompt-set-helper";
import type { ResearchItem, ResearchList } from "../../types";

export type PromptResearchProps = {
  projectId: string;
  lists: ResearchList[];
  active: ResearchList;
  items: ResearchItem[];
  quota: { used: number; limit: number; frequency: string };
  providers: { dataforseo: boolean; llm: boolean };
  brandContext: boolean;
  brandName: string;
  suggestions: { topics: string[]; personas: string[]; competitors: string[] };
  project: { country: string; language: string };
  canManage: boolean;
};

export function PromptResearchView(props: PromptResearchProps) {
  const { projectId, lists, active, items, quota, providers, canManage } = props;
  const router = useRouter();
  const [q, setQ] = useUrlState("q", "");
  const [view, setView] = useUrlState("view", "tree");
  const [helperParam] = useUrlState("helper", "");
  const [patchUrl] = useUrlPatch();
  const [helperTopics] = useUrlListState("ht");
  const [helperPersonas] = useUrlListState("hp");
  const [topics, setTopics] = useUrlListState("topics");
  const [len, setLen] = useUrlListState("len");
  const [funnel, setFunnel] = useUrlListState("funnel");
  const [brand, setBrand] = useUrlListState("brand");
  const [personas, setPersonas] = useUrlListState("personas");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [helperOpen, setHelperOpen] = useState(helperParam === "1");
  const [busy, start] = useTransition();
  const autoTried = useRef(false);

  const generating = active.status === "generating";
  const job = useJobPoll(projectId, generating ? active.jobId : null, { refreshOnProgress: true, intervalMs: 3000 });
  const [enrichId, setEnrichId] = useState<string | null>(null);
  const enrichStatus = useJobPoll(projectId, enrichId, { onDone: () => setEnrichId(null) });

  // First visit: auto-generate the default list when brand knowledge exists.
  useEffect(() => {
    if (autoTried.current) return;
    autoTried.current = true;
    if (!canManage || !providers.llm || !props.brandContext) return;
    if (!active.isDefault || items.length > 0 || active.status !== "idle") return;
    void autoGenerateAction(projectId).then((res) => {
      if (res.ok && res.data.jobId) {
        toast.info("Generating your first prompt set from Brand Knowledge…");
        router.refresh();
      }
    });
  }, [canManage, providers.llm, props.brandContext, active.isDefault, active.status, items.length, projectId, router]);

  // Selection resets when switching lists: the page remounts this view with key={list id}.

  const filters: Filters = { q, topics, len, funnel, brand, personas };
  const setters: Record<FilterKey, (v: string[]) => void> = { topics: setTopics, len: setLen, funnel: setFunnel, brand: setBrand, personas: setPersonas };
  const filtered = useMemo(() => applyFilters(items, filters), [items, q, topics, len, funnel, brand, personas]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => facetCounts(items, filters), [items, q, topics, len, funnel, brand, personas]); // eslint-disable-line react-hooks/exhaustive-deps
  const allTopics = useMemo(() => [...new Set(items.map(topicKey))], [items]);
  const allPersonas = useMemo(() => [...new Set(items.map((i) => i.persona?.trim() || NO_PERSONA))], [items]);
  const nActive = activeFilterCount(filters);

  const toggleFilter = (key: FilterKey, value: string) => {
    const cur = filters[key];
    setters[key](cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]);
  };
  // One URL update for all groups (separate setters would overwrite each other).
  const clearFilters = (withSearch = false) =>
    patchUrl({ topics: null, len: null, funnel: null, brand: null, personas: null, ...(withSearch ? { q: null } : {}) });

  const add = (ids: string[]) => {
    const targets = ids.filter((id) => !items.find((i) => i.id === id)?.trackedPromptId);
    if (!targets.length) return;
    setPendingIds((p) => new Set([...p, ...targets]));
    start(async () => {
      const res = await addToTrackerAction(projectId, targets);
      setPendingIds((p) => {
        const next = new Set(p);
        for (const id of targets) next.delete(id);
        return next;
      });
      if (!res.ok) return void toast.error(res.error);
      const { added, linked, skippedOverLimit } = res.data;
      toast.success(
        `${added} prompt${added === 1 ? "" : "s"} added to the tracker${linked ? ` · ${linked} already tracked` : ""}${skippedOverLimit ? ` · ${skippedOverLimit} skipped (limit reached)` : ""}`,
      );
      setSelected((s) => {
        const next = new Set(s);
        for (const id of targets) next.delete(id);
        return next;
      });
      router.refresh();
    });
  };

  const removeSelected = () =>
    start(async () => {
      const ids = [...selected];
      const res = await deleteItemsAction(projectId, ids);
      if (!res.ok) return void toast.error(res.error);
      toast.success(`${ids.length} prompts removed from the list`);
      setSelected(new Set());
      router.refresh();
    });

  const exportCsv = () => {
    const rows = filtered.map((i) => [
      i.text,
      i.topic ?? "",
      i.funnelStage?.toUpperCase() ?? "",
      i.persona ?? "",
      i.intent ?? "",
      i.branded ? "yes" : "no",
      i.competitorMentioned ?? "",
      i.length ?? "",
      i.keyword ?? "",
      i.volume ?? "",
      i.volumeSource ?? "",
      i.volumeScore != null ? Math.round(i.volumeScore * 10) : "",
      i.addedAt ? format(new Date(i.addedAt), "yyyy-MM-dd") : "",
    ]);
    downloadCsv(
      `prompt-research-${slugify(active.name)}-${format(new Date(), "yyyy-MM-dd")}.csv`,
      ["Prompt", "Topic", "Funnel stage", "Persona", "Intent", "Branded", "Competitor", "Length", "Topic keyword", "Volume", "Volume source", "Volume score (0-10)", "Added to tracker"],
      rows,
    );
  };

  const refreshVolumes = () =>
    start(async () => {
      const res = await refreshVolumesAction(projectId, active.id);
      if (!res.ok) return void toast.error(res.error);
      if (res.data.jobId) {
        setEnrichId(res.data.jobId);
        toast.info("Refreshing volumes…");
      }
    });

  const untrackedSelected = [...selected].filter((id) => !items.find((i) => i.id === id)?.trackedPromptId);
  const progress = job?.progress;
  const pct = progress?.total ? Math.round(((progress.done ?? 0) / progress.total) * 100) : null;

  const filterPanel = (
    <FilterPanel
      filters={filters}
      counts={counts}
      topics={allTopics}
      personas={allPersonas}
      onToggle={toggleFilter}
      onClear={() => clearFilters()}
      activeCount={nActive}
    />
  );

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageHeader
        title="Prompt Research"
        description="Discover the questions your audience asks AI assistants — with topic, funnel stage, persona and search demand — and add the best ones to your tracker."
        actions={
          <>
            <ListSwitcher projectId={projectId} lists={lists} active={active} canManage={canManage} />
            {canManage && <ImportDialog projectId={projectId} activeList={active} />}
            <HowWeGetDataDialog
              title="How we get this data"
              intro="Prompt Research combines your Brand Knowledge with AI generation and real search demand."
              steps={[
                { title: "Brand Knowledge", body: "Your brand profile, interest clusters (what people search around your category), sitemap sections and buyer personas define topics and perspectives." },
                { title: "Prompt generation", body: "The Prompt Set Helper asks your local agent (Claude Code / Codex) or configured AI API to write realistic, conversational prompts per topic, persona and funnel stage — with a controlled brand vs non-brand mix." },
                {
                  title: "Search demand",
                  body: providers.dataforseo
                    ? "Every prompt gets a topic keyword. We fetch its monthly Google search volume from DataForSEO (Labs keyword overview) and show it as a 10-segment bar relative to the list."
                    : "Without DataForSEO the AI estimates relative demand (1–10), labelled “est.”. Connect DataForSEO in Admin → Data Providers for real search volumes.",
                },
                { title: "Tracking", body: "Adding a prompt creates a tracked prompt (tagged with its topic) that is asked to all enabled AI engines on your tracking schedule." },
              ]}
            />
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!filtered.length}>
              <Download className="size-3.5" /> <span className="hidden sm:inline">Export</span>
            </Button>
            {canManage && (
              <Button size="sm" onClick={() => setHelperOpen(true)}>
                <Sparkles className="size-3.5" /> Prompt Set Helper
              </Button>
            )}
          </>
        }
      />

      {!providers.llm && canManage && (
        <ProviderNotice title="No AI provider connected" href="/admin/ai" linkLabel="Admin → AI Providers">
          Connect a local agent (Claude Code / Codex) or add an API key to generate prompt sets. You can still import lists.
        </ProviderNotice>
      )}

      {generating && (
        <div className="rounded-2xl border bg-card p-4 shadow-soft">
          <div className="flex items-center gap-3">
            <Loader2 className="size-4 shrink-0 animate-spin text-brand" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Generating prompts for “{active.name}”</p>
              <p className="truncate text-xs text-muted-foreground">
                {progress?.message ?? "Queued — waiting for a worker…"} · prompts appear below as they are created
              </p>
            </div>
            {pct != null && <span className="text-sm font-medium tabular">{pct}%</span>}
          </div>
          {pct != null && <Progress value={pct} className="mt-3" />}
        </div>
      )}
      {active.status === "failed" && active.error && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/25 bg-destructive/5 px-3.5 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">The last generation failed</p>
            <p className="text-muted-foreground">{active.error}</p>
          </div>
          {canManage && (
            <Button size="sm" variant="outline" onClick={() => setHelperOpen(true)}>
              Try again
            </Button>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <div className="sticky top-4 rounded-2xl border bg-card p-3 shadow-soft">{filterPanel}</div>
        </aside>

        <Panel contentClassName="space-y-3 p-3 sm:p-4" className="min-w-0">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <SearchInput value={q} onChange={(v) => setQ(v || null)} placeholder="Search prompts…" className="min-w-0 flex-1 sm:max-w-xs" />
              <Drawer>
                <DrawerTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 lg:hidden">
                    <SlidersHorizontal className="size-3.5" /> Filters
                    {nActive > 0 && <span className="rounded-full bg-foreground px-1.5 text-[10px] text-background">{nActive}</span>}
                  </Button>
                </DrawerTrigger>
                <DrawerContent className="max-h-[85dvh]">
                  <DrawerHeader>
                    <DrawerTitle>Filters</DrawerTitle>
                  </DrawerHeader>
                  <div className="overflow-y-auto px-4 pb-8">{filterPanel}</div>
                </DrawerContent>
              </Drawer>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-lg bg-muted p-0.5">
                {[
                  { key: "tree", label: "Tree", icon: ListTree },
                  { key: "flat", label: "List", icon: List },
                ].map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => setView(v.key)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium",
                      view === v.key ? "bg-background shadow-xs" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <v.icon className="size-3.5" /> {v.label}
                  </button>
                ))}
              </div>
              {view === "tree" && (
                <>
                  <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setCollapsed(new Set())}>
                    <ChevronsUpDown className="size-3.5" /> <span className="hidden md:inline">Expand all</span>
                  </Button>
                  <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setCollapsed(new Set(allTopics))}>
                    <ChevronsDownUp className="size-3.5" /> <span className="hidden md:inline">Collapse all</span>
                  </Button>
                </>
              )}
              <div className="ml-auto flex items-center gap-2 rounded-lg border px-2.5 py-1" title="Tracked prompts vs. the per-project limit (Admin → Limits)">
                <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{quota.frequency}</span>
                <span className="text-xs font-medium tabular">
                  {quota.used}/{quota.limit}
                </span>
                <Meter value={quota.used} max={quota.limit} className="w-12" tone={quota.used >= quota.limit ? "destructive" : "brand"} />
              </div>
            </div>
          </div>

          {canManage && selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/70 px-3 py-2 text-sm">
              <span className="font-medium tabular">{selected.size} selected</span>
              <Button size="sm" onClick={() => add(untrackedSelected)} disabled={busy || !untrackedSelected.length}>
                <Plus className="size-3.5" /> Add {untrackedSelected.length} to tracker
              </Button>
              <Button size="sm" variant="ghost" onClick={removeSelected} disabled={busy}>
                <Trash2 className="size-3.5" /> Remove from list
              </Button>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </div>
          )}

          {items.length === 0 ? (
            generating ? (
              <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted-foreground">
                <Loader2 className="size-5 animate-spin" />
                Your prompts are being generated…
              </div>
            ) : (
              <EmptyState
                icon={Sparkles}
                title="No prompts in this list yet"
                description={
                  providers.llm
                    ? props.brandContext
                      ? "Use the Prompt Set Helper to generate a balanced prompt set, or import an existing list."
                      : "Tip: run the Brand Knowledge analyses first (profile, interest, personas) — prompts get much better. Or start right away with the Prompt Set Helper."
                    : "Connect a local agent or AI provider to generate prompts, or import an existing list (CSV / paste)."
                }
                action={
                  canManage ? (
                    <div className="flex flex-wrap justify-center gap-2">
                      {providers.llm && (
                        <Button size="sm" onClick={() => setHelperOpen(true)}>
                          <Sparkles className="size-3.5" /> Prompt Set Helper
                        </Button>
                      )}
                      {!props.brandContext && (
                        <Button size="sm" variant="outline" asChild>
                          <Link href={`/p/${projectId}/knowledge`}>Open Brand Knowledge</Link>
                        </Button>
                      )}
                    </div>
                  ) : undefined
                }
              />
            )
          ) : filtered.length === 0 ? (
            <EmptyState compact title="No prompts match your filters" description="Clear the search or filters to see all prompts." action={{ label: "Clear filters", onClick: () => clearFilters(true) }} />
          ) : (
            <ResearchTable
              items={filtered}
              view={view === "flat" ? "flat" : "tree"}
              collapsed={collapsed}
              onToggleGroup={(t) =>
                setCollapsed((c) => {
                  const next = new Set(c);
                  if (next.has(t)) next.delete(t);
                  else next.add(t);
                  return next;
                })
              }
              selected={selected}
              onSelectedChange={setSelected}
              canManage={canManage}
              pending={pendingIds}
              onAdd={add}
              brandName={props.brandName}
            />
          )}

          {items.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="tabular">
                Showing {filtered.length.toLocaleString("en-US")} of {items.length.toLocaleString("en-US")} prompts
                {" · "}
                {items.some((i) => i.volumeSource === "dataforseo") ? "volumes: DataForSEO" : items.some((i) => i.volumeSource === "estimated") ? "volumes: AI estimate" : "no volume data"}
              </span>
              {canManage && (providers.dataforseo || providers.llm) && (
                <Button variant="ghost" size="xs" onClick={refreshVolumes} disabled={busy || !!enrichId || generating}>
                  <RefreshCw className={cn("size-3", enrichId && "animate-spin")} />
                  {enrichId ? (enrichStatus?.progress?.message ?? "Refreshing volumes…") : "Refresh volumes"}
                </Button>
              )}
            </div>
          )}
        </Panel>
      </div>

      {canManage && (
        <PromptSetHelperDialog
          open={helperOpen}
          onOpenChange={(v) => {
            setHelperOpen(v);
            if (!v && helperParam) patchUrl({ helper: null, ht: null, hp: null });
          }}
          projectId={projectId}
          lists={lists}
          activeList={active}
          suggestions={props.suggestions}
          project={props.project}
          providers={providers}
          initialTopics={helperTopics.length ? helperTopics : undefined}
          initialPersonas={helperPersonas.length ? helperPersonas : undefined}
        />
      )}
    </div>
  );
}
