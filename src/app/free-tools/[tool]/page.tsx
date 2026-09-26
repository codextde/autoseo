import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBranding } from "@/server/branding";
import { env } from "@/server/env";
import { getPublicFreeToolsConfig } from "@/server/free-tools/public-config";
import { getFreeTool } from "@/features/free-tools/lib/registry";
import { PublicToolRunnerProvider } from "@/features/free-tools/components/runner";
import { ToolFrame } from "@/features/free-tools/components/tool-frame";
import { ToolView } from "@/features/free-tools/components/tool-view";

export async function generateMetadata({ params }: PageProps<"/free-tools/[tool]">): Promise<Metadata> {
  const { tool: slug } = await params;
  const tool = getFreeTool(slug);
  if (!tool) return {};
  const brand = await getBranding();
  const url = `${env.appUrl}/free-tools/${tool.slug}`;
  return {
    title: tool.seoTitle,
    description: tool.seoDescription,
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: { type: "website", title: `${tool.seoTitle} · ${brand.appName}`, description: tool.seoDescription, url },
  };
}

export default async function PublicFreeToolPage({ params, searchParams }: PageProps<"/free-tools/[tool]">) {
  const { tool: slug } = await params;
  const tool = getFreeTool(slug);
  if (!tool) notFound();
  const [config, brand, sp] = await Promise.all([getPublicFreeToolsConfig(), getBranding(), searchParams]);
  if (!config.enabled) notFound();
  const initial = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));

  return (
    <ToolFrame tool={tool} appName={brand.appName} baseUrl={env.appUrl} cta={config.cta}>
      <PublicToolRunnerProvider appName={brand.appName} turnstileSiteKey={config.turnstileSiteKey} cta={config.cta}>
        <ToolView slug={tool.slug} initial={initial} />
      </PublicToolRunnerProvider>
    </ToolFrame>
  );
}
