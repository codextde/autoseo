"use client";

import { Sparkles } from "lucide-react";
import { DataTable, type Column } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { formatCompact } from "@/components/app/metrics";
import type { RankDeviceResult, RankTrackingRow } from "@/server/seo/rank-tracking";
import { changeCell, classifyMovement, devicesList, SERP_FEATURE_LABELS } from "@/server/seo/lib/rank-tracking";
import { formatLocationLabel } from "@/server/seo/lib/locations";
import type { Cell } from "@/server/seo/lib/csv";
import { kdTone, localCity, pathOf, type ConfigLike } from "./rank-utils";
import { cn } from "@/lib/utils";

type Device = "desktop" | "mobile";

/** both null "-"; lost `prev → lost` (red); no previous = plain number; else `prev → pos` badge. */
export function DeviceRankCell({ result }: { result: RankDeviceResult }) {
  const { position, previousPosition } = result;
  const m = classifyMovement(position, previousPosition);
  if (m === "none") return <span className="text-muted-foreground">-</span>;
  if (m === "lost")
    return (
      <span className="inline-flex h-6 items-center rounded-md bg-destructive/10 px-1.5 text-xs font-medium text-destructive tabular">
        {previousPosition} → lost
      </span>
    );
  if (m === "new") return <span className="font-semibold tabular">{position}</span>;
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-md px-1.5 text-xs font-medium tabular",
        m === "improved" ? "bg-success/12 text-success" : m === "declined" ? "bg-warning/15 text-warning" : "bg-muted text-foreground",
      )}
      title={m === "same" ? "No change" : `${m === "improved" ? "Improved" : "Declined"} by ${Math.abs((previousPosition ?? 0) - (position ?? 0))}`}
    >
      {m === "same" ? position : `${previousPosition} → ${position}`}
    </span>
  );
}

function SerpFeatureBadges({ features }: { features: string[] }) {
  const known = features.filter((f) => f in SERP_FEATURE_LABELS);
  if (!known.length) return <span className="text-muted-foreground">-</span>;
  return (
    <div className="flex max-w-48 flex-wrap gap-1">
      {known.map((f) => (
        <span key={f} className="inline-flex h-5 items-center gap-0.5 rounded-full border bg-background px-1.5 text-[10px] font-medium text-muted-foreground" title={f.replace(/_/g, " ")}>
          {f === "ai_overview" && <Sparkles className="size-2.5 text-brand" />}
          {SERP_FEATURE_LABELS[f]}
        </span>
      ))}
    </div>
  );
}

function KdBadge({ value }: { value: number | null }) {
  return <span className={cn("inline-flex h-6 min-w-8 items-center justify-center rounded-md px-1.5 text-xs font-semibold tabular", kdTone(value))}>{value ?? "—"}</span>;
}

