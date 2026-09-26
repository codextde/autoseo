"use client";

import { Fragment, useMemo, useState } from "react";
import { format } from "date-fns";
import { Check, ChevronRight, Loader2, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SegmentBar, formatNumber } from "@/components/app/metrics";
import { Sparkline } from "@/components/app/charts";
import { cn } from "@/lib/utils";
import { BrandedBadge, FunnelIcon, topicColor } from "../shared/bits";
import { NO_TOPIC, topicKey } from "./filter-logic";
import { FUNNEL_LABELS, type ResearchItem } from "../../types";

type Props = {
  items: ResearchItem[];
  view: "tree" | "flat";
  collapsed: Set<string>;
  onToggleGroup: (topic: string) => void;
  selected: Set<string>;
  onSelectedChange: (s: Set<string>) => void;
  canManage: boolean;
  pending: Set<string>;
  onAdd: (ids: string[]) => void;
  brandName: string;
};

function volumeTooltip(i: ResearchItem) {
  if (i.volumeSource === "dataforseo")
    return (
      <span>
        ≈ <b className="tabular">{formatNumber(i.volume ?? 0)}</b> Google searches / month
        {i.keyword ? <> for “{i.keyword}”</> : null}
        <span className="block text-[11px] opacity-70">Source: DataForSEO</span>
      </span>
    );
  if (i.volumeSource === "import") return <span>{formatNumber(i.volume)} / month (imported)</span>;
  if (i.volumeSource === "estimated") {
    const rel = (i.details as Record<string, unknown>).relativeVolume;
    return (
      <span>
        Estimated relative demand {typeof rel === "number" ? `${Math.round(rel)}/10` : ""}
        <span className="block text-[11px] opacity-70">AI estimate — connect DataForSEO for search volumes</span>
      </span>
    );
  }
  return <span>No volume data yet</span>;
}

function VolumeCell({ item }: { item: ResearchItem }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1.5">
          <SegmentBar value={item.volumeScore ?? 0} className={cn(item.volumeScore == null && "opacity-40")} />
          {item.volumeSource === "estimated" && <span className="text-[10px] text-muted-foreground">est.</span>}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{volumeTooltip(item)}</TooltipContent>
    </Tooltip>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right font-medium">{children}</span>
    </div>
  );
}

export function ItemDataPopover({ item }: { item: ResearchItem }) {
  const d = item.details;
  const trend = d.trend ?? [];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Show prompt data" className="text-muted-foreground">
          <Search className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2 p-3">
        <p className="text-sm leading-snug font-medium">{item.text}</p>
        <div className="divide-y">
          <Row label="Topic">{item.topic ?? "—"}</Row>
          <Row label="Funnel stage">{item.funnelStage ? FUNNEL_LABELS[item.funnelStage] : "—"}</Row>
          <Row label="Intent">{item.intent ?? "—"}</Row>
          <Row label="Persona">{item.persona ?? "—"}</Row>
          <Row label="Competitor">{item.competitorMentioned ?? "—"}</Row>
          <Row label="Branded">{item.branded ? "Yes" : "No"}</Row>
          <Row label="Topic keyword">{item.keyword ?? "—"}</Row>
          <Row label="Volume">
            {item.volumeSource === "dataforseo"
              ? `${formatNumber(item.volume ?? 0)} / mo`
              : item.volumeSource === "import"
                ? `${formatNumber(item.volume)} / mo`
                : item.volumeSource === "estimated"
                  ? "Estimated (relative)"
                  : "—"}
          </Row>
          <Row label="Volume source">
            {item.volumeSource === "dataforseo" ? "DataForSEO search volume" : item.volumeSource === "import" ? "Imported file" : item.volumeSource === "estimated" ? "AI estimate" : "—"}
          </Row>
          {d.keywordMetrics?.cpc != null && <Row label="CPC">{d.keywordMetrics.cpc.toFixed(2)}</Row>}
          {d.keywordMetrics?.difficulty != null && <Row label="Keyword difficulty">{d.keywordMetrics.difficulty}</Row>}
          <Row label="Source">{item.source === "generated" ? "Prompt Set Helper" : item.source === "import" ? "Import" : "Manual"}</Row>
        </div>
        {trend.length > 2 && (
          <div>
            <p className="mb-1 text-[11px] text-muted-foreground">Search trend (12 months)</p>
            <Sparkline values={trend.map((t) => t.volume)} height={36} color="var(--chart-3)" />
          </div>
        )}
        {d.rationale && <p className="rounded-md bg-muted/60 p-2 text-xs text-muted-foreground">{d.rationale}</p>}
      </PopoverContent>
    </Popover>
  );
}

