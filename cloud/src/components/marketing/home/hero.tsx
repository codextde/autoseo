import { Check, ChevronRight } from "lucide-react";
import { site } from "@/lib/site";
import { hero, installCommand } from "../content";
import { CommandPill } from "../code-block";
import { BrowserFrame, PhoneFrame } from "../frames";
import { accentText, CtaLink, Container, GitHubIcon } from "../primitives";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="mk-hero-glow pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="mk-grid pointer-events-none absolute inset-0" aria-hidden="true" />
      <Container className="relative pt-12 pb-16 sm:pt-20 sm:pb-24">
        <div className="mx-auto max-w-4xl text-center">
          <a
            href={site.github}
            target="_blank"
            rel="noopener"
            className="group inline-flex max-w-full items-center gap-2 rounded-full border bg-card/80 py-1 pr-2 pl-3 text-sm shadow-xs backdrop-blur transition-colors hover:bg-card focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none"
          >
            <span className="relative flex size-2" aria-hidden="true">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-500 opacity-60 motion-reduce:animate-none" />
              <span className="relative inline-flex size-2 rounded-full bg-green-500" />
            </span>
            <span className="truncate font-medium">{hero.eyebrow}</span>
            <span className="h-4 w-px bg-border" aria-hidden="true" />
            <span className="inline-flex items-center gap-1.5 text-muted-foreground group-hover:text-foreground">
              <GitHubIcon className="size-3.5" />
              <span className="hidden sm:inline">{hero.eyebrowCta}</span>
              <ChevronRight className="size-3.5" aria-hidden="true" />
            </span>
          </a>

          <h1 className="mt-7 text-[2.6rem] leading-[1.04] font-semibold tracking-[-0.035em] text-balance sm:text-6xl lg:text-7xl">
            {hero.titleLead} <span className={accentText}>{hero.titleAccent}</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-pretty text-muted-foreground sm:text-xl sm:leading-8">
            {hero.subtitle}
          </p>

          <div className="mt-9 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
            <CtaLink href={hero.primaryCta.href} size="lg" arrow>
              {hero.primaryCta.label}
            </CtaLink>
            <CtaLink href={hero.secondaryCta.href} variant="secondary" size="lg">
              {hero.secondaryCta.label}
            </CtaLink>
          </div>

          <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
            {hero.assurances.map((item) => (
              <li key={item} className="inline-flex items-center gap-1.5">
                <Check className="size-4 text-green-700 dark:text-green-400" strokeWidth={2.5} aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>

          <div className="mx-auto mt-10 flex max-w-xl flex-col items-center gap-2.5">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{hero.installLabel}</p>
            <CommandPill command={installCommand} className="w-full sm:w-auto" />
          </div>
        </div>

        <div className="relative mx-auto mt-16 max-w-5xl sm:mt-20">
          <div className="mk-screen-glow pointer-events-none absolute -inset-x-10 -top-10 bottom-0" aria-hidden="true" />
          <BrowserFrame
            src="/screenshots/dashboard.png"
            darkSrc="/screenshots/dashboard-dark.png"
            alt={hero.screenshotAlt}
            sizes="(min-width: 1024px) 1024px, calc(100vw - 2rem)"
            reveal={false}
            className="relative"
          />
          <AnswerCard />
          <PhoneFrame
            src="/screenshots/mobile.png"
            alt={hero.mobileAlt}
            className="absolute -right-6 -bottom-12 hidden w-44 lg:block xl:-right-14 xl:w-48"
          />
        </div>
      </Container>
    </section>
  );
}

/** Decorative "live answer" card floating over the screenshot; engine name cycles with pure CSS. */
function AnswerCard() {
  const { answerCard } = hero;
  const ticker = [...answerCard.engines, answerCard.engines[0]];
  return (
    <div
      aria-hidden="true"
      className="mk-float absolute -bottom-10 -left-8 hidden w-80 rounded-2xl border bg-card/95 p-4 text-left shadow-[0_24px_64px_-20px_oklch(0_0_0/0.35)] backdrop-blur lg:block xl:-left-16"
    >
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-muted-foreground">{answerCard.label}</span>
        <span className="inline-flex items-center gap-1.5 font-medium text-green-700 dark:text-green-400">
          <span className="size-1.5 rounded-full bg-green-500" />
          Live
        </span>
      </div>
      <p className="mt-2 text-sm leading-5 font-medium">&ldquo;{answerCard.prompt}&rdquo;</p>
      <div className="mt-3 flex items-center gap-2 rounded-lg bg-muted px-2.5 py-2 text-xs">
        <span className="text-muted-foreground">Answer from</span>
        <span className="h-5 overflow-hidden font-semibold">
          <span className="mk-ticker block">
            {ticker.map((engine, i) => (
              <span key={`${engine}-${i}`} className="block h-5 leading-5">
                {engine}
              </span>
            ))}
          </span>
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2">
        {answerCard.stats.map((stat) => (
          <div key={stat.label} className="rounded-lg border px-2.5 py-2">
            <dt className="text-[0.7rem] text-muted-foreground">{stat.label}</dt>
            <dd className="mt-0.5 text-sm font-semibold">{stat.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
