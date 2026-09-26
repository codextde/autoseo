"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  Archive,
  ArchiveRestore,
  Download,
  Eye,
  FileUp,
  GitFork,
  Loader2,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  Sparkles,
  Tags,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Panel } from "@/components/app/page";
import { DataTable, type Column } from "@/components/app/data-table";
import { Delta, Meter, formatNumber, formatPercent } from "@/components/app/metrics";
import { FilterBar, MultiSelect, SearchInput, TagFilter } from "@/components/app/filters";
import { EngineIcon } from "@/components/app/engine-icon";
import { Favicon } from "@/components/app/favicon";
import { ConfirmButton, CountryFlag, StatusBadge, TagChip } from "@/components/app/misc";
import { EmptyState } from "@/components/app/empty-state";
import { useCan } from "@/components/app/shell-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useUrlPatch, useUrlState } from "@/hooks/use-url-state";
import { getEngine } from "@/lib/engines";
import { flagEmoji, getCountry } from "@/lib/countries";
import { cn } from "@/lib/utils";
import { applyTagsAction, deletePromptsAction, runNowAction, setPromptsArchivedAction } from "../actions";
import type { EngineAvailabilityView, PromptRow, TagOption } from "../types";
import { AddPromptDialog, ImportCsvDialog } from "./prompt-dialogs";
import { ResponseDrawer } from "./response-drawer";
import { TagInput } from "./tag-input";

type Metric = "visibility" | "mentions" | "sentiment" | "citations";

const METRIC_OPTIONS: { value: Metric; label: string }[] = [
  { value: "visibility", label: "Visibility" },
  { value: "mentions", label: "Mentions" },
  { value: "sentiment", label: "Sentiment" },
  { value: "citations", label: "Citations" },
];

const PERIOD_OPTIONS = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
];

function BrandFavicons({ brands, max = 4 }: { brands: PromptRow["brands"]; max?: number }) {
  if (!brands.length) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center -space-x-1">
      {brands.slice(0, max).map((b) => (
        <Tooltip key={b.competitorId}>
          <TooltipTrigger asChild>
            <span className="rounded-[5px] bg-card ring-2 ring-card">
              <Favicon domain={b.domain} fallback={b.name} className="size-[18px]" />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {b.name} · {b.count}×
          </TooltipContent>
        </Tooltip>
      ))}
      {brands.length > max && <span className="pl-2 text-[11px] text-muted-foreground">+{brands.length - max}</span>}
    </span>
  );
}

function engineStatus(e: PromptRow["perEngine"][number]): { label: string; dot: string } {
  if (e.latestStatus === "error") return { label: "last run failed", dot: "bg-destructive" };
  if (e.latestVisible == null) return { label: "no answer yet", dot: "bg-current opacity-30" };
  return e.latestVisible ? { label: "visible", dot: "bg-success" } : { label: "not visible", dot: "bg-current opacity-40" };
}

/**
 * One-row engine stack (overlapping icons, visible engines ringed in brand green, +N overflow).
 * A single tooltip lists every engine with its latest status and period visibility.
 */
