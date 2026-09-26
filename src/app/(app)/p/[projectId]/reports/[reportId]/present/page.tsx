import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireProject } from "@/server/auth/guards";
import { getReport, reportDeck } from "@/server/reports/service";
import { loadReportData } from "@/server/reports/data";
import { resolveDataProject } from "@/server/reports/access";
import { PresentPage } from "@/features/reports/components/standalone";

export const metadata: Metadata = { title: "Present" };

export default async function PresentRoute({ params, searchParams }: PageProps<"/p/[projectId]/reports/[reportId]/present">) {
  const { projectId, reportId } = await params;
  const sp = await searchParams;
  const ctx = await requireProject(projectId);
  const report = await getReport(projectId, reportId);
  if (!report) notFound();
  if (report.kind !== "deck") redirect(`/p/${projectId}/reports/${reportId}`);
  const deck = reportDeck(report);
  if (!deck) notFound();
  const dataProject = await resolveDataProject(projectId, sp.client);
  const bundle = await loadReportData(dataProject, report.dateRange).catch(() => null);
  const start = Math.max(0, (Number(Array.isArray(sp.slide) ? sp.slide[0] : sp.slide) || 1) - 1);
  const canManage = ctx.permissions.has("reports.manage");
  return (
    <PresentPage
      deck={deck}
      bundle={bundle}
      title={report.title}
      subtitle={report.subtitle}
      assetBase={`/p/${projectId}/reports/assets`}
      exitHref={canManage ? `/p/${projectId}/reports/${report.id}/edit` : `/p/${projectId}/reports/${report.id}`}
      startIndex={start}
    />
  );
}
