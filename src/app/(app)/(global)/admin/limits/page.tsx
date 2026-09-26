import Link from "next/link";
import { requireAdmin } from "@/server/auth/guards";
import { getAdminSettings } from "@/server/admin/settings";
import { getBudgetStatus, getUsageSummary } from "@/server/admin/usage";
import { Button } from "@/components/ui/button";
import { AdminPage } from "@/features/admin/components/settings-kit";
import { LimitsForm, type LimitsSettings } from "@/features/admin/components/limits-form";

export const metadata = { title: "Limits & Budgets · Admin" };

export default async function AdminLimitsPage() {
  await requireAdmin();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [settings, budget, month] = await Promise.all([
    getAdminSettings("limits"),
    getBudgetStatus(),
    getUsageSummary({ kind: "instance" }, monthStart, now),
  ]);
  return (
    <AdminPage
      title="Limits & budgets"
      description="Protect your wallet and your server: spending caps for paid APIs, project limits and worker concurrency."
      actions={
        <Button asChild variant="outline" size="sm">
          <Link href="/settings/usage?scope=instance">Detailed usage</Link>
        </Button>
      }
    >
      <LimitsForm
        initial={{ values: settings.values as LimitsSettings, secrets: settings.secrets }}
        spend={{ today: budget.daily.spent, month: budget.monthly.spent }}
        providers={month.byProvider.map((p) => ({ key: p.key, cost: p.cost, events: p.events }))}
        features={month.byFeature.map((f) => ({ key: f.key, cost: f.cost, events: f.events }))}
      />
    </AdminPage>
  );
}
