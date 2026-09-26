import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireProject } from "@/server/auth/guards";
import { getReport, reportDeck } from "@/server/reports/service";
import { loadReportData } from "@/server/reports/data";
import { resolveDataProject } from "@/server/reports/access";
import { PrintPage } from "@/features/reports/components/standalone";

export const metadata: Metadata = { title: "Print report" };

export default async function PrintRoute({ params, searchParams }: PageProps<"/p/[projectId]/reports/[reportId]/print">) {
  const { projectId, reportId } = await params;
  const sp = await searchParams;
  await requireProject(projectId);
  const report = await getReport(projectId, reportId);
  if (!report) notFound();
  if (report.kind === "html") redirect(`/p/${projectId}/reports/${reportId}/raw?print=1`);
  const deck = reportDeck(report);
  if (!deck) notFound();
  const dataProject = await resolveDataProject(projectId, sp.client);
  const bundle = await loadReportData(dataProject, report.dateRange).catch(() => null);
  return (
    <PrintPage
      deck={deck}
      bundle={bundle}
      title={report.title}
      subtitle={report.subtitle}
      assetBase={`/p/${projectId}/reports/assets`}
      backHref={`/p/${projectId}/reports/${report.id}`}
      autoPrint={sp.auto === "1"}
    />
  );
}
