import { forbidden } from "next/navigation";
import { PageContainer, PageHeader } from "@/components/app/page";
import { requireUser } from "@/server/auth/guards";
import { getSetting } from "@/server/settings";
import { getBudgetStatus, getUsageSummary } from "@/server/admin/usage";
import { getDataForSeoBalance, getMonthlyHistory, getPlanStats, resolveBillingScope, scopeProjectRows } from "@/server/admin/billing";
import { forecastMonthEnd, daysInUtcMonth, monthLabel } from "@/features/settings/billing/math";
import { BillingOverview } from "@/features/settings/billing/billing-overview";
import { BillingHistory } from "@/features/settings/billing/history-table";
import { CostEstimator } from "@/features/settings/billing/cost-estimator";
import { WorkspaceSwitcher } from "@/features/settings/workspace/workspace-switcher";

export const metadata = { title: "Billing & Costs" };

export default async function BillingPage({ searchParams }: PageProps<"/settings/billing">) {
  const ctx = await requireUser();
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);
  const bs = await resolveBillingScope(ctx, { ws: str("ws"), scope: str("scope") });
  if (!bs) forbidden();

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [summary, history, plan, limits, budget, balance] = await Promise.all([
    getUsageSummary(bs.scope, monthStart, now),
    getMonthlyHistory(bs.scope, 12, now),
    getPlanStats(bs.scope),
    getSetting("limits"),
    // Instance-wide numbers are admin-only.
    bs.isAdmin ? getBudgetStatus() : Promise.resolve(null),
    bs.isAdmin ? getDataForSeoBalance() : Promise.resolve(null),
  ]);
  const currentMonth = now.toISOString().slice(0, 7);
  const exportParams = new URLSearchParams();
  if (bs.workspaceId && bs.scopeKind === "workspace") exportParams.set("ws", bs.workspaceId);
  if (bs.scopeKind === "instance") exportParams.set("scope", "instance");

  return (
    <PageContainer>
      <PageHeader
        title="Billing & Costs"
        description="Self-hosted means no subscription: see what the providers cost you, how the month is trending and what more usage would cost."
        actions={
          bs.scopeKind === "workspace" &&
          bs.workspaceId && <WorkspaceSwitcher current={bs.workspaceId} workspaces={bs.viewable} />
        }
      />
      <BillingOverview
        data={{
          scopeKind: bs.scopeKind,
          canSwitchScope: bs.isAdmin && bs.viewable.length > 0,
          isAdmin: bs.isAdmin,
          plan,
          month: {
            label: monthLabel(currentMonth),
            spent: summary.month,
            forecast: forecastMonthEnd(summary.month, now),
            events: summary.totals.events,
            daysLeft: daysInUtcMonth(now) - now.getUTCDate(),
            byDay: summary.byDay.map((d) => ({ date: d.date, cost: Number(d.cost.toFixed(4)) })),
            byProvider: summary.byProvider,
            byFeature: summary.byFeature,
            byProject: scopeProjectRows(summary.byProject, bs.reach),
          },
          instance:
            budget && balance
              ? {
                  monthlyBudget: budget.monthly.budget,
                  spent: budget.monthly.spent,
                  forecast: forecastMonthEnd(budget.monthly.spent, now),
                  balance,
                }
              : null,
        }}
      />
      <BillingHistory
        rows={history}
        budget={bs.scopeKind === "instance" && budget ? budget.monthly.budget : null}
        exportHref={`/settings/billing/export${exportParams.size ? `?${exportParams}` : ""}`}
        currentMonth={currentMonth}
      />
      <CostEstimator markupPercent={limits.resaleMarkupPercent} recentSpend={summary.last30} />
    </PageContainer>
  );
}