export function RankTable({
  config,
  rows,
  totalCount,
  device,
  selectable,
  selected,
  onSelectedChange,
  onKeywordClick,
  filtered,
}: {
  config: ConfigLike;
  rows: RankTrackingRow[];
  totalCount: number;
  device: Device;
  selectable: boolean;
  selected: Set<string>;
  onSelectedChange: (s: Set<string>) => void;
  onKeywordClick: (row: RankTrackingRow) => void;
  filtered: boolean;
}) {
  const city = localCity(config.locationName);
  const deviceLabel = device === "desktop" ? "Desktop" : "Mobile";
  const columns: Column<RankTrackingRow>[] = [
    {
      id: "keyword",
      header: "Keyword",
      sortValue: (r) => r.keyword,
      cell: (r) => (
        <button type="button" onClick={() => onKeywordClick(r)} className="flex max-w-[22rem] items-center gap-1.5 text-left font-medium hover:underline">
          <span className="truncate">{r.keyword}</span>
          {r.matchCase && (
            <span className="shrink-0 rounded border px-1 text-[10px] font-semibold text-muted-foreground" title="Match case">
              Aa
            </span>
          )}
        </button>
      ),
    },
    {
      id: "pos",
      header: `${deviceLabel} position`,
      align: "center",
      sortValue: (r) => r[device].position,
      cell: (r) => <DeviceRankCell result={r[device]} />,
    },
    {
      id: "url",
      header: "URL",
      hideBelow: "md",
      cell: (r) =>
        r[device].rankingUrl ? (
          <a href={r[device].rankingUrl!} target="_blank" rel="noopener noreferrer nofollow" className="block max-w-56 truncate text-xs text-muted-foreground hover:text-foreground hover:underline" title={r[device].rankingUrl!}>
            {pathOf(r[device].rankingUrl)}
          </a>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      id: "volume",
      header: city ? "Local volume" : "Volume",
      hint: city ? `Estimated monthly searches in ${city} from Google Ads` : undefined,
      align: "right",
      sortValue: (r) => r.searchVolume,
      cell: (r) => (r.searchVolume != null ? formatCompact(r.searchVolume) : "-"),
    },
    { id: "kd", header: "KD", align: "center", sortValue: (r) => r.keywordDifficulty, cell: (r) => <KdBadge value={r.keywordDifficulty} /> },
    { id: "cpc", header: "CPC", align: "right", hideBelow: "lg", sortValue: (r) => r.cpc, cell: (r) => (r.cpc != null ? `$${r.cpc.toFixed(2)}` : "-") },
    { id: "features", header: "SERP Features", hideBelow: "lg", cell: (r) => <SerpFeatureBadges features={r[device].serpFeatures} /> },
  ];

  return (
    <>
      <DataTable
        key={device}
        columns={columns}
        data={rows}
        getRowId={(r) => r.trackingKeywordId}
        initialSort={{ id: "pos", dir: "asc" }}
        paginate={rows.length > 100}
        pageSize={100}
        selectable={selectable}
        selected={selected}
        onSelectedChange={onSelectedChange}
        dense
        empty={
          filtered ? (
            <EmptyState compact title="No keywords match your search." />
          ) : (
            <EmptyState compact title="No rank data yet" description='Add keywords, then click "Check rankings" to run your first check.' />
          )
        }
        mobileCard={(r) => (
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <button type="button" onClick={() => onKeywordClick(r)} className="min-w-0 text-left font-medium">
                {r.keyword}
                {r.matchCase && <span className="ml-1.5 rounded border px-1 text-[10px] text-muted-foreground">Aa</span>}
              </button>
              <DeviceRankCell result={r[device]} />
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <div className="text-muted-foreground">{city ? "Local vol." : "Volume"}</div>
                <div className="tabular">{r.searchVolume != null ? formatCompact(r.searchVolume) : "-"}</div>
              </div>
              <div>
                <div className="text-muted-foreground">KD</div>
                <KdBadge value={r.keywordDifficulty} />
              </div>
              <div>
                <div className="text-muted-foreground">CPC</div>
                <div className="tabular">{r.cpc != null ? `$${r.cpc.toFixed(2)}` : "-"}</div>
              </div>
            </div>
            {r[device].rankingUrl && <div className="truncate text-xs text-muted-foreground">{pathOf(r[device].rankingUrl)}</div>}
          </div>
        )}
      />
      <div className="pt-2 text-xs text-muted-foreground tabular">
        {rows.length.toLocaleString()} of {totalCount.toLocaleString()} keywords
      </div>
    </>
  );
}

/** Export headers/rows: Keyword, Volume | Local volume (City, Region), KD, CPC, then per configured device Position/Change/URL/SERP Features. */
export function buildRankExport(config: ConfigLike, rows: RankTrackingRow[]): { headers: string[]; rows: Cell[][] } {
  const devices = devicesList(config.devices);
  const headers = [
    "Keyword",
    config.locationName ? `Local volume (${formatLocationLabel(config.locationName, 2)})` : "Volume",
    "KD",
    "CPC",
    ...devices.flatMap((d) => {
      const label = d === "desktop" ? "Desktop" : "Mobile";
      return [`${label} Position`, `${label} Change`, `${label} URL`, `${label} SERP Features`];
    }),
  ];
  const out = rows.map((r) => [
    r.keyword,
    r.searchVolume ?? "",
    r.keywordDifficulty ?? "",
    r.cpc != null ? r.cpc.toFixed(2) : "",
    ...devices.flatMap((d) => [r[d].position ?? "", changeCell(r[d].position, r[d].previousPosition), r[d].rankingUrl ?? "", r[d].serpFeatures.join(", ")]),
  ]);
  return { headers, rows: out };
}

