import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FREE_TOOLS, withApp, type FreeTool } from "../lib/registry";
import { ToolCard } from "./tool-card";

/** Serializes JSON-LD safely for a <script> tag (no `</script>` breakout). */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}

export function breadcrumbJsonLd(baseUrl: string, items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({ "@type": "ListItem", position: i + 1, name: item.name, item: `${baseUrl}${item.path}` })),
  };
}

/**
 * Shared shape of a public free-tool page (open-seo `ToolFrame`): hero, the tool itself, what you get, FAQ, closing
 * CTA, sibling tools, and the JSON-LD blocks (SoftwareApplication, FAQPage, BreadcrumbList).
 */
export function ToolFrame({
  tool,
  appName,
  baseUrl,
  cta,
  children,
}: {
  tool: FreeTool;
  appName: string;
  baseUrl: string;
  cta: { href: string; label: string };
  children: React.ReactNode;
}) {
  const faqs = tool.faqs.map((f) => ({ question: withApp(f.question, appName), answer: withApp(f.answer, appName) }));
  const path = `/free-tools/${tool.slug}`;
  return (
    <article className="mx-auto w-full max-w-5xl px-4 pt-8 pb-16 sm:px-6 sm:pt-12">
      <header className="max-w-3xl">
        <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Link href="/free-tools" className="hover:text-foreground">
            Free SEO tools
          </Link>
          <span aria-hidden>/</span>
          <span className="text-foreground">{tool.name}</span>
        </nav>
        <p className="text-sm font-medium text-brand">Free tool</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance sm:text-5xl">{tool.heading}</h1>
        <p className="mt-4 text-base leading-7 text-pretty text-muted-foreground sm:text-lg sm:leading-8">{withApp(tool.subhead, appName)}</p>
      </header>

      <div className="mt-8">{children}</div>

      <section className="mt-14">
        <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">What you get</h2>
        <ol className="mt-5 grid gap-3 md:grid-cols-3">
          {tool.highlights.map((item, i) => (
            <li key={item.title} className="rounded-2xl border bg-card p-5 shadow-soft">
              <span className="font-mono text-sm text-brand tabular">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="mt-3 text-base font-semibold">{item.title}</h3>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{withApp(item.description, appName)}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-14">
        <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">FAQ</h2>
        <div className="mt-5 divide-y rounded-2xl border bg-card shadow-soft">
          {faqs.map((faq) => (
            <details key={faq.question} className="group p-5 [&_summary::-webkit-details-marker]:hidden" open>
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-sm font-semibold">
                {faq.question}
                <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="mt-14 overflow-hidden rounded-2xl border bg-gradient-to-br from-brand-soft/70 via-card to-card p-6 shadow-soft sm:p-8">
        <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{tool.cta.heading}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{withApp(tool.cta.body, appName)}</p>
        <Button asChild size="lg" className="mt-5 h-10 px-5">
          <Link href={cta.href}>
            {cta.label}
            <ArrowRight />
          </Link>
        </Button>
      </section>

      <section className="mt-14">
        <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">More free tools</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          {tool.related.map((slug) => (
            <ToolCard key={slug} tool={FREE_TOOLS[slug]} href={`/free-tools/${slug}`} surface="public" compact />
          ))}
        </div>
        <Link href="/free-tools" className="mt-4 inline-flex items-center gap-1 text-sm font-medium underline decoration-brand underline-offset-4">
          All free SEO tools <ArrowRight className="size-3.5" />
        </Link>
      </section>

      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: `${appName} ${tool.name}`,
          applicationCategory: "SEO",
          operatingSystem: "Web",
          url: `${baseUrl}${path}`,
          description: tool.shortDescription,
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
          provider: { "@type": "Organization", name: appName, url: baseUrl },
        }}
      />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })),
        }}
      />
      <JsonLd
        data={breadcrumbJsonLd(baseUrl, [
          { name: "Home", path: "/" },
          { name: "Free tools", path: "/free-tools" },
          { name: tool.name, path },
        ])}
      />
    </article>
  );
}
