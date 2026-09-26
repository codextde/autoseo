"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  ClipboardCopy,
  History,
  List,
  Loader2,
  MoreHorizontal,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Panel } from "@/components/app/page";
import { KpiStrip, type KpiItem } from "@/components/app/metrics";
import { ConfirmButton } from "@/components/app/misc";
import type { RankRunView, RankTrackingRow } from "@/server/seo/rank-tracking";
import {
  CHECK_CONFIRM_THRESHOLD,
  COMPARE_PERIOD_LABELS,
  computeScorecards,
  defaultComparePeriod,
  devicesLabel,
  estimateRankCheckCost,
  scheduleLabel,
  type ComparePeriod,
} from "@/server/seo/lib/rank-tracking";
import { formatUsd } from "@/server/seo/lib/costs";
import { fileSafe } from "@/server/seo/lib/csv";
import {
  getLatestRankRunAction,
  getPositionMatrixAction,
  getRankResultsAction,
  refreshTrackingMetricsAction,
  removeTrackingKeywordsAction,
  triggerRankCheckAction,
} from "../../actions/rank";
import { copyText, toastError, unwrap } from "../../lib/client";
import { useQueryParams } from "../../hooks/use-query-params";
import { useSeoQuery } from "../../hooks/use-seo-query";
import { useJobPoll } from "../../hooks/use-job-poll";
import type { ClientPageInfo } from "../../server/page-context";
import { FilterPanel, FiltersToggle, type FilterValues } from "../shared/filter-panel";
import { ExportMenu } from "../shared/export-menu";
import { BulkBar } from "../shared/bulk-bar";
import { RankConfigModal } from "./rank-config-modal";
import { AddKeywordsPanel } from "./add-keywords-panel";
import { CheckConfirmModal } from "./check-confirm-modal";
import { KeywordTrendModal } from "./keyword-trend-modal";
import { PositionDistribution } from "./position-distribution";
import { HistoryMatrix, type MatrixData } from "./history-matrix";
import { buildRankExport, RankTable } from "./rank-table";
import { configFlag, configLocationLabel, formatShortDate, skipReasonMessage, type ConfigLike } from "./rank-utils";
import { cn } from "@/lib/utils";

type Device = "desktop" | "mobile";
type ResultsRun = (RankRunView & { lastCheckedAt: Date | string | null }) | null;
export type RankDetailConfig = ConfigLike & { lastCheckedAt: Date | string | null; isActive: boolean };

const FILTER_KEYS = ["inc", "exc", "dMin", "dMax", "mMin", "mMax", "vMin", "vMax", "kMin", "kMax", "cMin", "cMax"] as const;
const COMPARE_PERIODS: ComparePeriod[] = ["1d", "7d", "30d", "90d"];

function isActiveRun(run: RankRunView | null | undefined): boolean {
  return run?.status === "pending" || run?.status === "running";
}

