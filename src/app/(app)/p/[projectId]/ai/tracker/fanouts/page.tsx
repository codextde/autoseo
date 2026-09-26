import type { Metadata } from "next";
import { PageContainer } from "@/components/app/page";
import { requireProject } from "@/server/auth/guards";
import { getFanouts } from "@/server/ai/metrics";
import { resolveRange } from "@/features/ai-tracking/period";
import { one, type SearchParams } from "@/features/ai-tracking/queries";
import { FanoutsView } from "@/features/ai-tracking/components/fanouts-view";

export const metadata: Metadata = { title: "Query Fanouts" };

export default async function FanoutsPage({ params, searchParams }: PageProps<"/p/[projectId]/ai/tracker/fanouts">) {
  const { projectId } = await params;
  const sp = (await searchParams) as SearchParams;
  await requireProject(projectId, "project.view");
  const period = resolveRange(one(sp, "period") || "90d", one(sp, "from"), one(sp, "to"));
  const q = one(sp, "q").slice(0, 200);
  const rows = await getFanouts(projectId, period, q);
  const exportParams = new URLSearchParams();
  for (const k of ["period", "from", "to", "q"]) if (one(sp, k)) exportParams.set(k, one(sp, k));
  const base = `/p/${projectId}/ai/tracker`;
  return (
    <PageContainer>
      <FanoutsView
        rows={rows}
        period={period.preset}
        from={period.preset === "custom" ? period.from : undefined}
        to={period.preset === "custom" ? period.to : undefined}
        backHref={base}
        trackerHref={base}
        exportHref={`${base}/fanouts/export${exportParams.size ? `?${exportParams}` : ""}`}
      />
    </PageContainer>
  );
}
