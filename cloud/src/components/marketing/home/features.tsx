import {
  Bot,
  ChartLine,
  FileText,
  Link2,
  ListChecks,
  Presentation,
  Search,
  ShieldCheck,
  Sparkles,
  Swords,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  actions,
  developers,
  featureRows,
  overview,
  security,
  seoSuite,
  hero,
  type FeatureRow as FeatureRowData,
} from "../content";
import { CodeBlock } from "../code-block";
import { BrowserFrame, PhoneFrame } from "../frames";
import { CheckList, Container, Eyebrow, SectionHeading } from "../primitives";

const icons: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  swords: Swords,
  link: Link2,
  search: Search,
  chart: ChartLine,
  wand: WandSparkles,
  presentation: Presentation,
  bot: Bot,
  list: ListChecks,
  file: FileText,
  shield: ShieldCheck,
};

function FeatureIcon({ name }: { name: string }) {
  const Icon = icons[name] ?? Sparkles;
  return (
    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-green-700 dark:text-green-300">
      <Icon className="size-5" aria-hidden="true" />
    </span>
  );
}

export function Overview() {
  return (
    <section id="features" aria-labelledby="features-title" className="scroll-mt-20 pt-8 pb-20 sm:pt-12 sm:pb-28">
      <Container>
        <SectionHeading id="features-title" eyebrow={overview.eyebrow} title={overview.title} subtitle={overview.subtitle} />
        <ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {overview.items.map((item) => (
            <li
              key={item.title}
              className="rounded-2xl border bg-card p-6 transition-shadow hover:shadow-[0_12px_32px_-16px_oklch(0_0_0/0.2)]"
            >
              <FeatureIcon name={item.icon} />
              <h3 className="mt-5 font-semibold tracking-tight">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.body}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}

function FeatureText({
  id,
  eyebrow,
  title,
  body,
  bullets,
}: {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  bullets: string[];
}) {
  return (
    <div>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h3 id={`${id}-title`} className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl lg:text-[2.1rem] lg:leading-[1.15]">
        {title}
      </h3>
      <p className="mt-4 text-[1.05rem] leading-7 text-pretty text-muted-foreground">{body}</p>
      <CheckList items={bullets} className="mt-7" />
    </div>
  );
}

function FeatureRow({ row, flip }: { row: FeatureRowData; flip: boolean }) {
  return (
    <article
      id={row.id}
      aria-labelledby={`${row.id}-title`}
      className="grid scroll-mt-24 items-center gap-10 lg:grid-cols-12 lg:gap-14"
    >
      <div className={cn("min-w-0 lg:col-span-5", flip && "lg:order-2")}>
        <FeatureText {...row} />
      </div>
      <div className={cn("relative min-w-0 lg:col-span-7", flip && "lg:order-1", row.secondary && "sm:pb-16")}>
        <BrowserFrame src={row.image.src} darkSrc={row.image.darkSrc} alt={row.image.alt} url={row.image.url} />
        {row.secondary && (
          <BrowserFrame
            src={row.secondary.src}
            darkSrc={row.secondary.darkSrc}
            alt={row.secondary.alt}
            url={row.secondary.url}
            sizes="(min-width: 1024px) 400px, 60vw"
            className={cn("absolute bottom-0 hidden w-[58%] sm:block", flip ? "-left-4 lg:-left-8" : "-right-4 lg:-right-8")}
          />
        )}
      </div>
    </article>
  );
}

/** Alternates text/image sides; `offset` keeps the rhythm when other blocks sit between rows. */
export function FeatureRows({ from, to, offset = 0 }: { from: number; to?: number; offset?: number }) {
  const rows = featureRows.slice(from, to);
  return (
    <div className="space-y-24 sm:space-y-32">
      {rows.map((row, i) => (
        <FeatureRow key={row.id} row={row} flip={(from + i + offset) % 2 === 1} />
      ))}
    </div>
  );
}

export function SeoSuite({ flip = false }: { flip?: boolean }) {
  const [main, ...rest] = seoSuite.images;
  return (
    <article id={seoSuite.id} aria-labelledby={`${seoSuite.id}-title`} className="scroll-mt-24">
      <div className="grid items-center gap-10 lg:grid-cols-12 lg:gap-14">
        <div className={cn("min-w-0 lg:col-span-5", flip && "lg:order-2")}>
          <FeatureText {...seoSuite} />
        </div>
        <div className={cn("grid min-w-0 gap-4 lg:col-span-7", flip && "lg:order-1")}>
          <BrowserFrame src={main.src} alt={main.alt} url={main.url} />
          <div className="grid gap-4 sm:grid-cols-2">
            {rest.map((img) => (
              <BrowserFrame
                key={img.src}
                src={img.src}
                alt={img.alt}
                url={img.url}
                sizes="(min-width: 1024px) 340px, (min-width: 640px) 50vw, 100vw"
              />
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}

export function Actions() {
  return (
    <section aria-labelledby="actions-title" className="pb-20 sm:pb-28">
      <Container>
        <SectionHeading id="actions-title" eyebrow={actions.eyebrow} title={actions.title} />
        <div className="mt-14 grid items-center gap-10 lg:grid-cols-12 lg:gap-14">
          <ul className="grid min-w-0 gap-x-6 gap-y-7 sm:grid-cols-2 lg:col-span-5 lg:grid-cols-1">
            {actions.items.map((item) => (
              <li key={item.title} className="flex gap-4">
                <FeatureIcon name={item.icon} />
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold tracking-tight">{item.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.body}</p>
                </div>
              </li>
            ))}
          </ul>
          <div className="relative min-w-0 sm:pb-16 lg:col-span-7">
            <BrowserFrame src={actions.image.src} alt={actions.image.alt} url={actions.image.url} />
            <BrowserFrame
              src={actions.secondary.src}
              alt={actions.secondary.alt}
              url={actions.secondary.url}
              sizes="(min-width: 1024px) 400px, 60vw"
              className="absolute -right-4 bottom-0 hidden w-[58%] sm:block lg:-right-8"
            />
          </div>
        </div>
      </Container>
    </section>
  );
}

export function Developers() {
  return (
    <section aria-labelledby="developers-title" className="py-4">
      <Container>
        <div className="mk-dark-panel relative overflow-hidden rounded-3xl p-6 text-white sm:p-10 lg:p-14">
          <div className="mk-dots-light absolute inset-0" aria-hidden="true" />
          <div className="relative grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
            <div>
              <p className="text-sm font-semibold tracking-wide text-green-400 uppercase">{developers.eyebrow}</p>
              <h2 id="developers-title" className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                {developers.title}
              </h2>
              <p className="mt-4 text-[1.05rem] leading-7 text-white/75">{developers.body}</p>
              <ul className="mt-7 grid gap-3 sm:grid-cols-2">
                {developers.bullets.map((b) => (
                  <li key={b} className="flex gap-2.5 text-sm leading-6 text-white/90">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-green-400" aria-hidden="true" />
                    {b}
                  </li>
                ))}
              </ul>
            </div>
            <div className="min-w-0 space-y-4">
              {developers.snippets.map((snippet) => (
                <CodeBlock key={snippet.title} title={snippet.title} code={snippet.code} prompt wrap />
              ))}
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}

export function Security() {
  return (
    <article id={security.id} aria-labelledby={`${security.id}-title`} className="scroll-mt-24">
      <div className="grid items-center gap-10 lg:grid-cols-12 lg:gap-14">
        <div className="min-w-0 lg:col-span-5 lg:order-2">
          <FeatureText {...security} />
          <p className="mt-6 text-sm text-muted-foreground">{security.mobileNote}</p>
        </div>
        <div className="relative min-w-0 lg:col-span-7 lg:order-1">
          <BrowserFrame src={security.image.src} alt={security.image.alt} url={security.image.url} />
          <PhoneFrame
            src="/screenshots/mobile.png"
            alt={hero.mobileAlt}
            className="absolute -right-3 -bottom-10 hidden w-32 sm:block lg:w-36"
          />
        </div>
      </div>
    </article>
  );
}
