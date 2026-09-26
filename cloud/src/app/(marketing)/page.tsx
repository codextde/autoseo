import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { comparison, homeFaq } from "@/components/marketing/content";
import { ComparisonTable } from "@/components/marketing/comparison-table";
import { FaqList } from "@/components/marketing/faq";
import { FinalCta } from "@/components/marketing/final-cta";
import { CloudSteps } from "@/components/marketing/home/cloud-steps";
import { EngineStrip } from "@/components/marketing/home/engines";
import {
  Actions,
  Developers,
  FeatureRows,
  Overview,
  Security,
  SeoSuite,
} from "@/components/marketing/home/features";
import { Hero } from "@/components/marketing/home/hero";
import { OpenSource } from "@/components/marketing/home/open-source";
import { Problem } from "@/components/marketing/home/problem";
import { JsonLd } from "@/components/marketing/json-ld";
import { pageMetadata } from "@/components/marketing/metadata";
import { PricingPlans } from "@/components/marketing/pricing-plans";
import { accentText, Container, SectionHeading } from "@/components/marketing/primitives";
import {
  faqPage,
  graph,
  organization,
  softwareApplication,
  sourceCode,
  website,
} from "@/components/marketing/structured-data";
import { site } from "@/lib/site";

export const metadata = pageMetadata({
  title: "AutoSEO — Open-Source AI SEO & GEO Platform",
  description:
    "Track how ChatGPT, Perplexity, Gemini, Claude and Google AI Overviews mention your brand. Open-source GEO & SEO platform: self-host free or $50/month managed.",
  path: "/",
  absolute: true,
});

export default function HomePage() {
  return (
    <>
      <JsonLd
        data={graph(organization(), website(), softwareApplication(), sourceCode(), faqPage(homeFaq, "/"))}
      />
      <Hero />
      <EngineStrip />
      <Problem />
      <Overview />

      <section aria-label="Feature details" className="pb-20 sm:pb-28">
        <Container className="space-y-24 sm:space-y-32">
          <FeatureRows from={0} to={3} />
          <SeoSuite flip />
          <FeatureRows from={3} to={4} offset={1} />
        </Container>
      </section>

      <Actions />

      <section aria-label="More features" className="pb-20 sm:pb-28">
        <Container className="space-y-24 sm:space-y-32">
          <FeatureRows from={4} offset={1} />
        </Container>
      </section>

      <Developers />

      <section aria-label="Administration and security" className="py-20 sm:py-28">
        <Container>
          <Security />
        </Container>
      </section>

      <CloudSteps />
      <OpenSource />

      <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-20 pb-20 sm:pb-28">
        <Container>
          <SectionHeading
            id="pricing-title"
            eyebrow="Pricing"
            title="Simple pricing. No per-seat fees."
            subtitle="Every feature in both plans. Pay for hosting and support — never for features."
          />
          <div className="mt-12">
            <PricingPlans />
          </div>
          <p className="mt-6 text-center">
            <Link
              href="/pricing"
              className={`inline-flex items-center gap-1.5 rounded-sm text-sm font-medium ${accentText} hover:underline focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none`}
            >
              Pricing details and billing FAQ
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </p>
        </Container>
      </section>

      <section aria-labelledby="compare-title" className="border-t bg-card/60 py-20 sm:py-28">
        <Container>
          <SectionHeading
            id="compare-title"
            eyebrow={comparison.eyebrow}
            title={comparison.title}
            subtitle={comparison.subtitle}
          />
          <div className="mx-auto mt-12 max-w-4xl">
            <ComparisonTable />
          </div>
        </Container>
      </section>

      <section id="faq" aria-labelledby="faq-title" className="scroll-mt-20 py-20 sm:py-28">
        <Container className="grid gap-10 lg:grid-cols-12 lg:gap-14">
          <div className="lg:col-span-4">
            <SectionHeading id="faq-title" eyebrow="FAQ" title="Questions, answered" align="left" />
            <p className="mt-4 text-muted-foreground">
              Something else on your mind?{" "}
              <a
                href={`mailto:${site.legal.email}`}
                className="font-medium text-foreground underline underline-offset-4 hover:no-underline"
              >
                Email us
              </a>{" "}
              or open a discussion on{" "}
              <a
                href={site.github}
                target="_blank"
                rel="noopener"
                className="font-medium text-foreground underline underline-offset-4 hover:no-underline"
              >
                GitHub
              </a>
              .
            </p>
          </div>
          <div className="lg:col-span-8">
            <FaqList items={homeFaq} />
          </div>
        </Container>
      </section>

      <FinalCta />
    </>
  );
}
