"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, ExternalLink, FileText, ScanSearch, Sparkles, Trash2, TrendingUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { FilterBar, MultiSelect, SearchInput } from "@/components/app/filters";
import { PageContainer, PageHeader, Panel, TabNav } from "@/components/app/page";
import { ConfirmButton, TimeAgo } from "@/components/app/misc";
import { StatCard } from "@/components/app/metrics";
import { ScoreRing, TrendChart } from "@/components/app/charts";
import { useUrlListState, useUrlState } from "@/hooks/use-url-state";
import { IntegrationConnect } from "@/features/optimize/integrations/components";
import { ProviderGlyph } from "@/features/optimize/integrations/components/provider-glyph";
import type { ConnectedIntegration } from "@/server/optimize/integrations/types";
import type { ContentListItem } from "@/server/optimize/content/service";
import { aeoBand } from "@/server/optimize/content/aeo-score";
import { CONTENT_STATUS_META } from "@/features/optimize/constants";
import { safeHttpUrl } from "@/features/optimize/shared/safe-url";
import { deleteContentAction } from "../actions";
import { AeoScoreChip, ContentStatusBadge, bandColor } from "./content-ui";
import { GenerateDialog, type Persona } from "./generate-dialog";
import { OptimizeUrlDialog } from "./optimize-url-dialog";
import { PersonasView } from "./personas-view";

export type ContentDashboard = {
  avgScore: number | null;
  optimized: number;
  primary: number;
  published: number;
  review: number;
  drafts: number;
  generating: number;
  total: number;
  improving: { id: string; title: string; score: number; baseline: number; delta: number; url: string | null }[];
  trend: { date: string; score: number; pages: number }[];
};

type Props = {
  projectId: string;
  domain: string;
  language: string;
  items: ContentListItem[];
  dashboard: ContentDashboard;
  personas: Persona[];
  personaJobs: string[];
  connected: ConnectedIntegration[];
  canEdit: boolean;
  canManage: boolean;
  aiAvailable: boolean;
};

