import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/marketing/footer";
import { SiteHeader } from "@/components/marketing/header";
import { CtaLink, Container } from "@/components/marketing/primitives";
import "@/components/marketing/marketing.css";

export const metadata: Metadata = {
  title: "Page not found",
  description: "The page you are looking for does not exist or has moved.",
  robots: { index: false },
};

const suggestions = [
  { label: "Features", href: "/#features", body: "AI visibility, SEO suite, reports and agent mode" },
  { label: "Pricing", href: "/pricing", body: "Free self-hosted or a managed instance" },
  { label: "Self-hosting guide", href: "/self-hosting", body: "Run AutoSEO on your own server" },
];

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="relative overflow-hidden">
        <div className="mk-hero-glow pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="mk-grid pointer-events-none absolute inset-0" aria-hidden="true" />
        <Container className="relative flex flex-col items-center py-24 text-center sm:py-32">
          <p className="font-mono text-sm font-medium text-green-700 dark:text-green-400">404</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
            This page isn&apos;t in any answer
          </h1>
          <p className="mt-5 max-w-lg text-lg text-pretty text-muted-foreground">
            Not in ChatGPT, not in Perplexity, not even in our sitemap. The page you&apos;re looking for doesn&apos;t
            exist or has moved.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <CtaLink href="/" size="lg" arrow>
              Back to the homepage
            </CtaLink>
            <CtaLink href="/pricing" variant="secondary" size="lg">
              See pricing
            </CtaLink>
          </div>
          <ul className="mt-16 grid w-full max-w-3xl gap-3 text-left sm:grid-cols-3">
            {suggestions.map((s) => (
              <li key={s.href}>
                <Link
                  href={s.href}
                  className="block h-full rounded-2xl border bg-card p-5 transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none"
                >
                  <span className="font-semibold">{s.label}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">{s.body}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}
