import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageContainer, PageHeader, TabNav } from "@/components/app/page";
import { requireProject } from "@/server/auth/guards";
import { getBranding } from "@/server/branding";
import { isDataForSeoConfigured } from "@/server/dataforseo/client";
import { seoContextFromProject } from "@/server/seo";
import { FREE_TOOL_LIST, FREE_TOOLS, getFreeTool, withApp } from "@/features/free-tools/lib/registry";
import { toolCountryForIso } from "@/features/free-tools/lib/countries";
import { AppToolRunnerProvider } from "@/features/free-tools/components/runner";
import { ToolView } from "@/features/free-tools/components/tool-view";
import { ToolCard } from "@/features/free-tools/components/tool-card";

export async function generateMetadata({ params }: PageProps<"/p/[projectId]/seo/tools/[tool]">): Promise<Metadata> {
  const { tool } = await params;
  return { title: getFreeTool(tool)?.name ?? "SEO Tools" };
}

export default async function SeoToolPage({ params, searchParams }: PageProps<"/p/[projectId]/seo/tools/[tool]">) {
  const { projectId, tool: slug } = await params;
  const tool = getFreeTool(slug);
  if (!tool) notFound();
  const pctx = await requireProject(projectId);
  const seo = seoContextFromProject(pctx);
  const [configured, branding, sp] = await Promise.all([isDataForSeoConfigured(), getBranding(), searchParams]);
  const initial = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const base = `/p/${projectId}/seo/tools`;

  return (
    <PageContainer>
      <TabNav
        active={tool.slug}
        tabs={[
          { key: "hub", label: "All tools", href: base },
          ...FREE_TOOL_LIST.map((t) => ({ key: t.slug, label: t.name, href: `${base}/${t.slug}` })),
        ]}
      />
      <PageHeader
        eyebrow={<Link href={base}>SEO Tools</Link>}
        title={tool.name}
        description={withApp(tool.subhead, branding.appName)}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={`/p/${projectId}${tool.feature.href}`}>
              {tool.feature.label}
              <ArrowRight />
            </Link>
          </Button>
        }
      />
      <AppToolRunnerProvider
        projectId={projectId}
        projectDomain={pctx.project.domain}
        defaultLocationCode={toolCountryForIso(pctx.project.country)}
        canRunPaid={seo.canRun}
        configured={configured}
        isAdmin={pctx.isInstanceAdmin}
        appName={branding.appName}
      >
        <ToolView slug={tool.slug} initial={initial} />
      </AppToolRunnerProvider>
      <section className="space-y-3 pt-4">
        <h2 className="text-sm font-semibold text-muted-foreground">Related tools</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tool.related.map((r) => (
            <ToolCard key={r} tool={FREE_TOOLS[r]} href={`${base}/${r}`} surface="app" compact />
          ))}
        </div>
      </section>
    </PageContainer>
  );
}
