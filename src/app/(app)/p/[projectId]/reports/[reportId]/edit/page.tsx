import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireProject } from "@/server/auth/guards";
import { getReport, reportDeck } from "@/server/reports/service";
import { loadReportData } from "@/server/reports/data";
import { ReportEditor } from "@/features/reports/components/editor/editor";
import { canManageWorkspaceReports } from "@/server/reports/access";

export const metadata: Metadata = { title: "Edit report" };

export default async function EditReportPage({ params }: PageProps<"/p/[projectId]/reports/[reportId]/edit">) {
  const { projectId, reportId } = await params;
  const ctx = await requireProject(projectId);
  const report = await getReport(projectId, reportId);
  if (!report) notFound();
  if (report.kind !== "deck") redirect(`/p/${projectId}/reports/${reportId}`);
  const deck = reportDeck(report);
  if (!deck) notFound();
  const canManage = ctx.permissions.has("reports.manage");
  const bundle = await loadReportData(projectId, report.dateRange).catch(() => null);
  return (
    <ReportEditor
      projectId={projectId}
      reportId={report.id}
      deck={deck}
      version={report.version}
      title={report.title}
      subtitle={report.subtitle}
      range={report.dateRange}
      status={report.status}
      updatedAt={report.updatedAt.toISOString()}
      bundle={bundle}
      canManage={canManage}
      canManageWorkspace={canManageWorkspaceReports(ctx)}
    />
  );
}