function ModelVisibility({ row, max = 8 }: { row: PromptRow; max?: number }) {
  const engines = row.perEngine;
  // Only reorder when something has to be hidden, so visible engines are never in the overflow.
  const ordered = engines.length > max ? [...engines].sort((a, b) => Number(b.latestVisible === true) - Number(a.latestVisible === true)) : engines;
  const shown = ordered.slice(0, max);
  const hidden = ordered.length - shown.length;
  const visibleCount = engines.filter((e) => e.latestVisible).length;
  if (!engines.length) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          aria-label={`Visible in ${visibleCount} of ${engines.length} models`}
          className="inline-flex items-center whitespace-nowrap rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <span className="flex items-center -space-x-1">
            {shown.map((e) => (
              <span
                key={e.engine}
                className={cn("relative rounded-[5px] ring-2", e.latestVisible ? "z-[1] ring-brand/70" : "ring-card")}
              >
                <EngineIcon id={e.engine} size="xs" withTooltip={false} active={e.latestVisible === true} />
              </span>
            ))}
          </span>
          {hidden > 0 && <span className="ml-1 text-[10px] font-medium text-muted-foreground tabular">+{hidden}</span>}
        </span>
      </TooltipTrigger>
      <TooltipContent className="flex-col items-stretch gap-0 p-2.5">
        <div className="mb-1.5 text-xs font-medium">
          Visible in {visibleCount} of {engines.length} models
        </div>
        <ul className="space-y-1 text-xs">
          {engines.map((e) => {
            const st = engineStatus(e);
            return (
              <li key={e.engine} className="flex items-center gap-2">
                <EngineIcon id={e.engine} size="xs" withTooltip={false} active={e.latestVisible === true} />
                <span className="min-w-24">{getEngine(e.engine)?.shortName ?? e.engine}</span>
                <span className="flex flex-1 items-center gap-1.5 opacity-80">
                  <span className={cn("size-1.5 shrink-0 rounded-full", st.dot)} />
                  {st.label}
                </span>
                <span className="pl-2 tabular opacity-70">{e.answers ? formatPercent(e.visibility, 0) : "—"}</span>
              </li>
            );
          })}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}

