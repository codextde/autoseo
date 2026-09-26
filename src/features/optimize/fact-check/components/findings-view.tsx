"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { Check, CheckCheck, Download, EyeOff, MoreHorizontal, RotateCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { TrendChart } from "@/components/app/charts";
import { DataTable, type Column } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { EngineIcon } from "@/components/app/engine-icon";
import { FilterBar, MultiSelect, PeriodSelect } from "@/components/app/filters";
import { KpiStrip } from "@/components/app/metrics";
import { CountryFlag } from "@/components/app/misc";
import { Panel } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUrlListState, useUrlState } from "@/hooks/use-url-state";
import { getCountry } from "@/lib/countries";
import { getEngine } from "@/lib/engines";
import { cn } from "@/lib/utils";
import { FC_VERDICT_META } from "@/features/optimize/constants";
import { setFindingsStatusAction, setVerdictAction } from "../actions";
import type { FindingRow, FindingsData } from "../types";
import { SeverityBadge, VerdictBadge } from "./badges";

const TYPE_OPTIONS = (["off_label", "contradicted", "unsupported", "outdated", "needs_review"] as const).map((k) => ({
  value: k,
  label: FC_VERDICT_META[k].label,
}));
const SEVERITY_OPTIONS = [
  { value: "critical", label: "Critical" },
  { value: "major", label: "Major" },
  { value: "minor", label: "Minor" },
];
const SEVERITY_RANK: Record<string, number> = { critical: 3, major: 2, minor: 1 };
const STATUS_OPTIONS = [
  { value: "open", label: "Open (excl. resolved)" },
  { value: "resolved", label: "Resolved" },
  { value: "ignored", label: "Ignored" },
  { value: "all", label: "All statuses" },
];

