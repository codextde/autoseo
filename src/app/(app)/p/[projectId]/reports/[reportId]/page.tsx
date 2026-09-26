import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireProject } from "@/server/auth/guards";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { getReport, reportDeck } from "@/server/reports/service";
import { loadReportData } from "@/server/reports/data";
import { resolveDataProject } from "@/server/reports/access";
import { DeckViewer } from "@/features/reports/components/deck-viewer";
import { HtmlReportViewer } from "@/features/reports/components/html-report-viewer";

export async function generateMetadata({ params }: PageProps<"/p/[projectId]/reports/[reportId]">): Promise<Metadata> {
  const { projectId, reportId } = await params;
  const report = await getReport(projectId, reportId).catch(() => null);
  return { title: report?.title ?? "Report" };
}

export default async function ReportViewerPage({ params, searchParams }: PageProps<"/p/[projectId]/reports/[reportId]">) {
  const { projectId, reportId } = await params;
  const sp = await searchParams;
  const ctx = await requireProject(projectId);
  const report = await getReport(projectId, reportId);
  if (!report) notFound();
  const canManage = ctx.permissions.has("reports.manage");

  if (report.kind === "html") {
    const [creator] = report.createdBy ? await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, report.createdBy)).limit(1) : [];
    return (
      <HtmlReportViewer
        projectId={projectId}
        reportId={report.id}
        title={report.title}
        summary={report.summary}
        prompt={report.prompt}
        aiStatus={report.aiStatus}
        aiError={report.aiError}
        createdByLabel={report.createdByLabel}
        createdByName={creator?.name ?? creator?.email ?? null}
        updatedAt={report.updatedAt.toISOString()}
        status={report.status}
        canManage={canManage}
      />
    );
  }

  const deck = reportDeck(report);
  if (!deck) notFound();
  const dataProject = await resolveDataProject(projectId, sp.client);
  const bundle = await loadReportData(dataProject, report.dateRange).catch(() => null);
  return (
    <DeckViewer
      mode="app"
      deck={deck}
      bundle={bundle}
      title={report.title}
      subtitle={report.subtitle}
      assetBase={`/p/${projectId}/reports/assets`}
      projectId={projectId}
      reportId={report.id}
      status={report.status}
      canManage={canManage}
      printHref={`/p/${projectId}/reports/${report.id}/print?auto=1${dataProject !== projectId ? `&client=${dataProject}` : ""}`}
      backHref={`/p/${projectId}/reports`}
      presentOnOpen={sp.present === "1"}
    />
  );
}
