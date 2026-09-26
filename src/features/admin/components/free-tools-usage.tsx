import { Activity, Ban, Database, Users, Wallet, Zap } from "lucide-react";
import { Panel } from "@/components/app/page";
import { Meter, formatNumber } from "@/components/app/metrics";
import { Badge } from "@/components/ui/badge";
import type { FreeToolsUsageToday } from "@/server/free-tools/budget";
import { formatUsd } from "@/features/settings/usage/labels";

function Kpi({
  icon: Icon,
  label,
  value,
  sub,
  pct,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  pct?: number | null;
}) {
  const tone = pct == null ? "brand" : pct >= 100 ? "destructive" : pct >= 80 ? "warning" : "brand";
  return (
    <div className="min-w-0 rounded-xl bg-muted/50 p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </div>
      <div className="mt-1 text-lg font-semibold tracking-tight tabular">{value}</div>
      {pct != null && <Meter value={pct} tone={tone} className="mt-1.5" />}
      {sub && <div className="mt-1 truncate text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** Today's public free-tool usage (paid DataForSEO calls, spend vs limits, per tool). */
export function FreeToolsUsageCard({ usage, error }: { usage: FreeToolsUsageToday | null; error?: string | null }) {
  if (!usage) {
    return (
      <Panel title="Today's usage" icon={<Activity className="size-4 text-muted-foreground" />}>
        <p className="text-sm text-muted-foreground">Usage couldn&apos;t be loaded{error ? `: ${error}` : "."}</p>
      </Panel>
    );
  }
  const { limits } = usage;
  const callPct = limits.maxCallsPerDay > 0 ? (usage.calls / limits.maxCallsPerDay) * 100 : null;
  const spendPct = limits.dailyBudgetUsd > 0 ? (usage.estimatedUsd / limits.dailyBudgetUsd) * 100 : null;
  return (
    <Panel
      title="Today's usage"
      icon={<Activity className="size-4 text-muted-foreground" />}
      description={`Public free tools since 00:00 UTC (${usage.day}). Cached results don't cost anything.`}
    >
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi
          icon={Zap}
          label="Paid calls"
          value={formatNumber(usage.calls)}
          sub={limits.maxCallsPerDay > 0 ? `of ${formatNumber(limits.maxCallsPerDay)} / day` : "paid tools disabled"}
          pct={callPct}
        />
        <Kpi
          icon={Wallet}
          label="Est. spend"
          value={formatUsd(usage.estimatedUsd)}
          sub={limits.dailyBudgetUsd > 0 ? `of ${formatUsd(limits.dailyBudgetUsd)} budget` : "no budget → paid tools off"}
          pct={spendPct}
        />
        <Kpi icon={Activity} label="Requests" value={formatNumber(usage.runs)} />
        <Kpi icon={Database} label="Cache hits" value={formatNumber(usage.cacheHits)} sub={usage.runs ? `${Math.round((usage.cacheHits / usage.runs) * 100)}% of requests` : undefined} />
        <Kpi icon={Users} label="Visitors" value={formatNumber(usage.visitors)} sub={`max ${formatNumber(limits.perVisitorCallsPerDay)} calls each`} />
        <Kpi icon={Ban} label="Blocked" value={formatNumber(usage.blocked)} sub="rate limit, bot check, budget" />
      </div>
      <ul className="mt-4 divide-y rounded-xl border">
        {usage.tools.map((t) => {
          const pct = t.callsLimit ? (t.calls / t.callsLimit) * 100 : null;
          return (
            <li key={t.tool} className="grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,220px)_auto] sm:items-center sm:gap-4">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-medium">{t.name}</span>
                {!t.paid && (
                  <Badge variant="outline" className="h-5 shrink-0 text-[10px] text-muted-foreground">
                    free
                  </Badge>
                )}
              </div>
              <div className="min-w-0">
                {t.paid && t.callsLimit ? (
                  <>
                    <Meter value={pct ?? 0} tone={pct != null && pct >= 100 ? "destructive" : pct != null && pct >= 80 ? "warning" : "brand"} />
                    <div className="mt-1 text-[11px] text-muted-foreground tabular">
                      {formatNumber(t.calls)} / {formatNumber(t.callsLimit)} calls · {formatUsd(t.estimatedUsd)}
                    </div>
                  </>
                ) : (
                  <span className="text-[11px] text-muted-foreground">No DataForSEO cost</span>
                )}
              </div>
              <div className="flex gap-3 text-[11px] text-muted-foreground tabular sm:justify-end">
                <span>{formatNumber(t.runs)} runs</span>
                <span>{formatNumber(t.cacheHits)} cached</span>
                {t.blocked > 0 && <span className="text-warning">{formatNumber(t.blocked)} blocked</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
