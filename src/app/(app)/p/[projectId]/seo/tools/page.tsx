import Link from "next/link";
import { Globe, PlugZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageContainer, PageHeader } from "@/components/app/page";
import { requireProject } from "@/server/auth/guards";
import { isDataForSeoConfigured } from "@/server/dataforseo/client";
import { getSetting } from "@/server/settings";
import { FREE_TOOL_LIST } from "@/features/free-tools/lib/registry";
import { ToolCard } from "@/features/free-tools/components/tool-card";

export const metadata = { title: "SEO Tools" };

export default async function SeoToolsHubPage({ params }: PageProps<"/p/[projectId]/seo/tools">) {
  const { projectId } = await params;
  const pctx = await requireProject(projectId);
  const [configured, freeTools] = await Promise.all([isDataForSeoConfigured(), getSetting("freeTools")]);
  const isAdmin = pctx.isInstanceAdmin;

  return (
    <PageContainer>
      <PageHeader
        eyebrow="SEO"
        title="SEO Tools"
        description="Quick one-off checks: backlinks, spam score, traffic, competitors, keyword ideas, domain age and a SERP snippet preview. Paid lookups use your DataForSEO account and are cached for 24 hours."
        actions={
          isAdmin ? (
            freeTools.publicEnabled ? (
              <Button asChild variant="outline" size="sm">
                <Link href="/free-tools" target="_blank">
                  <Globe />
                  Public page
                </Link>
              </Button>
            ) : (
              <Button asChild variant="ghost" size="sm">
                <Link href="/admin/free-tools">
                  <Globe />
                  Publish as free tools
                </Link>
              </Button>
            )
          ) : undefined
        }
      />
      {!configured && (
        <div className="flex flex-col gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-start gap-2">
            <PlugZap className="mt-0.5 size-4 shrink-0 text-warning" />
            <span>
              <span className="font-medium">DataForSEO isn&apos;t connected.</span>{" "}
              <span className="text-muted-foreground">The Domain Age Checker and SERP Simulator work without it; the other tools need it.</span>
            </span>
          </span>
          {isAdmin ? (
            <Button asChild size="sm" variant="outline" className="shrink-0">
              <Link href="/admin/data">Connect DataForSEO</Link>
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">Ask an admin: Admin → Data Providers</span>
          )}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {FREE_TOOL_LIST.map((tool) => (
          <ToolCard key={tool.slug} tool={tool} href={`/p/${projectId}/seo/tools/${tool.slug}`} surface="app" />
        ))}
      </div>
    </PageContainer>
  );
}
