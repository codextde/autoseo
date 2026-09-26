import { AtSign, Globe, Rocket, type LucideIcon } from "lucide-react";
import { site } from "@/lib/site";
import { steps } from "../content";
import { CtaLink, Container, SectionHeading } from "../primitives";

const stepIcons: LucideIcon[] = [AtSign, Globe, Rocket];

export function CloudSteps() {
  return (
    <section id="cloud" aria-labelledby="cloud-title" className="scroll-mt-20 border-y bg-card/60 py-20 sm:py-28">
      <Container>
        <SectionHeading id="cloud-title" eyebrow={steps.eyebrow} title={steps.title} subtitle={steps.subtitle} />
        <ol className="relative mt-14 grid gap-4 md:grid-cols-3">
          {steps.items.map((step, i) => {
            const Icon = stepIcons[i];
            return (
              <li key={step.title} className="relative flex flex-col rounded-2xl border bg-background p-6 sm:p-7">
                <div className="flex items-center justify-between">
                  <span className="grid size-10 place-items-center rounded-xl bg-foreground text-background">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <span className="font-mono text-sm text-muted-foreground">Step {i + 1}</span>
                </div>
                <h3 className="mt-6 text-lg font-semibold tracking-tight break-words">{step.title}</h3>
                <p className="mt-2 text-[0.95rem] leading-7 text-muted-foreground">{step.body}</p>
                {i === 1 && <SubdomainMock />}
                {i === 2 && <ReadyMock />}
                {i === 0 && <EmailMock />}
              </li>
            );
          })}
        </ol>
        <div className="mt-10 flex justify-center">
          <CtaLink href={steps.cta.href} size="lg" arrow>
            {steps.cta.label}
          </CtaLink>
        </div>
      </Container>
    </section>
  );
}

function EmailMock() {
  return (
    <div aria-hidden="true" className="mt-6 rounded-xl border bg-card p-3 text-sm">
      <div className="rounded-lg border bg-background px-3 py-2 text-muted-foreground">you@company.com</div>
      <div className="mt-2 rounded-lg bg-primary px-3 py-2 text-center font-medium text-primary-foreground">
        Send magic link
      </div>
    </div>
  );
}

function SubdomainMock() {
  return (
    <div aria-hidden="true" className="mt-6 flex items-center overflow-hidden rounded-xl border bg-card text-sm">
      <span className="px-3 py-2.5 font-medium">acme</span>
      <span className="truncate border-l bg-muted px-3 py-2.5 text-muted-foreground">.{site.host}</span>
    </div>
  );
}

function ReadyMock() {
  return (
    <div aria-hidden="true" className="mt-6 flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-sm">
      <span className="relative flex size-2.5">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-500 opacity-60 motion-reduce:animate-none" />
        <span className="relative inline-flex size-2.5 rounded-full bg-green-500" />
      </span>
      <span className="font-medium">Instance running</span>
      <span className="ml-auto rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">Open</span>
    </div>
  );
}
