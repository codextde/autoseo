import { requireAdmin } from "@/server/auth/guards";
import { auditFacets, auditFiltersFromParams, listAuditLogs } from "@/server/admin/audit-log";
import { getAdminSettings } from "@/server/admin/settings";
import { AdminPage } from "@/features/admin/components/settings-kit";
import { AuditLogView, AuditRetentionPanel } from "@/features/admin/components/audit-log-view";

export const metadata = { title: "Audit log · Admin" };

export default async function AdminAuditLogPage({ searchParams }: PageProps<"/admin/audit-log">) {
  await requireAdmin();
  const sp = await searchParams;
  const get = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);
  const filters = auditFiltersFromParams(get);
  const [data, facets, security] = await Promise.all([listAuditLogs(filters), auditFacets(), getAdminSettings("security")]);
  return (
    <AdminPage
      title="Audit log"
      description="Every sign-in, settings change, invitation, role change and project change — with actor, IP and before/after values. Secret values are never logged."
    >
      <AuditLogView
        items={data.items}
        total={data.total}
        page={data.page}
        pageSize={data.pageSize}
        facets={facets}
        filters={{
          period: filters.period,
          cat: get("cat") ?? "",
          actor: get("actor") ?? "",
          target: get("target") ?? "",
          q: get("q") ?? "",
          from: get("from") ?? "",
          to: get("to") ?? "",
        }}
      />
      <AuditRetentionPanel initial={security} totalEvents={facets.total} />
    </AdminPage>
  );
}