export function PromptTable({
  projectId,
  rows,
  tags,
  engines,
  enabledEngines,
  countries,
  status,
  usage,
  frequency,
  defaultCountry,
  links,
  exportHref,
}: {
  projectId: string;
  rows: PromptRow[];
  tags: TagOption[];
  engines: EngineAvailabilityView[];
  enabledEngines: string[];
  countries: string[];
  status: "active" | "archived";
  usage: { active: number; engines: number; limit: number };
  frequency: string;
  defaultCountry: string;
  links: { models: string; research: string; fanouts: string };
  exportHref: string;
}) {
  const can = useCan();
  const canManage = can("prompts.manage");
  const [patch] = useUrlPatch();
  const [q, setQ] = useUrlState("q", "");
  const [metric, setMetric] = useUrlState("tmetric", "visibility");
  const [tperiod] = useUrlState("tperiod", "7d");
  const [tloc] = useUrlState("tloc", "");
  const [teng] = useUrlState("teng", "");
  const [ttags] = useUrlState("ttags", "");
  const [drawerPrompt] = useUrlState("prompt", "");
  const [drawerEngine] = useUrlState("pe", "");
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [tagging, setTagging] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tagDraft, setTagDraft] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? rows.filter((r) => r.text.toLowerCase().includes(needle) || r.tags.some((t) => t.name.toLowerCase().includes(needle))) : rows;
  }, [rows, q]);

  const openDrawer = (id: string, engine?: string) => patch({ prompt: id, pe: engine ?? null });
  const drawerRow = rows.find((r) => r.id === drawerPrompt);

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    start(async () => {
      const res = await fn();
      if (res.ok) toast.success(success);
      else toast.error(res.error ?? "Something went wrong");
    });

  const rowActions = (r: PromptRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Prompt actions">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={() => openDrawer(r.id)}>
          <Eye /> View responses
        </DropdownMenuItem>
        {canManage && (
          <>
            <DropdownMenuItem
              onClick={() =>
                act(async () => {
                  const res = await runNowAction(projectId, [r.id]);
                  return res.ok ? { ok: true } : res;
                }, "Run queued for this prompt")
              }
            >
              <Play /> Run now
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => act(() => setPromptsArchivedAction(projectId, [r.id], r.status === "active"), r.status === "active" ? "Prompt archived" : "Prompt restored")}>
              {r.status === "active" ? <Archive /> : <ArchiveRestore />} {r.status === "active" ? "Archive" : "Unarchive"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(r.id)}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const columns: Column<PromptRow>[] = [
    {
      id: "prompt",
      header: "Prompt",
      cell: (r) => (
        <button type="button" onClick={() => openDrawer(r.id)} className="flex min-w-[220px] max-w-[440px] items-start gap-2 text-left">
          <span className="mt-0.5 text-[15px] leading-none" title={getCountry(r.country)?.name}>
            {flagEmoji(r.country)}
          </span>
          <span className="line-clamp-2 text-sm hover:underline">{r.text}</span>
        </button>
      ),
      sortValue: (r) => r.text,
    },
    {
      id: "tags",
      header: "Tags",
      hideBelow: "lg",
      cell: (r) =>
        r.tags.length ? (
          <span className="flex max-w-44 flex-wrap gap-1">
            {r.tags.slice(0, 2).map((t) => (
              <TagChip key={t.id} name={t.name} color={t.color} />
            ))}
            {r.tags.length > 2 && <span className="text-[11px] text-muted-foreground">+{r.tags.length - 2}</span>}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    { id: "models", header: "Model Visibility", hideBelow: "md", className: "whitespace-nowrap", headerClassName: "whitespace-nowrap", cell: (r) => <ModelVisibility row={r} /> },
    {
      id: "visibility",
      header: "Visibility",
      align: "right",
      hint: "Answers that mention or cite your brand ÷ all answers in the period",
      cell: (r) => (
        <span className="inline-flex flex-col items-end">
          <span className="font-medium">{formatPercent(r.visibility, 0)}</span>
          <Delta value={r.visibilityDelta} suffix="%" showZero={false} digits={0} />
        </span>
      ),
      sortValue: (r) => r.visibility,
    },
    {
      id: "mentions",
      header: "Mentions",
      align: "right",
      cell: (r) => (
        <span className="inline-flex flex-col items-end">
          <span>{formatNumber(r.mentions)}</span>
          <Delta value={r.mentionsDelta} showZero={false} digits={0} />
        </span>
      ),
      sortValue: (r) => r.mentions,
    },
    {
      id: "sentiment",
      header: "Sentiment",
      align: "right",
      hideBelow: "sm",
      cell: (r) => (
        <span className="inline-flex flex-col items-end">
          <span>{r.sentiment != null ? Math.round(r.sentiment) : "—"}</span>
          <Delta value={r.sentimentDelta} showZero={false} digits={0} />
        </span>
      ),
      sortValue: (r) => r.sentiment,
    },
    {
      id: "citations",
      header: "Citations",
      align: "right",
      hideBelow: "sm",
      hint: "Citations of your own domain in the period",
      cell: (r) => (
        <span className="inline-flex flex-col items-end">
          <span>{formatNumber(r.citations)}</span>
          <Delta value={r.citationsDelta} showZero={false} digits={0} />
        </span>
      ),
      sortValue: (r) => r.citations,
    },
    { id: "brands", header: "Brands", hideBelow: "lg", cell: (r) => <BrandFavicons brands={r.brands} /> },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (r) => (
        <span className="inline-flex items-center gap-0.5">
          <Button variant="ghost" size="icon-sm" aria-label="View responses" onClick={() => openDrawer(r.id)}>
            <Eye />
          </Button>
          {rowActions(r)}
        </span>
      ),
    },
  ];

  const expanded = (r: PromptRow) => (
    <div className="space-y-3 px-3 py-3 sm:px-4">
      <div className="rounded-lg bg-background px-3 py-2 text-sm">
        <div className="mb-0.5 text-[11px] font-medium text-muted-foreground uppercase">Full Prompt</div>
        {r.text}
      </div>
      <div className="overflow-x-auto rounded-lg border bg-background">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="bg-muted/60 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-normal">Model</th>
              <th className="px-3 py-2 font-normal">Status</th>
              <th className="px-3 py-2 text-right font-normal">Runs</th>
              <th className="px-3 py-2 text-right font-normal">Visibility</th>
              <th className="px-3 py-2 text-right font-normal">Mentions</th>
              <th className="px-3 py-2 text-right font-normal">Cited</th>
              <th className="px-3 py-2 text-right font-normal">Sentiment</th>
              <th className="px-3 py-2 font-normal">Brands</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {r.perEngine.map((e) => (
              <tr key={e.engine} className="border-t">
                <td className="px-3 py-2">
                  <span className="flex items-center gap-1.5 whitespace-nowrap">
                    <EngineIcon id={e.engine} size="xs" withTooltip={false} />
                    {getEngine(e.engine)?.shortName ?? e.engine}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {e.latestStatus === "error" ? (
                    <StatusBadge status="error" label="Failed" />
                  ) : e.latestVisible == null ? (
                    <StatusBadge status="queued" label="No answer yet" dot={false} />
                  ) : e.latestVisible ? (
                    <StatusBadge status="success" label="Visible" />
                  ) : (
                    <StatusBadge status="offline" label="Not visible" />
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular">{e.answers}</td>
                <td className="px-3 py-2 text-right tabular">{formatPercent(e.visibility, 0)}</td>
                <td className="px-3 py-2 text-right tabular">{e.mentioned}</td>
                <td className="px-3 py-2 text-right tabular">{e.cited}</td>
                <td className="px-3 py-2 text-right tabular">{e.sentiment != null ? Math.round(e.sentiment) : "—"}</td>
                <td className="px-3 py-2">
                  <BrandFavicons brands={e.brands} max={3} />
                </td>
                <td className="px-3 py-2 text-right">
                  <Button size="xs" variant="outline" disabled={!e.latestAnswerId} onClick={() => openDrawer(r.id, e.engine)}>
                    Show
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => openDrawer(r.id)}>
          <Eye /> View Response
        </Button>
        {canManage && (
          <>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => setPromptsArchivedAction(projectId, [r.id], r.status === "active"), r.status === "active" ? "Prompt archived" : "Prompt restored")}>
              {r.status === "active" ? <Archive /> : <ArchiveRestore />} {r.status === "active" ? "Archive" : "Unarchive"}
            </Button>
            <ConfirmButton
              title="Delete this prompt?"
              description="All tracked answers of this prompt are deleted as well. This cannot be undone."
              confirmLabel="Delete"
              destructive
              onConfirm={async () => {
                const res = await deletePromptsAction(projectId, [r.id]);
                if (res.ok) toast.success("Prompt deleted");
                else toast.error(res.error);
              }}
            >
              <Button size="sm" variant="destructive">
                <Trash2 /> Delete
              </Button>
            </ConfirmButton>
          </>
        )}
      </div>
    </div>
  );

  const usagePlanned = usage.active * usage.engines;
  const usageLimit = usage.limit * Math.max(1, usage.engines);
  const activeFilters = [tloc, teng, ttags].filter(Boolean).length + (tperiod !== "7d" ? 1 : 0);

  return (
    <Panel
      title={
        <span className="flex items-center gap-3">
          Prompts
          <span className="flex rounded-lg bg-muted p-0.5 text-xs font-medium">
            {(["active", "archived"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setSelected(new Set());
                  patch({ status: s === "active" ? null : s });
                }}
                className={cn("rounded-md px-2.5 py-1 capitalize transition-colors", status === s ? "bg-background shadow-xs" : "text-muted-foreground hover:text-foreground")}
              >
                {s}
              </button>
            ))}
          </span>
        </span>
      }
      description={
        <span className="mt-1 flex items-center gap-2">
          <span className="tabular">
            Usage {formatNumber(usagePlanned)} / {formatNumber(usageLimit)} answers per run
          </span>
          <Meter value={usagePlanned} max={usageLimit} className="w-24" tone={usagePlanned >= usageLimit ? "warning" : "brand"} />
        </span>
      }
      actions={
        <>
          <Button asChild size="sm" variant="outline">
            <Link href={links.fanouts}>
              <GitFork /> Query Fanouts
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="hidden sm:inline-flex">
            <Link href={links.research}>
              <Sparkles /> Prompt Research
            </Link>
          </Button>
          {canManage && (
            <>
              <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
                <FileUp /> Import CSV
              </Button>
              <Button size="sm" onClick={() => setAddOpen(true)} className="bg-brand text-brand-foreground hover:bg-brand/90">
                <Plus /> Add Prompt
              </Button>
            </>
          )}
        </>
      }
      contentClassName="space-y-3"
    >
      {tagging && (
        <div className="flex flex-col gap-2 rounded-xl border border-brand/30 bg-brand-soft/30 p-2.5 sm:flex-row sm:items-center">
          <span className="shrink-0 text-xs font-medium tabular">{selected.size} selected</span>
          <TagInput value={tagDraft} onChange={setTagDraft} options={tags} placeholder="Choose tags to apply…" className="min-w-0 flex-1" />
          <div className="flex shrink-0 gap-1.5">
            <Button
              size="sm"
              disabled={!selected.size || !tagDraft.length || pending}
              onClick={() =>
                act(async () => {
                  const res = await applyTagsAction(projectId, [...selected], tagDraft, "add");
                  if (res.ok) setTagDraft([]);
                  return res;
                }, "Tags applied")
              }
            >
              <Tags /> Apply Tags
            </Button>
            <Button size="sm" variant="outline" disabled={!selected.size || pending} onClick={() => act(() => applyTagsAction(projectId, [...selected], [], "clear"), "Tags cleared")}>
              Clear Tags
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setTagging(false);
                setSelected(new Set());
              }}
            >
              <X /> Exit Tagging
            </Button>
          </div>
        </div>
      )}

      <FilterBar
        activeCount={activeFilters}
        search={<SearchInput value={q} onChange={(v) => setQ(v || null)} placeholder="Search prompts…" />}
        right={
          <>
            {canManage && !tagging && (
              <Button size="sm" variant="outline" onClick={() => setTagging(true)}>
                <Tags /> <span className="hidden sm:inline">Select Prompts</span>
              </Button>
            )}
            <Button asChild size="icon-sm" variant="outline" aria-label="Export CSV">
              <a href={exportHref}>
                <Download />
              </a>
            </Button>
          </>
        }
      >
        <MultiSelect
          single
          options={countries.map((c) => ({ value: c, label: getCountry(c)?.name ?? c, icon: <span>{flagEmoji(c)}</span> }))}
          value={tloc ? [tloc] : []}
          onChange={(v) => patch({ tloc: v[0] ?? null })}
          placeholder="All Locations"
        />
        <MultiSelect
          options={enabledEngines.map((e) => ({ value: e, label: getEngine(e)?.name ?? e, icon: <EngineIcon id={e} size="xs" withTooltip={false} /> }))}
          value={teng ? teng.split(",") : []}
          onChange={(v) => patch({ teng: v.join(",") || null })}
          placeholder="All Models"
          label="Models"
        />
        <MultiSelect single searchable={false} options={PERIOD_OPTIONS} value={[tperiod]} onChange={(v) => patch({ tperiod: v[0] && v[0] !== "7d" ? v[0] : null })} placeholder="Last 7 days" />
        <MultiSelect
          single
          searchable={false}
          options={METRIC_OPTIONS}
          value={[metric]}
          onChange={(v) => {
            const m = (v[0] as Metric) ?? "visibility";
            setMetric(m === "visibility" ? null : m);
          }}
          placeholder="Visibility"
        />
        <TagFilter options={tags.map((t) => ({ value: t.id, label: t.name, count: t.count }))} value={ttags ? ttags.split(",") : []} onChange={(v) => patch({ ttags: v.join(",") || null })} />
      </FilterBar>

      <DataTable
        columns={columns}
        data={filtered}
        getRowId={(r) => r.id}
        key={metric}
        initialSort={{ id: metric, dir: "desc" }}
        selectable={tagging}
        selected={selected}
        onSelectedChange={setSelected}
        renderExpanded={expanded}
        pageSize={50}
        mobileCard={(r) => (
          <div className="space-y-2">
            <button type="button" className="flex w-full items-start gap-2 text-left" onClick={() => openDrawer(r.id)}>
              <CountryFlag iso={r.country} />
              <span className="line-clamp-3 text-sm font-medium">{r.text}</span>
            </button>
            <div className="flex items-center justify-between gap-2">
              <ModelVisibility row={r} />
              <div className="flex items-center gap-1">
                {tagging && (
                  <Button
                    size="xs"
                    variant={selected.has(r.id) ? "default" : "outline"}
                    onClick={() => {
                      const next = new Set(selected);
                      if (next.has(r.id)) next.delete(r.id);
                      else next.add(r.id);
                      setSelected(next);
                    }}
                  >
                    {selected.has(r.id) ? "Selected" : "Select"}
                  </Button>
                )}
                {rowActions(r)}
              </div>
            </div>
            <div className="grid grid-cols-4 gap-1 text-center text-[11px]">
              {[
                ["Visibility", formatPercent(r.visibility, 0)],
                ["Mentions", formatNumber(r.mentions)],
                ["Sentiment", r.sentiment != null ? String(Math.round(r.sentiment)) : "—"],
                ["Citations", formatNumber(r.citations)],
              ].map(([l, v]) => (
                <div key={l} className="rounded-lg bg-muted/50 py-1">
                  <div className="font-semibold tabular">{v}</div>
                  <div className="text-muted-foreground">{l}</div>
                </div>
              ))}
            </div>
            {r.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {r.tags.map((t) => (
                  <TagChip key={t.id} name={t.name} color={t.color} />
                ))}
              </div>
            )}
          </div>
        )}
        empty={
          <EmptyState
            icon={Search}
            title={rows.length ? "No prompts match your filters" : status === "archived" ? "No archived prompts" : "No prompts tracked yet"}
            description={
              rows.length
                ? "Try another search or clear the filters."
                : status === "archived"
                  ? "Archived prompts stop being tracked but keep their history."
                  : "Add the questions your customers ask AI assistants — we track how often each AI model mentions and cites your brand."
            }
            action={
              !rows.length && status === "active" && canManage ? (
                <Button size="sm" onClick={() => setAddOpen(true)}>
                  <Plus /> Add Prompt
                </Button>
              ) : undefined
            }
            compact
          />
        }
      />
      {pending && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Saving…
        </div>
      )}

      {tagging && selected.size > 0 && canManage && (
        <div className="flex flex-wrap gap-2 border-t pt-3">
          <Badge variant="secondary">{selected.size} selected</Badge>
          <Button size="sm" variant="outline" onClick={() => act(() => setPromptsArchivedAction(projectId, [...selected], status === "active"), status === "active" ? "Prompts archived" : "Prompts restored")}>
            {status === "active" ? <Archive /> : <ArchiveRestore />} {status === "active" ? "Archive" : "Unarchive"}
          </Button>
          <ConfirmButton
            title={`Delete ${selected.size} prompts?`}
            description="All tracked answers of these prompts are deleted as well."
            confirmLabel="Delete"
            destructive
            onConfirm={async () => {
              const res = await deletePromptsAction(projectId, [...selected]);
              if (res.ok) {
                toast.success(`${res.data.deleted} prompts deleted`);
                setSelected(new Set());
              } else toast.error(res.error);
            }}
          >
            <Button size="sm" variant="destructive">
              <Trash2 /> Delete
            </Button>
          </ConfirmButton>
        </div>
      )}

      {canManage && (
        <>
          <AddPromptDialog
            open={addOpen}
            onOpenChange={setAddOpen}
            projectId={projectId}
            defaultCountry={defaultCountry}
            tags={tags}
            engines={engines}
            enabledEngines={enabledEngines}
            frequency={frequency}
            modelsHref={links.models}
          />
          <ImportCsvDialog open={importOpen} onOpenChange={setImportOpen} projectId={projectId} defaultCountry={defaultCountry} />
        </>
      )}
      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this prompt?</AlertDialogTitle>
            <AlertDialogDescription>All tracked answers of this prompt are deleted as well. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                const target = confirmDelete;
                setConfirmDelete(null);
                if (target) act(() => deletePromptsAction(projectId, [target]), "Prompt deleted");
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ResponseDrawer
        projectId={projectId}
        prompt={drawerPrompt ? { id: drawerPrompt, text: drawerRow?.text ?? "", country: drawerRow?.country ?? defaultCountry } : null}
        initialEngine={drawerEngine || null}
        onClose={() => patch({ prompt: null, pe: null })}
      />
    </Panel>
  );
}
