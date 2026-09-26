import { PageContainer } from "@/components/app/page";
import { requireProject } from "@/server/auth/guards";
import { getDashboard } from "@/server/ai/insights/dashboard";
import { getSeoCards } from "@/server/ai/insights/seo-dashboard";
import { parseInsightFilter } from "@/server/ai/insights/filters";
import { DashboardView } from "@/features/ai-insights/components/home/dashboard";

export default async function ProjectHome({ params, searchParams }: PageProps<"/p/[projectId]">) {
  const { projectId } = await params;
  const ctx = await requireProject(projectId);
  const sp = await searchParams;
  // The home dashboard only exposes the period (engines/tags are refined on the insight pages).
  const f = parseInsightFilter(projectId, { period: sp.period });
  // AI section + SEO cards load in parallel (each card reads stored data only).
  const [data, seo] = await Promise.all([getDashboard(ctx, f), getSeoCards(ctx, f.preset)]);
  const p = ctx.project;
  return (
    <PageContainer>
      <DashboardView
        project={{ id: p.id, name: p.name, domain: p.domain, country: p.country, engines: p.engines ?? [] }}
        userName={ctx.user.name}
        data={data}
        seo={seo}
        canManageProjects={ctx.permissions.has("projects.manage")}
      />
    </PageContainer>
  );
}
