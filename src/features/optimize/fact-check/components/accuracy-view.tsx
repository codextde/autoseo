"use client";

import Link from "next/link";
import { Target } from "lucide-react";
import { BarsChart, TrendChart } from "@/components/app/charts";
import { DataTable, type Column } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { EngineIcon } from "@/components/app/engine-icon";
import { PeriodSelect } from "@/components/app/filters";
import { KpiStrip, Meter } from "@/components/app/metrics";
import { CountryFlag } from "@/components/app/misc";
import { Panel } from "@/components/app/page";
import { useUrlState } from "@/hooks/use-url-state";
import { getCountry } from "@/lib/countries";
import { getEngine } from "@/lib/engines";
import { FC_VERDICT_META } from "@/features/optimize/constants";
import type { AccuracyData, AccuracyGroup } from "../types";
import { VERDICT_COLORS } from "./badges";

const DEVIATIONS = ["off_label", "contradicted", "unsupported", "outdated"] as const;
const PRESETS = [
  { key: "30d", label: "30d" },
  { key: "90d", label: "90d" },
  { key: "365d", label: "12m" },
];

function rateText(v: number | null) {
  return v == null ? "—" : `${v.toFixed(v >= 10 || v === 0 ? 0 : 1)}%`;
}

function GroupRows({ items, kind }: { items: AccuracyGroup[]; kind: "engine" | "market" }) {
  if (!items.length) return <p className="py-6 text-center text-sm text-muted-foreground">No checked statements in this period.</p>;
  return (
    <ul className="space-y-2.5">
      {items.map((g) => (
        <li key={g.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
          <span className="flex min-w-0 items-center gap-2 text-sm">
            {kind === "engine" ? <EngineIcon id={g.key} size="xs" /> : <CountryFlag iso={g.key} />}
            <span className="truncate">{kind === "engine" ? (getEngine(g.key)?.name ?? g.key) : (getCountry(g.key)?.name ?? g.key)}</span>
            <span className="text-xs text-muted-foreground tabular">{g.counts.checked} checked</span>
          </span>
          <span className="text-sm font-medium tabular">{rateText(g.matchRate)}</span>
          <Meter value={g.matchRate ?? 0} className="col-span-2" tone={g.matchRate != null && g.matchRate < 70 ? "warning" : "brand"} />
        </li>
      ))}
    </ul>
  );
}

export function AccuracyView({ projectId, data }: { projectId: string; data: AccuracyData }) {
  const [period, setPeriod] = useUrlState("period", "90d");
  const t = data.total;
  const deviations = DEVIATIONS.reduce((a, k) => a + t[k], 0);
  const mixData = data.byEngine.map((g) => ({
    engine: getEngine(g.key)?.shortName ?? g.key,
    matched: g.counts.matched,
    ...Object.fromEntries(DEVIATIONS.map((k) => [k, g.counts[k]])),
    needs_review: g.counts.needs_review,
  }));

  const assetColumns: Column<AccuracyData["byAsset"][number]>[] = [
    {
      id: "name",
      header: "Asset",
      sortValue: (r) => r.name,
      cell: (r) => (
        <Link href={`/p/${projectId}/fact-check/assets/${r.id}`} className="font-medium hover:underline">
          {r.name}
        </Link>
      ),
    },
    { id: "checked", header: "Checked", align: "right", sortValue: (r) => r.counts.checked, cell: (r) => r.counts.checked },
    { id: "matched", header: "Matched", align: "right", sortValue: (r) => r.counts.matched, cell: (r) => r.counts.matched },
    {
      id: "deviations",
      header: "Deviations",
      align: "right",
      sortValue: (r) => DEVIATIONS.reduce((a, k) => a + r.counts[k], 0),
      cell: (r) => DEVIATIONS.reduce((a, k) => a + r.counts[k], 0),
    },
    { id: "review", header: "Needs review", align: "right", hideBelow: "md", sortValue: (r) => r.counts.needs_review, cell: (r) => r.counts.needs_review },
    {
      id: "rate",
      header: "Match %",
      align: "right",
      sortValue: (r) => r.matchRate ?? -1,
      cell: (r) => (
        <div className="ml-auto flex w-28 items-center gap-2">
          <Meter value={r.matchRate ?? 0} className="flex-1" />
          <span className="w-10 text-right tabular">{rateText(r.matchRate)}</span>
        </div>
      ),
    },
    {
      id: "open",
      header: "Open findings",
      align: "right",
      sortValue: (r) => r.openFindings,
      cell: (r) =>
        r.openFindings ? (
          <Link href={`/p/${projectId}/fact-check/findings?asset=${r.id}`} className="font-medium hover:underline">
            {r.openFindings}
          </Link>
        ) : (
          <span className="text-muted-foreground">0</span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">How accurately each AI engine repeats your label, by the date statements were last seen.</p>
        <PeriodSelect value={period} onChange={setPeriod} presets={PRESETS} />
      </div>
      <KpiStrip
        items={[
          { key: "rate", label: "Match rate", value: rateText(data.matchRate) },
          { key: "checked", label: "Checked statements", value: t.checked },
          { key: "dev", label: "Deviations", value: deviations, sub: t.checked ? `${((deviations / t.checked) * 100).toFixed(1)}% of checked` : undefined },
          { key: "review", label: "Needs review", value: t.needs_review },
        ]}
      />

      {t.checked === 0 ? (
        <Panel>
          <EmptyState
            icon={Target}
            title="No accuracy data yet"
            description="Once statements about your assets are collected and checked against the label, accuracy per engine, market and asset appears here."
            action={{ label: "Back to overview", href: `/p/${projectId}/fact-check` }}
          />
        </Panel>
      ) : (
        <>
          <Panel title="Match rate over time" description="Share of checked statements that match the label, per week">
            <TrendChart
              data={data.trend}
              series={[
                { key: "matchRate", label: "Match rate", color: "var(--brand)" },
                { key: "deviationRate", label: "Deviation rate", color: "var(--destructive)", dashed: true },
              ]}
              format="percent"
              domain={[0, 100]}
              height={240}
              type="line"
              legend
            />
          </Panel>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="By model" description="Match rate per AI engine">
              <GroupRows items={data.byEngine} kind="engine" />
            </Panel>
            <Panel title="By market" description="Match rate per market">
              <GroupRows items={data.byMarket} kind="market" />
            </Panel>
          </div>
          <Panel title="Deviation mix per model" description="What kind of mistakes each engine makes">
            <BarsChart
              data={mixData}
              xKey="engine"
              stacked
              legend
              height={260}
              xFormatter={(v) => v}
              series={[
                { key: "matched", label: "Matched", color: VERDICT_COLORS.matched },
                ...DEVIATIONS.map((k) => ({ key: k, label: FC_VERDICT_META[k].label, color: VERDICT_COLORS[k] })),
                { key: "needs_review", label: "Needs review", color: VERDICT_COLORS.needs_review },
              ]}
            />
          </Panel>
        </>
      )}

      <Panel title="By asset" contentClassName="p-3 sm:p-4">
        <DataTable
          columns={assetColumns}
          data={data.byAsset}
          getRowId={(r) => r.id}
          initialSort={{ id: "checked", dir: "desc" }}
          empty={<p className="py-8 text-center text-sm text-muted-foreground">No assets yet.</p>}
          mobileCard={(r) => (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Link href={`/p/${projectId}/fact-check/assets/${r.id}`} className="font-medium">
                  {r.name}
                </Link>
                <span className="text-sm font-medium tabular">{rateText(r.matchRate)}</span>
              </div>
              <Meter value={r.matchRate ?? 0} />
              <div className="flex justify-between text-xs text-muted-foreground tabular">
                <span>
                  {r.counts.matched}/{r.counts.checked} matched
                </span>
                <span>{r.openFindings} open findings</span>
              </div>
            </div>
          )}
        />
      </Panel>
    </div>
  );
}
