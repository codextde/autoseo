import Link from "next/link";
import { ArrowRight, CheckCircle2, Circle, CreditCard, FolderKanban, GitCommitHorizontal, ListChecks, Users, Wallet } from "lucide-react";
import { requireAdmin } from "@/server/auth/guards";
import { env } from "@/server/env";
import { getOverviewStats, getSetupChecklist } from "@/server/admin/overview";
import { Panel } from "@/components/app/page";
import { StatCard, Meter } from "@/components/app/metrics";
import { TrendChart } from "@/components/app/charts";
import { TimeAgo } from "@/components/app/misc";
import { Button } from "@/components/ui/button";
import { AdminPage } from "@/features/admin/components/settings-kit";
import { HealthGrid } from "@/features/admin/components/health-grid";
import { auditActionLabel } from "@/features/admin/audit-labels";

export const metadata = { title: "Admin" };

function usd(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function AdminOverviewPage() {
  const ctx = await requireAdmin();
  const [stats, checklist] = await Promise.all([getOverviewStats(), getSetupChecklist()]);
  const open = checklist.filter((c) => !c.done);
  const firstName = (ctx.user.name || ctx.user.email).split(/[\s@]/)[0];

  return (
    <AdminPage
      title={`Welcome back, ${firstName}`}
      description="Instance overview — people, projects, background work and spend at a glance."
      actions={
        <>
          {env.bootstrap.cloudUrl && (
            <Button asChild variant="ghost" size="sm" className="gap-1.5">
              <a href={`${env.bootstrap.cloudUrl}/dashboard`}>
                <CreditCard className="size-3.5" /> Manage subscription
              </a>
            </Button>
          )}
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link href="/admin/invitations">
              <Users className="size-3.5" /> Invite people
            </Link>
          </Button>
        </>
      }
    >
      {open.length > 0 && (
        <Panel
          title="Finish setting up your instance"
          description={`${checklist.length - open.length} of ${checklist.length} steps done`}
          actions={<Meter value={checklist.length - open.length} max={checklist.length} className="w-32" />}
          contentClassName="p-2 sm:p-2"
        >
          <ul className="grid gap-1 sm:grid-cols-2">
            {checklist.map((item) => (
              <li key={item.key}>
                <Link
                  href={item.href}
                  className="group flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-muted/50"
                >
                  {item.done ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                  ) : (
                    <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className={item.done ? "text-sm text-muted-foreground line-through" : "text-sm font-medium"}>{item.label}</span>
                    <span className="block text-xs text-muted-foreground">{item.description}</span>
                  </span>
                  {!item.done && <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />}
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard
          label="Users"
          icon={<Users className="size-3.5" />}
          value={stats.users.total}
          footer={`${stats.users.active30} active in 30 days · ${stats.users.pendingInvites} invited`}
        />
        <StatCard
          label="Projects"
          icon={<FolderKanban className="size-3.5" />}
          value={stats.projects.active}
          footer={`${stats.projects.workspaces} workspace${stats.projects.workspaces === 1 ? "" : "s"} · ${stats.projects.pitch} pitch · ${stats.projects.archived} archived`}
        />
        <StatCard
          label="Jobs"
          icon={<ListChecks className="size-3.5" />}
          value={stats.jobs.running + stats.jobs.queued}
          footer={`${stats.jobs.running} running · ${stats.jobs.succeeded24} done / ${stats.jobs.failed24} failed (24h)`}
        />
        <StatCard
          label="Spend this month"
          icon={<Wallet className="size-3.5" />}
          value={usd(stats.usage.spentMonth)}
          footer={
            stats.usage.monthlyBudget > 0 ? (
              <span className="block space-y-1">
                <Meter
                  value={stats.usage.spentMonth}
                  max={stats.usage.monthlyBudget}
                  tone={stats.usage.spentMonth > stats.usage.monthlyBudget * 0.9 ? "destructive" : "brand"}
                />
                <span>
                  of {usd(stats.usage.monthlyBudget)} budget · today {usd(stats.usage.spentToday)}
                </span>
              </span>
            ) : (
              `Today ${usd(stats.usage.spentToday)} · ${stats.usage.events24} events (24h)`
            )
          }
        />
      </div>

      <HealthGrid />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel title="Activity" description="Spend (USD) and sign-ins over the last 14 days">
          <TrendChart
            data={stats.activity}
            series={[
              { key: "cost", label: "Spend (USD)" },
              { key: "logins", label: "Sign-ins", yAxis: "right", color: "var(--chart-3)" },
            ]}
            format="decimal"
            rightFormat="number"
            height={240}
            legend
          />
        </Panel>
        <Panel
          title="Recent activity"
          actions={
            <Button asChild variant="ghost" size="sm" className="h-7">
              <Link href="/admin/audit-log">
                View all <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          }
          contentClassName="p-0 sm:p-0"
        >
          {stats.recentAudit.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">No events recorded yet.</p>
          ) : (
            <ul className="divide-y">
              {stats.recentAudit.map((e) => (
                <li key={e.id} className="flex items-start gap-3 px-4 py-2.5 sm:px-5">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{auditActionLabel(e.action)}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {e.actorEmail ?? "System"}
                      {e.targetType ? ` · ${e.targetType}` : ""}
                    </span>
                  </span>
                  <TimeAgo date={e.createdAt} className="shrink-0 text-xs text-muted-foreground" />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <GitCommitHorizontal className="size-3.5" /> Build {stats.version.commit}
        </span>
        {stats.version.buildDate && !stats.version.buildDate.startsWith("1970") && (
          <span>Built {new Date(stats.version.buildDate).toLocaleDateString("en-US", { dateStyle: "medium" })}</span>
        )}
        <span className="truncate">{stats.version.appUrl}</span>
        <Link href="/admin/system" className="underline-offset-4 hover:text-foreground hover:underline">
          System details
        </Link>
      </div>
    </AdminPage>
  );
}