function SelectCell({ item, canManage, pending, onAdd }: { item: ResearchItem; canManage: boolean; pending: boolean; onAdd: (ids: string[]) => void }) {
  if (item.trackedPromptId)
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex size-7 items-center justify-center rounded-lg bg-brand-soft text-brand">
            <Check className="size-4" />
          </span>
        </TooltipTrigger>
        <TooltipContent>In tracker{item.addedAt ? ` since ${format(new Date(item.addedAt), "MMM d, yyyy")}` : ""}</TooltipContent>
      </Tooltip>
    );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={!canManage || pending}
            onClick={() => onAdd([item.id])}
            aria-label="Add to tracker"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-4" />}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{canManage ? "Add to tracker" : "You need permission to manage prompts"}</TooltipContent>
    </Tooltip>
  );
}

function PromptCell({ item, brandName }: { item: ResearchItem; brandName: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <FunnelIcon stage={item.funnelStage} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">
          {item.branded && <BrandedBadge className="mr-1.5 align-[1px]" />}
          {item.text}
        </p>
        {(item.persona || item.competitorMentioned) && (
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {item.persona && <span>{item.persona}</span>}
            {item.persona && item.competitorMentioned && " · "}
            {item.competitorMentioned && <span>vs {item.competitorMentioned}</span>}
          </p>
        )}
      </div>
      <span className="sr-only">{brandName}</span>
    </div>
  );
}

const PAGE = 100;