export function ContentView({ projectId, domain, language, items, dashboard, personas, personaJobs, connected, canEdit, canManage, aiAvailable }: Props) {
  const router = useRouter();
  const [tab] = useUrlState("tab", "content");
  const [q, setQ] = useUrlState("q", "");
  const [statuses, setStatuses] = useUrlListState("status");
  const [bands, setBands] = useUrlListState("band");
  const [genOpen, setGenOpen] = useState(false);
  const [urlOpen, setUrlOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();

  // Keep the list fresh while drafts are generating.
  const generating = items.some((i) => i.status === "generating");
  useEffect(() => {
    if (!generating) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [generating, router]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((i) => {
      if (statuses.length && !statuses.includes(i.status)) return false;
      if (bands.length && (i.aeoScore == null || !bands.includes(aeoBand(i.aeoScore).key))) return false;
      if (needle && !`${i.title} ${i.targetPrompt ?? ""} ${i.targetKeyword ?? ""} ${i.sourceUrl ?? ""}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [items, q, statuses, bands]);

  const remove = (ids: string[]) =>
    start(async () => {
      const res = await deleteContentAction(projectId, ids);
      if (!res.ok) return void toast.error(res.error);
      toast.success(`Deleted ${ids.length} item${ids.length === 1 ? "" : "s"}`);
      setSelected(new Set());
      router.refresh();
    });

  const columns: Column<ContentListItem>[] = [
    {
      id: "title",
      header: "Content",
      sortValue: (i) => i.title.toLowerCase(),
      cell: (i) => (
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            {i.kind === "rewrite" ? <ScanSearch className="size-4" /> : <FileText className="size-4" />}
          </span>
          <div className="min-w-0">
            <Link href={`/p/${projectId}/content/${i.id}`} className="line-clamp-1 font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
              {i.title}
            </Link>
            <p className="line-clamp-1 text-xs text-muted-foreground">
              {i.kind === "rewrite" && i.sourceUrl ? i.sourceUrl.replace(/^https?:\/\/(www\.)?/, "") : (i.targetPrompt ?? "No target question set")}
            </p>
            {i.status === "failed" && i.error && <p className="line-clamp-1 text-xs text-destructive">{i.error}</p>}
          </div>
        </div>
      ),
    },
    { id: "status", header: "Status", sortValue: (i) => i.status, cell: (i) => <ContentStatusBadge status={i.status} stage={i.generationStage} />, width: "140px" },
    {
      id: "score",
      header: "AEO score",
      sortValue: (i) => i.aeoScore ?? -1,
      cell: (i) => <AeoScoreChip score={i.aeoScore} baseline={i.baselineScore} />,
      hint: "0–100 across Extractability, Fact density, Structure, Schema markup, Depth and Metadata. 87+ = Primary Source.",
    },
    { id: "keyword", header: "Target keyword", hideBelow: "lg", sortValue: (i) => i.targetKeyword ?? "", cell: (i) => <span className="text-xs">{i.targetKeyword ?? "—"}</span> },
    { id: "words", header: "Words", hideBelow: "xl", align: "right", sortValue: (i) => i.wordCount, cell: (i) => <span className="text-xs tabular">{i.wordCount ? i.wordCount.toLocaleString() : "—"}</span> },
    { id: "updated", header: "Updated", hideBelow: "md", sortValue: (i) => i.updatedAt, cell: (i) => <TimeAgo date={i.updatedAt} className="text-xs text-muted-foreground" /> },
    {
      id: "published",
      header: "Published",
      hideBelow: "lg",
      cell: (i) =>
        safeHttpUrl(i.publishedUrl) ? (
          <a href={safeHttpUrl(i.publishedUrl)!} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex max-w-44 items-center gap-1.5 text-xs text-brand hover:underline">
            {i.publishProvider && <ProviderGlyph provider={i.publishProvider} size="xs" />}
            <span className="truncate">{i.publishedUrl!.replace(/^https?:\/\/(www\.)?/, "")}</span>
            <ExternalLink className="size-3 shrink-0" />
          </a>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ];

  const avg = dashboard.avgScore;
  return (
    <PageContainer>
      <PageHeader
        title="Content"
        description="Expert-backed drafts grounded in real sources, scored for how likely AI engines are to extract and cite them."
        actions={
          tab === "content" ? (
            <>
              <IntegrationConnect projectId={projectId} kind="cms" connected={connected} canManage={canManage} />
              <Button variant="outline" size="sm" asChild>
                <a href={`/p/${projectId}/content/export`} download>
                  <Download className="size-3.5" /> Export CSV
                </a>
              </Button>
              {canEdit && (
                <Button variant="outline" size="sm" onClick={() => setUrlOpen(true)}>
                  <ScanSearch className="size-3.5" /> Optimize URL
                </Button>
              )}
              {canEdit && (
                <Button size="sm" onClick={() => setGenOpen(true)}>
                  <Sparkles className="size-3.5" /> Generate content
                </Button>
              )}
            </>
          ) : null
        }
      />
      <TabNav
        active={tab}
        tabs={[
          { key: "content", label: "Content", href: `/p/${projectId}/content` },
          { key: "personas", label: "Expert personas", href: `/p/${projectId}/content?tab=personas`, badge: <span className="ml-1.5 text-xs text-muted-foreground tabular">{personas.length}</span> },
        ]}
      />

      {tab === "personas" ? (
        <PersonasView projectId={projectId} personas={personas} runningTopics={personaJobs} canEdit={canEdit} aiAvailable={aiAvailable} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Average AEO score" value={avg ?? "—"} footer={avg != null ? aeoBand(avg).label : "No scored content yet"}>
              {avg != null && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full" style={{ width: `${avg}%`, background: bandColor(avg) }} />
                </div>
              )}
            </StatCard>
            <StatCard label="Pages optimized" value={dashboard.optimized} footer={`${dashboard.primary} in the Primary Source band (87+)`} />
            <StatCard label="Published" value={dashboard.published} footer={`${dashboard.review} in review · ${dashboard.drafts} drafts`} />
            <StatCard label="In progress" value={dashboard.generating} footer={dashboard.generating ? "Drafts being generated" : "Nothing generating"} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <Panel title="Score trend" description="Weekly average AEO score of your content">
              {dashboard.trend.length >= 2 ? (
                <TrendChart data={dashboard.trend} series={[{ key: "score", label: "Avg AEO score", color: "var(--brand)" }]} height={200} domain={[0, 100]} />
              ) : (
                <EmptyState compact icon={TrendingUp} title="Not enough history yet" description="Scores are snapshotted on every edit — the trend appears after a few changes." />
              )}
            </Panel>
            <Panel title="Top improving pages" icon={<TrendingUp className="size-4 text-muted-foreground" />}>
              {dashboard.improving.length ? (
                <ol className="space-y-2">
                  {dashboard.improving.map((p) => (
                    <li key={p.id}>
                      <Link href={`/p/${projectId}/content/${p.id}`} className="flex items-center gap-3 rounded-lg p-1.5 hover:bg-muted">
                        <ScoreRing value={p.score} size={40} stroke={4} color={bandColor(p.score)} />
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-1 text-sm font-medium">{p.title}</span>
                          <span className="text-xs text-muted-foreground tabular">
                            {p.baseline} → {p.score}
                          </span>
                        </span>
                        <span className="text-sm font-semibold text-success tabular">+{p.delta}</span>
                      </Link>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">Optimize a page or improve a draft — pages that gained score show up here.</p>
              )}
            </Panel>
          </div>

          <Panel contentClassName="space-y-3 p-3 sm:p-4">
            <FilterBar
              activeCount={statuses.length + bands.length}
              search={<SearchInput value={q} onChange={(v) => setQ(v || null)} placeholder="Search content, prompts, URLs…" />}
            >
              <MultiSelect
                options={(Object.keys(CONTENT_STATUS_META) as Array<keyof typeof CONTENT_STATUS_META>).map((s) => ({
                  value: s,
                  label: CONTENT_STATUS_META[s].label,
                  count: items.filter((i) => i.status === s).length,
                }))}
                value={statuses}
                onChange={setStatuses}
                placeholder="All statuses"
                label="Statuses"
                searchable={false}
              />
              <MultiSelect
                options={[
                  { value: "primary", label: "Primary Source (87+)" },
                  { value: "strong", label: "Strong (70–86)" },
                  { value: "needs_work", label: "Needs work (50–69)" },
                  { value: "weak", label: "Weak (< 50)" },
                ]}
                value={bands}
                onChange={setBands}
                placeholder="All scores"
                label="Score bands"
                searchable={false}
              />
            </FilterBar>
            {selected.size > 0 && canEdit && (
              <div className="flex items-center gap-2 rounded-xl border bg-muted/50 px-3 py-2 text-xs">
                <span className="font-medium tabular">{selected.size} selected</span>
                <ConfirmButton title={`Delete ${selected.size} item${selected.size === 1 ? "" : "s"}?`} description="Drafts and their score history are removed. Published pages stay live in your CMS." destructive confirmLabel="Delete" onConfirm={() => remove([...selected])}>
                  <Button variant="outline" size="sm" disabled={pending}>
                    <Trash2 className="size-3.5" /> Delete
                  </Button>
                </ConfirmButton>
                <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setSelected(new Set())}>
                  <X className="size-3.5" /> Clear
                </Button>
              </div>
            )}
            {items.length ? (
              <DataTable
                columns={columns}
                data={filtered}
                getRowId={(i) => i.id}
                selectable={canEdit}
                selected={selected}
                onSelectedChange={setSelected}
                onRowClick={(i) => router.push(`/p/${projectId}/content/${i.id}`)}
                initialSort={{ id: "updated", dir: "desc" }}
                empty={<EmptyState compact title="Nothing matches these filters" />}
                mobileCard={(i) => (
                  <div className="space-y-2">
                    <div className="font-medium leading-snug">{i.title}</div>
                    <p className="line-clamp-1 text-xs text-muted-foreground">{i.targetPrompt ?? i.sourceUrl ?? ""}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <ContentStatusBadge status={i.status} stage={i.generationStage} />
                      <AeoScoreChip score={i.aeoScore} baseline={i.baselineScore} showBand={false} />
                    </div>
                  </div>
                )}
              />
            ) : (
              <EmptyState
                icon={FileText}
                title="No content yet"
                description="Generate an expert-backed draft for a prompt you want to win, or paste an existing URL to score and optimize it."
                action={
                  canEdit ? (
                    <div className="flex flex-wrap justify-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => setUrlOpen(true)}>
                        <ScanSearch className="size-3.5" /> Optimize URL
                      </Button>
                      <Button size="sm" onClick={() => setGenOpen(true)}>
                        <Sparkles className="size-3.5" /> Generate content
                      </Button>
                    </div>
                  ) : undefined
                }
              />
            )}
          </Panel>
        </>
      )}

      {canEdit && <GenerateDialog projectId={projectId} personas={personas} aiAvailable={aiAvailable} language={language} open={genOpen} onOpenChange={setGenOpen} />}
      {canEdit && <OptimizeUrlDialog projectId={projectId} domain={domain} aiAvailable={aiAvailable} open={urlOpen} onOpenChange={setUrlOpen} />}
    </PageContainer>
  );
}
