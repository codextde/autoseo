import { forbidden } from "next/navigation";
import { PageContainer, PageHeader } from "@/components/app/page";
import { requireUser } from "@/server/auth/guards";
import { reachableProjectIds, workspaceAccess } from "@/server/admin/access";
import { getBudgetStatus, getUsageSummary } from "@/server/admin/usage";
import { UsageDashboard } from "@/features/settings/usage/usage-dashboard";
import { WorkspaceSwitcher } from "@/features/settings/workspace/workspace-switcher";

export const metadata = { title: "Usage & costs" };

const PRESET_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function UsagePage({ searchParams }: PageProps<"/settings/usage">) {
  const ctx = await requireUser();
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);

  const viewable = ctx.memberships.filter((m) => ctx.isInstanceAdmin || m.permissions.has("usage.view"));
  if (!viewable.length && !ctx.isInstanceAdmin) forbidden();
  const membership = viewable.find((m) => m.workspace.id === str("ws")) ?? viewable[0] ?? null;
  const scope = ctx.isInstanceAdmin && (str("scope") === "instance" || !membership) ? "instance" : "workspace";

  // Period: preset (7d/30d/90d) or custom from/to (YYYY-MM-DD, UTC).
  let period = str("period") ?? "30d";
  let from: Date;
  let to = new Date();
  const f = str("from");
  const t = str("to");
  if (period === "custom" && f && DATE_RE.test(f)) {
    from = new Date(`${f}T00:00:00.000Z`);
    if (t && DATE_RE.test(t)) to = new Date(`${t}T23:59:59.999Z`);
    if (to.getTime() - from.getTime() > 400 * 86_400_000) from = new Date(to.getTime() - 400 * 86_400_000);
  } else {
    if (!PRESET_DAYS[period]) period = "30d";
    from = new Date(to.getTime() - (PRESET_DAYS[period]! - 1) * 86_400_000);
    from.setUTCHours(0, 0, 0, 0);
  }

  const [summary, budget] = await Promise.all([
    getUsageSummary(scope === "instance" || !membership ? { kind: "instance" } : { kind: "workspace", workspaceId: membership.workspace.id }, from, to),
    // Budgets and their spend are instance-wide — only admins see them.
    ctx.isInstanceAdmin ? getBudgetStatus() : Promise.resolve(null),
  ]);
  // Members restricted to some projects only see names of those; the rest is grouped.
  if (scope === "workspace" && membership) {
    const reach = await reachableProjectIds((await workspaceAccess(ctx, membership.workspace.id))!);
    if (reach) {
      const visible = summary.byProject.filter((r) => reach.has(r.key));
      const hidden = summary.byProject.filter((r) => !reach.has(r.key));
      summary.byProject = hidden.length
        ? [
            ...visible,
            {
              key: "__other",
              name: "Other projects",
              domain: null,
              cost: hidden.reduce((n, r) => n + r.cost, 0),
              events: hidden.reduce((n, r) => n + r.events, 0),
              units: hidden.reduce((n, r) => n + r.units, 0),
            },
          ]
        : visible;
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Usage & costs"
        description="Self-hosted cost tracking — what DataForSEO and AI providers cost you, by provider, feature and project. No subscription, you pay providers directly."
        actions={
          membership &&
          scope === "workspace" && (
            <WorkspaceSwitcher
              current={membership.workspace.id}
              workspaces={viewable.map((m) => ({ id: m.workspace.id, name: m.workspace.name, roleName: m.roleName }))}
            />
          )
        }
      />
      <UsageDashboard
        summary={summary}
        budget={budget}
        period={period}
        from={period === "custom" ? f : undefined}
        to={period === "custom" ? t : undefined}
        scope={scope}
        canSwitchScope={ctx.isInstanceAdmin && Boolean(membership)}
        isAdmin={ctx.isInstanceAdmin}
      />
    </PageContainer>
  );
}