export function FindingsView({ projectId, data, canEdit }: { projectId: string; data: FindingsData; canEdit: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useUrlState("tab", "all");
  const [markets, setMarkets] = useUrlListState("market");
  const [models, setModels] = useUrlListState("model");
  const [types, setTypes] = useUrlListState("type");
  const [severities, setSeverities] = useUrlListState("severity");
  const [assets, setAssets] = useUrlListState("asset");
  const [status, setStatus] = useUrlState("status", "open");
  const [period, setPeriod] = useUrlState("period", "90d");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();

  const exportHref = `/p/${projectId}/fact-check/findings/export${params.toString() ? `?${params.toString()}` : ""}`;
  const activeCount = [markets, models, types, severities, assets].filter((l) => l.length).length + (status !== "open" ? 1 : 0);

  const updateStatus = (ids: string[], next: "open" | "resolved" | "ignored") =>
    start(async () => {
      const res = await setFindingsStatusAction(projectId, ids, next);
      if (!res.ok) return void toast.error(res.error);
      toast.success(`${res.data.updated} finding${res.data.updated === 1 ? "" : "s"} ${next === "open" ? "reopened" : next}`);
      setSelected(new Set());
      router.refresh();
    });

  const markMatched = (id: string) =>
    start(async () => {
      const res = await setVerdictAction(projectId, id, "matched");
      if (!res.ok) return void toast.error(res.error);
      toast.success("Marked as matching the label");
      router.refresh();
    });

  const columns: Column<FindingRow>[] = useMemo(
    () => [
      {
        id: "severity",
        header: "Severity",
        sortValue: (r) => (r.severity ? SEVERITY_RANK[r.severity] : 0),
        cell: (r) => <SeverityBadge severity={r.severity} />,
      },
      {
        id: "asset",
        header: "Asset",
        sortValue: (r) => r.assetName,
        cell: (r) => <span className="font-medium whitespace-nowrap">{r.assetName}</span>,
      },
      { id: "type", header: "Type", sortValue: (r) => r.verdict, cell: (r) => <VerdictBadge verdict={r.verdict} /> },
      {
        id: "market",
        header: "Market",
        hideBelow: "lg",
        sortValue: (r) => r.market,
        cell: (r) => (
          <span className="inline-flex items-center gap-1 text-xs" title={getCountry(r.market)?.name}>
            <CountryFlag iso={r.market} /> {r.market}
          </span>
        ),
      },
      {
        id: "model",
        header: "Model",
        hideBelow: "md",
        sortValue: (r) => r.engine,
        cell: (r) => (
          <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
            <EngineIcon id={r.engine} size="xs" /> <span className="hidden xl:inline">{getEngine(r.engine)?.shortName ?? r.engine}</span>
          </span>
        ),
      },
      {
        id: "section",
        header: "Label Section",
        hideBelow: "xl",
        sortValue: (r) => r.labelSection ?? "",
        cell: (r) => <span className="line-clamp-2 max-w-40 text-xs text-muted-foreground">{r.labelSection ?? "—"}</span>,
      },
      {
        id: "claim",
        header: "Claim",
        cell: (r) => <p className="line-clamp-2 max-w-[28rem] min-w-56 text-sm">{r.claim}</p>,
      },
      {
        id: "seen",
        header: "Last Seen",
        sortValue: (r) => r.lastSeenAt,
        cell: (r) => (
          <span className="text-xs whitespace-nowrap tabular">
            <span className="font-medium">{r.seenCount}×</span>
            <span className="text-muted-foreground"> · {format(new Date(r.lastSeenAt), "MMM d")}</span>
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        align: "right",
        cell: (r) => (
          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            {r.status !== "open" && (
              <span className="mr-1 text-[11px] text-muted-foreground capitalize">{r.status}</span>
            )}
            {canEdit && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="Finding actions" disabled={pending}>
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuLabel className="text-xs">Finding</DropdownMenuLabel>
                  {r.status !== "resolved" && (
                    <DropdownMenuItem onClick={() => updateStatus([r.id], "resolved")}>
                      <Check className="size-3.5" /> Resolve
                    </DropdownMenuItem>
                  )}
                  {r.status !== "ignored" && (
                    <DropdownMenuItem onClick={() => updateStatus([r.id], "ignored")}>
                      <EyeOff className="size-3.5" /> Ignore
                    </DropdownMenuItem>
                  )}
                  {r.status !== "open" && (
                    <DropdownMenuItem onClick={() => updateStatus([r.id], "open")}>
                      <RotateCcw className="size-3.5" /> Reopen
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => markMatched(r.id)}>
                    <ShieldCheck className="size-3.5" /> Mark as on-label
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canEdit, pending],
  );

  const engineOptions = data.options.engines.map((e) => ({
    value: e,
    label: getEngine(e)?.name ?? e,
    icon: <EngineIcon id={e} size="xs" withTooltip={false} />,
  }));
  const marketOptions = data.options.markets.map((m) => ({ value: m, label: getCountry(m)?.name ?? m, icon: <CountryFlag iso={m} /> }));
  const assetOptions = data.options.assets.map((a) => ({ value: a.id, label: a.name }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-lg bg-muted p-0.5">
          {[
            { key: "all", label: "All findings" },
            { key: "off_label", label: `Off-Label (${data.offLabelCount})` },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                tab === t.key ? "bg-background shadow-xs" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <Button asChild variant="outline" size="sm">
          <a href={exportHref}>
            <Download className="size-3.5" /> Export CSV
          </a>
        </Button>
      </div>

      <FilterBar activeCount={activeCount} right={<PeriodSelect value={period} onChange={setPeriod} />}>
        <MultiSelect options={marketOptions} value={markets} onChange={setMarkets} placeholder="All Markets" label="Markets" />
        <MultiSelect options={engineOptions} value={models} onChange={setModels} placeholder="All Models" label="Models" />
        {tab !== "off_label" && <MultiSelect options={TYPE_OPTIONS} value={types} onChange={setTypes} placeholder="All Types" label="Types" />}
        <MultiSelect options={SEVERITY_OPTIONS} value={severities} onChange={setSeverities} placeholder="All Severities" label="Severities" />
        {assetOptions.length > 1 && <MultiSelect options={assetOptions} value={assets} onChange={setAssets} placeholder="All Assets" label="Assets" />}
        <MultiSelect
          options={STATUS_OPTIONS}
          value={[status]}
          onChange={(v) => setStatus(v[0] ?? "open")}
          single
          searchable={false}
          placeholder="Open"
        />
      </FilterBar>

      <KpiStrip
        items={[
          { key: "open", label: "Open", value: data.kpis.open, sub: `${data.kpis.needsReview} need review` },
          { key: "critical", label: "Critical", value: <span className={data.kpis.critical ? "text-destructive" : undefined}>{data.kpis.critical}</span> },
          { key: "major", label: "Major", value: data.kpis.major },
          { key: "minor", label: "Minor", value: data.kpis.minor },
        ]}
      />

      <Panel title="Backlog" description="Open findings over time — new deviations minus resolved ones">
        <TrendChart
          data={data.backlog}
          series={[
            { key: "open", label: "Open findings", color: "var(--foreground)" },
            { key: "critical", label: "Critical", color: "var(--destructive)" },
          ]}
          height={220}
          type="area"
        />
      </Panel>

      {canEdit && selected.size > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2 shadow-soft">
          <span className="text-sm font-medium tabular">{selected.size} selected</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={pending} onClick={() => updateStatus([...selected], "resolved")}>
              <CheckCheck className="size-3.5" /> Resolve
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => updateStatus([...selected], "ignored")}>
              <EyeOff className="size-3.5" /> Ignore
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => updateStatus([...selected], "open")}>
              <RotateCcw className="size-3.5" /> Reopen
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      )}

      <DataTable
        columns={columns}
        data={data.rows}
        getRowId={(r) => r.id}
        initialSort={{ id: "severity", dir: "desc" }}
        selectable={canEdit}
        selected={selected}
        onSelectedChange={setSelected}
        renderExpanded={(r) => <FindingDetail row={r} projectId={projectId} />}
        empty={
          <EmptyState
            compact
            icon={ShieldCheck}
            title={data.total ? "No findings match these filters" : "No findings yet"}
            description={
              data.total
                ? "Try another period, status or type."
                : "Deviations between AI answers and your reference documents show up here after a check has run."
            }
          />
        }
        mobileCard={(r) => (
          <details className="group">
            <summary className="list-none space-y-1.5">
              <div className="flex items-center gap-2">
                <SeverityBadge severity={r.severity} />
                <VerdictBadge verdict={r.verdict} />
                <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <EngineIcon id={r.engine} size="xs" withTooltip={false} />
                  <CountryFlag iso={r.market} />
                </span>
              </div>
              <p className="text-sm">{r.claim}</p>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{r.assetName}</span>
                <span className="tabular">
                  {r.seenCount}× · {format(new Date(r.lastSeenAt), "MMM d")}
                </span>
              </div>
            </summary>
            <div className="mt-3 border-t pt-3">
              <FindingDetail row={r} projectId={projectId} compact />
              {canEdit && (
                <div className="mt-3 flex gap-2">
                  {r.status !== "resolved" && (
                    <Button size="sm" variant="outline" onClick={() => updateStatus([r.id], "resolved")}>
                      Resolve
                    </Button>
                  )}
                  {r.status !== "ignored" && (
                    <Button size="sm" variant="outline" onClick={() => updateStatus([r.id], "ignored")}>
                      Ignore
                    </Button>
                  )}
                  {r.status !== "open" && (
                    <Button size="sm" variant="outline" onClick={() => updateStatus([r.id], "open")}>
                      Reopen
                    </Button>
                  )}
                </div>
              )}
            </div>
          </details>
        )}
      />
    </div>
  );
}

function FindingDetail({ row, projectId, compact }: { row: FindingRow; projectId: string; compact?: boolean }) {
  return (
    <div className={cn("grid gap-3", compact ? "" : "p-4 md:grid-cols-2")}>
      <div className="rounded-xl border bg-card p-3">
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          <EngineIcon id={row.engine} size="xs" withTooltip={false} /> What AI said
        </div>
        <blockquote className="border-l-2 border-destructive/50 pl-3 text-sm whitespace-pre-wrap">{row.answerQuote || row.claim}</blockquote>
        {row.promptText && (
          <p className="mt-2 text-xs text-muted-foreground">
            Prompt: <span className="text-foreground">{row.promptText}</span>
          </p>
        )}
      </div>
      <div className="rounded-xl border bg-card p-3">
        <div className="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Label{row.labelSection ? ` · ${row.labelSection}` : ""}
        </div>
        {row.labelQuote ? (
          <blockquote className="border-l-2 border-brand/60 pl-3 text-sm whitespace-pre-wrap">{row.labelQuote}</blockquote>
        ) : (
          <p className="text-sm text-muted-foreground">No matching passage in the reference documents.</p>
        )}
      </div>
      <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground", !compact && "md:col-span-2")}>
        {row.explanation && <span className="text-foreground">{row.explanation}</span>}
        <span>
          Judged by {row.judgedBy === "ai" ? "AI" : row.judgedBy === "user" ? "a reviewer" : "word-for-word match"}
          {row.matchScore != null && row.judgedBy === "lexical" ? ` · ${Math.round(row.matchScore * 100)}% overlap` : ""}
        </span>
        <span>
          First seen {format(new Date(row.firstSeenAt), "MMM d, yyyy")} · last seen {format(new Date(row.lastSeenAt), "MMM d, yyyy")}
        </span>
        {row.promptId && (
          <Link href={`/p/${projectId}/ai/tracker?prompt=${row.promptId}`} className="font-medium text-foreground hover:underline">
            View answer in Tracker →
          </Link>
        )}
        <Link href={`/p/${projectId}/fact-check/assets/${row.assetId}`} className="font-medium text-foreground hover:underline">
          Open asset →
        </Link>
      </div>
    </div>
  );
}