export function ResearchTable({ items, view, collapsed, onToggleGroup, selected, onSelectedChange, canManage, pending, onAdd, brandName }: Props) {
  const [limit, setLimit] = useState(PAGE);
  const groups = useMemo(() => {
    const map = new Map<string, ResearchItem[]>();
    for (const i of items) {
      const k = topicKey(i);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(i);
    }
    return [...map.entries()]
      .map(([topic, rows]) => ({ topic, rows: rows.sort((a, b) => (b.volumeScore ?? -1) - (a.volumeScore ?? -1)) }))
      .sort((a, b) => b.rows.length - a.rows.length || a.topic.localeCompare(b.topic));
  }, [items]);
  const flat = useMemo(() => [...items].sort((a, b) => (b.volumeScore ?? -1) - (a.volumeScore ?? -1)), [items]);
  const selectable = items.filter((i) => !i.trackedPromptId);
  const allSelected = selectable.length > 0 && selectable.every((i) => selected.has(i.id));

  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    onSelectedChange(next);
  };

  const renderRow = (i: ResearchItem) => (
    <tr key={i.id} className={cn("group border-b transition-colors last:border-0 hover:bg-muted/40", selected.has(i.id) && "bg-brand-soft/40")}>
      <td className="w-9 px-3 py-2.5 align-top">
        {canManage && !i.trackedPromptId && <Checkbox checked={selected.has(i.id)} onCheckedChange={(v) => toggle(i.id, !!v)} aria-label="Select prompt" className="mt-1" />}
      </td>
      <td className="w-10 px-1 py-2 align-top">
        <ItemDataPopover item={i} />
      </td>
      <td className="px-2 py-2.5 align-top">
        <PromptCell item={i} brandName={brandName} />
      </td>
      <td className="w-32 px-3 py-2.5 align-top">
        <VolumeCell item={i} />
      </td>
      <td className="hidden w-28 px-3 py-2.5 align-top text-xs whitespace-nowrap text-muted-foreground md:table-cell">
        {i.addedAt ? format(new Date(i.addedAt), "MMM d, yyyy") : "—"}
      </td>
      <td className="w-14 px-3 py-2 text-right align-top">
        <SelectCell item={i} canManage={canManage} pending={pending.has(i.id)} onAdd={onAdd} />
      </td>
    </tr>
  );

  const mobileCard = (i: ResearchItem) => (
    <div key={i.id} className={cn("rounded-xl border bg-card p-3", selected.has(i.id) && "ring-1 ring-brand/40")}>
      <div className="flex items-start gap-2">
        {canManage && !i.trackedPromptId && <Checkbox checked={selected.has(i.id)} onCheckedChange={(v) => toggle(i.id, !!v)} aria-label="Select prompt" className="mt-0.5" />}
        <div className="min-w-0 flex-1">
          <PromptCell item={i} brandName={brandName} />
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ItemDataPopover item={i} />
          <VolumeCell item={i} />
        </div>
        <SelectCell item={i} canManage={canManage} pending={pending.has(i.id)} onAdd={onAdd} />
      </div>
    </div>
  );

  const header = (
    <thead className="sticky top-0 z-[2]">
      <tr className="border-b bg-muted/60 text-left text-xs text-muted-foreground">
        <th className="w-9 px-3 py-2.5">
          {canManage && selectable.length > 0 && (
            <Checkbox
              checked={allSelected}
              onCheckedChange={(v) => onSelectedChange(v ? new Set(selectable.map((i) => i.id)) : new Set())}
              aria-label="Select all"
            />
          )}
        </th>
        <th className="w-10 px-1 py-2.5 font-medium">Data</th>
        <th className="px-2 py-2.5 font-medium">Prompt</th>
        <th className="w-32 px-3 py-2.5 font-medium">Volume</th>
        <th className="hidden w-28 px-3 py-2.5 font-medium md:table-cell">Added</th>
        <th className="w-14 px-3 py-2.5 text-right font-medium">Select</th>
      </tr>
    </thead>
  );

  const groupHeader = (g: { topic: string; rows: ResearchItem[] }) => {
    const open = !collapsed.has(g.topic);
    const untracked = g.rows.filter((r) => !r.trackedPromptId);
    const tracked = g.rows.length - untracked.length;
    return (
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => onToggleGroup(g.topic)} className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium">
          <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
          <span className="h-4 w-1 shrink-0 rounded-full" style={{ background: topicColor(g.topic === NO_TOPIC ? null : g.topic) }} />
          <span className="truncate">{g.topic === NO_TOPIC ? "No topic" : g.topic}</span>
          <span className="rounded-full bg-background px-1.5 text-xs font-normal text-muted-foreground tabular ring-1 ring-border">{g.rows.length}</span>
          {tracked > 0 && <span className="hidden text-xs font-normal text-muted-foreground sm:inline">{tracked} tracked</span>}
        </button>
        {canManage && untracked.length > 0 && (
          <Button variant="ghost" size="xs" className="shrink-0 text-muted-foreground" onClick={() => onAdd(untracked.map((r) => r.id))}>
            <Plus className="size-3" /> Add all
          </Button>
        )}
      </div>
    );
  };

  if (view === "flat") {
    const shown = flat.slice(0, limit);
    return (
      <div className="space-y-3">
        <div className="space-y-2 sm:hidden">{shown.map(mobileCard)}</div>
        <div className="hidden overflow-x-auto rounded-xl border bg-card sm:block">
          <table className="w-full border-collapse">
            {header}
            <tbody>{shown.map(renderRow)}</tbody>
          </table>
        </div>
        {flat.length > limit && (
          <div className="flex justify-center">
            <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + PAGE)}>
              Show more ({flat.length - limit} remaining)
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="space-y-3 sm:hidden">
        {groups.map((g) => (
          <div key={g.topic} className="space-y-2">
            <div className="rounded-lg bg-muted/60 px-2 py-1.5">{groupHeader(g)}</div>
            {!collapsed.has(g.topic) && g.rows.map(mobileCard)}
          </div>
        ))}
      </div>
      <div className="hidden overflow-x-auto rounded-xl border bg-card sm:block">
        <table className="w-full border-collapse">
          {header}
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.topic}>
                <tr className="border-b bg-muted/40">
                  <td colSpan={6} className="px-3 py-2">
                    {groupHeader(g)}
                  </td>
                </tr>
                {!collapsed.has(g.topic) && g.rows.map(renderRow)}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