function terms(v: string) {
  return v
    .toLowerCase()
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function inRange(value: number | null, min: string, max: string) {
  if (!min && !max) return true;
  if (value == null) return false;
  if (min && value < Number(min)) return false;
  if (max && value > Number(max)) return false;
  return true;
}

function runProgressLabel(run: RankRunView): string {
  if (run.status === "pending" || run.phase === "prepare") return "Preparing...";
  if (run.phase === "post") return "Posting keywords to the DataForSEO queue...";
  if (run.phase === "collect") return `Waiting for DataForSEO queue (round ${run.collectRound + 1} of 6)... ${run.keywordsChecked}/${run.keywordsTotal}`;
  if (run.phase === "fallback") return `Checking remaining keywords live... ${run.keywordsChecked}/${run.keywordsTotal}`;
  return `Getting rankings for ${run.keywordsTotal} keywords... ${run.keywordsChecked}/${run.keywordsTotal}`;
}

/** Tracker detail: header, scorecards, distribution chart, latest table / history matrix, checks + polling. */
export function RankDetailView({
  info,
  config,
  initialRows,
  initialRun,
  initialLatestRun,
}: {
  info: ClientPageInfo;
  config: RankDetailConfig;
  initialRows: RankTrackingRow[];
  initialRun: ResultsRun;
  initialLatestRun: RankRunView | null;
}) {
  const router = useRouter();
  const { params, set } = useQueryParams();
  const projectId = info.projectId;
  const canCheck = info.canRun && info.configured;

  const compareParam = params.get("compare") as ComparePeriod | null;
  const compare: ComparePeriod = compareParam && COMPARE_PERIODS.includes(compareParam) ? compareParam : defaultComparePeriod(config.scheduleInterval);
  const device: Device = config.devices === "both" ? (params.get("device") === "mobile" ? "mobile" : "desktop") : config.devices;
  const view = params.get("view") === "history" ? "history" : "latest";
  const range = params.get("range") ?? "all";
  const filterValues: FilterValues = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ""]));
  const activeFilters = Object.values(filterValues).filter(Boolean).length;

  const [rows, setRows] = useState(initialRows);
  const [resultsRun, setResultsRun] = useState<ResultsRun>(initialRun);
  const [loadingResults, setLoadingResults] = useState(false);
  const [latestRun, setLatestRun] = useState<RankRunView | null>(initialLatestRun);
  const [version, setVersion] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(activeFilters > 0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [trendKeyword, setTrendKeyword] = useState<{ id: string; keyword: string } | null>(null);
  const [metricsJob, setMetricsJob] = useState<{ id: string; silent: boolean } | null>(null);

  // Server props change after router.refresh() (e.g. config edited) — sync during render.
  const [prevInitial, setPrevInitial] = useState(initialRows);
  if (prevInitial !== initialRows) {
    setPrevInitial(initialRows);
    setRows(initialRows);
    setResultsRun(initialRun);
  }

  const loadResults = async (period: ComparePeriod) => {
    setLoadingResults(true);
    try {
      const res = unwrap(await getRankResultsAction(projectId, config.id, period));
      setRows(res.rows);
      setResultsRun(res.run);
    } catch (err) {
      toastError(err);
    } finally {
      setLoadingResults(false);
    }
  };

  const onRunSettled = (run: RankRunView | null) => {
    void loadResults(compare);
    setVersion((v) => v + 1);
    if (run?.status === "completed") toast.success("Rank check finished");
    else if (run?.status === "failed") toast.error(run.errorMessage ?? "Rank check failed");
  };

  // Latest handler for the polling timer (updated after render, never during it).
  const settledRef = useRef(onRunSettled);
  useEffect(() => {
    settledRef.current = onRunSettled;
  });

  // Poll the latest run every 3 s while it is pending/running; refresh results once it settles.
  useEffect(() => {
    if (!isActiveRun(latestRun)) return;
    const timer = setTimeout(async () => {
      const res = await getLatestRankRunAction(projectId, config.id);
      if (!res.ok) return;
      setLatestRun(res.data);
      if (!isActiveRun(res.data)) settledRef.current(res.data);
    }, 3000);
    return () => clearTimeout(timer);
  }, [latestRun, projectId, config.id]);

  const refreshLatestRun = async () => {
    const res = await getLatestRankRunAction(projectId, config.id);
    if (!res.ok) return;
    setLatestRun(res.data);
    if (!isActiveRun(res.data)) onRunSettled(null);
  };

  useJobPoll(projectId, metricsJob?.id ?? null, (job) => {
    const silent = metricsJob?.silent;
    setMetricsJob(null);
    if (job.status === "succeeded") {
      const updated = (job.result as { updated?: number } | null)?.updated ?? 0;
      if (!silent) toast.success(`Metrics updated for ${updated} keyword${updated === 1 ? "" : "s"}`);
      void loadResults(compare);
    } else if (!silent) toast.error(job.lastError ?? "Updating keyword stats failed");
  });

  const matrix = useSeoQuery<MatrixData>(
    `rank-matrix:${config.id}:${device}:${version}`,
    async () => unwrap(await getPositionMatrixAction(projectId, config.id, device, 12)),
    { staleMs: 60_000 },
  );
  const completedRuns = matrix.data?.runs.length ?? 0;
  const effectiveView = view === "history" && completedRuns >= 2 ? "history" : "latest";

  const filteredRows = useMemo(() => {
    const inc = terms(filterValues.inc ?? "");
    const exc = terms(filterValues.exc ?? "");
    return rows.filter((r) => {
      const kw = r.keyword.toLowerCase();
      if (inc.length && !inc.some((t) => kw.includes(t))) return false;
      if (exc.some((t) => kw.includes(t))) return false;
      if (!inRange(r.desktop.position, filterValues.dMin ?? "", filterValues.dMax ?? "")) return false;
      if (!inRange(r.mobile.position, filterValues.mMin ?? "", filterValues.mMax ?? "")) return false;
      if (!inRange(r.searchVolume, filterValues.vMin ?? "", filterValues.vMax ?? "")) return false;
      if (!inRange(r.keywordDifficulty, filterValues.kMin ?? "", filterValues.kMax ?? "")) return false;
      if (!inRange(r.cpc, filterValues.cMin ?? "", filterValues.cMax ?? "")) return false;
      return true;
    });
    // filterValues is rebuilt from the URL each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, params]);

  const scorecards = useMemo(
    () => computeScorecards(rows.map((r) => ({ searchVolume: r.searchVolume, position: r[device].position, previousPosition: r[device].previousPosition }))),
    [rows, device],
  );
  const kpis: KpiItem[] = [
    {
      key: "visibility",
      label: "Visibility",
      value: scorecards.visibility != null ? `${scorecards.visibility.toFixed(1)}%` : "—",
      delta: scorecards.visibilityDelta,
      hint: "Estimated share of available clicks: Σ(volume × CTR at the position) ÷ (Σ volume × 28%, the #1 CTR).",
    },
    { key: "ranking", label: "Ranking", value: `${scorecards.ranking}/${rows.length}`, delta: scorecards.rankingDelta, deltaSuffix: "", hint: "Keywords found within the tracked depth." },
    { key: "top3", label: "Top 3", value: scorecards.top3 },
    { key: "top10", label: "Top 10", value: scorecards.top10 },
    { key: "improved", label: "Improved", value: <span className="text-success">{scorecards.improved}</span>, hint: `Moved up or newly ranking ${COMPARE_PERIOD_LABELS[compare]}.` },
    { key: "declined", label: "Declined", value: <span className="text-destructive">{scorecards.declined}</span>, hint: `Moved down or lost ${COMPARE_PERIOD_LABELS[compare]}.` },
  ];

  const checkCost = estimateRankCheckCost(rows.length, config.devices, config.serpDepth, "live").costUsd;
  const lastChecked = resultsRun?.lastCheckedAt ?? config.lastCheckedAt;
  const active = latestRun && isActiveRun(latestRun) ? latestRun : null;
  const skip = skipReasonMessage(config.lastSkipReason, "detail");
  const selectedRows = rows.filter((r) => selected.has(r.trackingKeywordId));

  const startCheck = async () => {
    setStarting(true);
    try {
      const res = unwrap(await triggerRankCheckAction(projectId, config.id));
      if (!res.ok) toast.message("A rank check is already running");
      else toast.success("Rank check started");
      setConfirmOpen(false);
      await refreshLatestRun();
    } catch (err) {
      toastError(err);
    } finally {
      setStarting(false);
    }
  };
  const requestCheck = () => {
    if (rows.length < CHECK_CONFIRM_THRESHOLD) void startCheck();
    else setConfirmOpen(true);
  };
  const refreshMetrics = async () => {
    try {
      const res = unwrap(await refreshTrackingMetricsAction(projectId, config.id));
      if (res.jobId) setMetricsJob({ id: res.jobId, silent: false });
      toast.message(res.alreadyRunning ? "Keyword stats are already being updated" : "Updating keyword stats…");
    } catch (err) {
      toastError(err);
    }
  };

  const exportAll = () => {
    const e = buildRankExport(config, filteredRows);
    return { ...e, filename: `rank-tracking-${fileSafe(config.domain)}` };
  };

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
        <Link href={`/p/${projectId}/seo/rank-tracking`}>
          <ArrowLeft /> Back to domains
        </Link>
      </Button>

      {skip && (
        <Alert className="border-warning/30 bg-warning/10">
          <AlertTriangle className="text-warning" />
          <AlertDescription>{skip}</AlertDescription>
        </Alert>
      )}
      {latestRun?.maybeStale && (
        <Alert className="border-warning/30 bg-warning/10">
          <AlertTriangle className="text-warning" />
          <AlertDescription>This run may be unresponsive and will be cleaned up automatically.</AlertDescription>
        </Alert>
      )}
      {latestRun?.status === "failed" && (
        <Alert variant="destructive">
          <XCircle />
          <AlertDescription>Last check failed. {latestRun.errorMessage}</AlertDescription>
        </Alert>
      )}
      {latestRun?.status === "completed" && latestRun.errorMessage && (
        <Alert>
          <AlertTriangle className="text-muted-foreground" />
          <AlertDescription>{latestRun.errorMessage}</AlertDescription>
        </Alert>
      )}

      {/* Header */}
      <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-soft sm:p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border bg-background text-xl">{configFlag(config.locationCode)}</span>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold tracking-tight">{config.domain}</h2>
            <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
              <span>{configLocationLabel(config)}</span>
              <span>·</span>
              <span>{devicesLabel(config.devices)}</span>
              <span>·</span>
              <span>{scheduleLabel(config.scheduleInterval)}</span>
              <span>·</span>
              <span>Last: {formatShortDate(lastChecked)}</span>
              <span>·</span>
              <span className="tabular">~{formatUsd(checkCost)}/check</span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {config.devices === "both" && (
            <div className="flex rounded-lg bg-muted p-0.5" role="tablist" aria-label="Device">
              {(["desktop", "mobile"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => set({ device: d === "desktop" ? null : d })}
                  className={cn("rounded-md px-2.5 py-1 text-xs font-medium capitalize", device === d ? "bg-background shadow-xs" : "text-muted-foreground hover:text-foreground")}
                >
                  {d}
                </button>
              ))}
            </div>
          )}
          <Select
            value={compare}
            onValueChange={(v) => {
              set({ compare: v === defaultComparePeriod(config.scheduleInterval) ? null : v });
              void loadResults(v as ComparePeriod);
            }}
          >
            <SelectTrigger size="sm" className="h-8 w-[150px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COMPARE_PERIODS.map((p) => (
                <SelectItem key={p} value={p}>
                  {COMPARE_PERIOD_LABELS[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-8" onClick={() => setConfigOpen(true)} disabled={!info.canRun}>
            <Settings2 /> Configure
          </Button>
          <Button variant={addOpen ? "secondary" : "outline"} size="sm" className="h-8" onClick={() => setAddOpen((o) => !o)} disabled={!info.canRun}>
            <Plus /> Add Keywords
          </Button>
          <Button size="sm" className="h-8" onClick={requestCheck} disabled={!canCheck || Boolean(active) || starting || rows.length === 0}>
            {active || starting ? <Loader2 className="animate-spin" /> : <Play />}
            Check now
          </Button>
        </div>
      </div>

      <AddKeywordsPanel
        projectId={projectId}
        configId={config.id}
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={(res) => {
          void loadResults(compare);
          if (res.checkTriggered) void refreshLatestRun();
          if (res.metricsJobId) setMetricsJob({ id: res.metricsJobId, silent: true });
        }}
      />

      {rows.length > 0 && <KpiStrip items={kpis} />}

      {rows.length > 0 && (
        <PositionDistribution projectId={projectId} configId={config.id} device={device} version={version} range={range} onRangeChange={(r) => set({ range: r === "all" ? null : r })} />
      )}

      <Panel contentClassName="p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          {completedRuns >= 2 && (
            <div className="flex rounded-lg bg-muted p-0.5">
              <button
                type="button"
                onClick={() => set({ view: null })}
                className={cn("flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium", effectiveView === "latest" ? "bg-background shadow-xs" : "text-muted-foreground")}
              >
                <List className="size-3.5" /> Latest
              </button>
              <button
                type="button"
                onClick={() => set({ view: "history" })}
                className={cn("flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium", effectiveView === "history" ? "bg-background shadow-xs" : "text-muted-foreground")}
              >
                <History className="size-3.5" /> History
              </button>
            </div>
          )}
          <FiltersToggle open={filtersOpen} onToggle={() => setFiltersOpen((o) => !o)} active={activeFilters} />
          {active ? (
            <div className="flex min-w-48 flex-1 items-center gap-2 text-xs text-muted-foreground sm:max-w-sm">
              <Loader2 className="size-3.5 shrink-0 animate-spin" />
              <div className="min-w-0 flex-1">
                <div className="truncate">{runProgressLabel(active)}</div>
                {active.status === "running" && active.keywordsTotal > 0 && <Progress value={(active.keywordsChecked / active.keywordsTotal) * 100} className="mt-1" />}
              </div>
            </div>
          ) : (
            (loadingResults || metricsJob) && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
          )}
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-xs text-muted-foreground tabular sm:inline">
              {rows.length.toLocaleString()} keyword{rows.length === 1 ? "" : "s"}
            </span>
            <ExportMenu
              getData={exportAll}
              disabled={rows.length === 0}
              extra={
                <DropdownMenuItem onSelect={() => copyText(filteredRows.map((r) => r.keyword).join("\n"), `Copied ${filteredRows.length} keywords`)}>
                  <ClipboardCopy /> Copy keywords
                </DropdownMenuItem>
              }
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1" aria-label="More actions">
                  <MoreHorizontal className="size-3.5" />
                  <ChevronDown className="size-3 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuItem disabled={!canCheck || Boolean(active) || rows.length === 0} onSelect={requestCheck} className="flex-col items-start gap-0">
                  <span className="flex items-center gap-2 font-medium">
                    <Play className="size-3.5" /> Check rankings
                  </span>
                  <span className="pl-5.5 text-xs text-muted-foreground">Fetch current Google positions</span>
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!canCheck || Boolean(metricsJob) || rows.length === 0} onSelect={refreshMetrics} className="flex-col items-start gap-0">
                  <span className="flex items-center gap-2 font-medium">
                    <RefreshCw className="size-3.5" /> Update keyword stats
                  </span>
                  <span className="pl-5.5 text-xs text-muted-foreground">Volume, difficulty & CPC — not rankings</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <FilterPanel
          open={filtersOpen}
          mode="live"
          values={filterValues}
          onApply={(v) => set(v)}
          textFields={[
            { key: "inc", label: "Include terms", placeholder: "e.g. seo, tool" },
            { key: "exc", label: "Exclude terms", placeholder: "e.g. free, cheap" },
          ]}
          rangeFields={[
            ...(config.devices !== "mobile" ? [{ label: "Desktop position", minKey: "dMin", maxKey: "dMax", min: 1 }] : []),
            ...(config.devices !== "desktop" ? [{ label: "Mobile position", minKey: "mMin", maxKey: "mMax", min: 1 }] : []),
            { label: "Volume", minKey: "vMin", maxKey: "vMax", min: 0 },
            { label: "KD", minKey: "kMin", maxKey: "kMax", min: 0, max: 100 },
            { label: "CPC (USD)", minKey: "cMin", maxKey: "cMax", step: 0.01, min: 0 },
          ]}
        />

        <div className="mt-3">
          {effectiveView === "history" ? (
            <HistoryMatrix
              data={matrix.data}
              loading={matrix.loading}
              keywords={filteredRows.map((r) => ({ id: r.trackingKeywordId, keyword: r.keyword }))}
              onKeywordClick={setTrendKeyword}
            />
          ) : (
            <RankTable
              config={config}
              rows={filteredRows}
              totalCount={rows.length}
              device={device}
              selectable={info.canRun}
              selected={selected}
              onSelectedChange={setSelected}
              onKeywordClick={(r) => setTrendKeyword({ id: r.trackingKeywordId, keyword: r.keyword })}
              filtered={activeFilters > 0 && rows.length > 0}
            />
          )}
        </div>
      </Panel>

      <BulkBar count={selected.size} onClear={() => setSelected(new Set())}>
        <ExportMenu getData={() => ({ ...buildRankExport(config, selectedRows), filename: `rank-tracking-${fileSafe(config.domain)}-selected` })} />
        <ConfirmButton
          title="Remove keywords?"
          description={`This will stop tracking ${selected.size} keyword${selected.size === 1 ? "" : "s"}. Historical ranking data is preserved but won't appear in the table.`}
          confirmLabel="Remove"
          destructive
          onConfirm={async () => {
            try {
              const res = unwrap(await removeTrackingKeywordsAction(projectId, config.id, [...selected]));
              toast.success(`Removed ${res.removed} keyword${res.removed === 1 ? "" : "s"}`);
              setSelected(new Set());
              void loadResults(compare);
            } catch (err) {
              toastError(err);
            }
          }}
        >
          <Button size="sm" variant="destructive">
            <Trash2 /> Remove
          </Button>
        </ConfirmButton>
      </BulkBar>

      <CheckConfirmModal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        keywordCount={rows.length}
        devices={config.devices}
        serpDepth={config.serpDepth}
        busy={starting}
        onConfirm={startCheck}
      />
      <KeywordTrendModal projectId={projectId} config={config} keyword={trendKeyword} open={trendKeyword != null} onOpenChange={(o) => !o && setTrendKeyword(null)} />
      <RankConfigModal
        projectId={projectId}
        open={configOpen}
        onOpenChange={setConfigOpen}
        config={config}
        market={info.market}
        onSaved={() => {
          router.refresh();
          setVersion((v) => v + 1);
        }}
      />
    </div>
  );
}
