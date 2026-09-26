import { requireAdmin } from "@/server/auth/guards";
import { JOB_STATUSES, listJobs, type JobStatus } from "@/server/admin/jobs";
import { AdminPage } from "@/features/admin/components/settings-kit";
import { JobsMonitor, type JobsData } from "@/features/admin/components/jobs-monitor";

export const metadata = { title: "Jobs · Admin" };

function str(v: string | string[] | undefined) {
  return typeof v === "string" ? v : undefined;
}

export default async function AdminJobsPage({ searchParams }: PageProps<"/admin/jobs">) {
  await requireAdmin();
  const sp = await searchParams;
  const statusParam = str(sp.status);
  const status = (JOB_STATUSES as readonly string[]).includes(statusParam ?? "") ? (statusParam as JobStatus) : "all";
  const data = await listJobs({
    status,
    type: str(sp.type)?.slice(0, 120) || null,
    q: str(sp.q)?.slice(0, 200) || null,
    page: Math.max(0, Math.min(100_000, Number(str(sp.page)) || 0)),
  });
  return (
    <AdminPage
      title="Jobs"
      description="Background work queue — tracking runs, audits, reports and maintenance. Failed jobs retry automatically with backoff; retry or cancel them manually here."
    >
      <JobsMonitor initial={data as JobsData} />
    </AdminPage>
  );
}
