import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getBranding } from "@/server/branding";
import { env } from "@/server/env";
import { getPublicFreeToolsConfig } from "@/server/free-tools/public-config";
import { FREE_TOOL_LIST } from "@/features/free-tools/lib/registry";
import { ToolCard } from "@/features/free-tools/components/tool-card";
import { breadcrumbJsonLd, JsonLd } from "@/features/free-tools/components/tool-frame";

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBranding();
  const description = `Find competitor keywords, generate keyword ideas, and check backlinks, traffic, spam score, and domain age with ${brand.appName}'s free SEO tools. No signup.`;
  return {
    title: "Free SEO Tools",
    description,
    alternates: { canonical: `${env.appUrl}/free-tools` },
    robots: { index: true, follow: true },
    openGraph: { type: "website", title: `Free SEO Tools · ${brand.appName}`, description, url: `${env.appUrl}/free-tools` },
  };
}

export default async function FreeToolsHubPage() {
  await connection();
  const [config, brand] = await Promise.all([getPublicFreeToolsConfig(), getBranding()]);
  if (!config.enabled) notFound();
  return (
    <article className="mx-auto w-full max-w-5xl px-4 pt-8 pb-16 sm:px-6 sm:pt-12">
      <header className="max-w-3xl">
        <p className="text-sm font-medium text-brand">Free tools</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance sm:text-5xl">Free SEO Tools</h1>
        <p className="mt-4 text-base leading-7 text-pretty text-muted-foreground sm:text-lg sm:leading-8">
          Check backlinks, rankings, traffic, and domain details, or preview a search result. Use these tools without an account.
        </p>
      </header>

      <div className="mt-10 grid gap-3 sm:grid-cols-2">
        {FREE_TOOL_LIST.map((tool) => (
          <ToolCard key={tool.slug} tool={tool} href={`/free-tools/${tool.slug}`} surface="public" />
        ))}
      </div>

      <section className="mt-14 rounded-2xl border bg-gradient-to-br from-brand-soft/70 via-card to-card p-6 shadow-soft sm:p-8">
        <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">Why these are free</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          These tools give you a useful first look at a website without an account. Data lookups have usage limits to keep them free. For more research,{" "}
          {brand.appName} brings keyword research, rank tracking, backlinks, site audits and AI visibility tracking into one workspace.
        </p>
        <Button asChild size="lg" className="mt-5 h-10 px-5">
          <Link href={config.cta.href}>
            {config.cta.label}
            <ArrowRight />
          </Link>
        </Button>
      </section>

      <JsonLd
        data={breadcrumbJsonLd(env.appUrl, [
          { name: "Home", path: "/" },
          { name: "Free tools", path: "/free-tools" },
        ])}
      />
    </article>
  );
}
