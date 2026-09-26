import { Check } from "lucide-react";
import { comparison, overview, price, pricingFaq } from "@/components/marketing/content";
import { ComparisonTable } from "@/components/marketing/comparison-table";
import { FaqList } from "@/components/marketing/faq";
import { FinalCta } from "@/components/marketing/final-cta";
import { JsonLd } from "@/components/marketing/json-ld";
import { pageMetadata } from "@/components/marketing/metadata";
import { PageHero } from "@/components/marketing/page-hero";
import { PricingPlans } from "@/components/marketing/pricing-plans";
import { Container, SectionHeading } from "@/components/marketing/primitives";
import { breadcrumbs, faqPage, graph, softwareApplication } from "@/components/marketing/structured-data";

export const metadata = pageMetadata({
  title: "Pricing: Free Self-Hosted or $50/Month Cloud",
  description:
    "AutoSEO pricing: self-host the open-source AI SEO & GEO platform for free, or get a private, fully managed cloud instance for $50/month. Every feature included.",
  path: "/pricing",
  ownImage: true,
});

export default function PricingPage() {
  return (
    <>
      <JsonLd
        data={graph(
          softwareApplication(),
          faqPage(pricingFaq, "/pricing"),
          breadcrumbs([{ name: "Pricing", path: "/pricing" }]),
        )}
      />
      <PageHero
        crumb="Pricing"
        eyebrow="Pricing"
        title="Simple, honest pricing"
        subtitle={`Every feature in both plans. Self-host the open-source edition for free, or let us run a private instance for you for ${price} per month.`}
      />

      <section aria-label="Plans" className="py-16 sm:py-20">
        <Container>
          <PricingPlans headingLevel="h2" />
        </Container>
      </section>

      <section aria-labelledby="included-title" className="border-y bg-card/60 py-20 sm:py-24">
        <Container>
          <SectionHeading
            id="included-title"
            eyebrow="Included in both plans"
            title="The complete platform, no feature gates"
            subtitle="Self-hosted and Cloud run the exact same open-source application."
          />
          <ul className="mx-auto mt-12 grid max-w-5xl gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
            {overview.items.map((item) => (
              <li key={item.title}>
                <h3 className="flex items-center gap-2 font-semibold">
                  <Check className="size-4 text-green-700 dark:text-green-400" strokeWidth={2.5} aria-hidden="true" />
                  {item.title}
                </h3>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{item.body}</p>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      <section aria-labelledby="compare-title" className="py-20 sm:py-24">
        <Container>
          <SectionHeading id="compare-title" eyebrow={comparison.eyebrow} title={comparison.title} subtitle={comparison.subtitle} />
          <div className="mx-auto mt-12 max-w-4xl">
            <ComparisonTable />
          </div>
        </Container>
      </section>

      <section id="faq" aria-labelledby="faq-title" className="scroll-mt-20 border-t py-20 sm:py-24">
        <Container className="max-w-3xl">
          <SectionHeading id="faq-title" eyebrow="Billing FAQ" title="Questions about billing" />
          <div className="mt-10">
            <FaqList items={pricingFaq} />
          </div>
        </Container>
      </section>

      <FinalCta />
    </>
  );
}
