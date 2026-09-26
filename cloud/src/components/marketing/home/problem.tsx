import { ArrowRight } from "lucide-react";
import { problem } from "../content";
import { Container, SectionHeading } from "../primitives";

export function Problem() {
  return (
    <section aria-labelledby="problem-title" className="py-20 sm:py-28">
      <Container>
        <SectionHeading
          id="problem-title"
          eyebrow={problem.eyebrow}
          title={problem.title}
          subtitle={problem.subtitle}
          align="left"
        />
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {problem.points.map((point, i) => (
            <div key={point.title} className="rounded-2xl border bg-card p-6 sm:p-7">
              <span className="font-mono text-sm text-muted-foreground">0{i + 1}</span>
              <h3 className="mt-4 text-lg font-semibold tracking-tight">{point.title}</h3>
              <p className="mt-2 text-[0.95rem] leading-7 text-muted-foreground">{point.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-2xl border bg-foreground p-6 text-background sm:p-8">
          <h3 className="text-sm font-semibold tracking-wide uppercase opacity-80">{problem.loopTitle}</h3>
          <ol className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4 lg:gap-0">
            {problem.loop.map((step, i) => (
              <li key={step.title} className="flex items-start gap-3 lg:pr-6">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-green-500 text-sm font-semibold text-[#0b2a16]">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-semibold">
                    {step.title}
                    {i < problem.loop.length - 1 && (
                      <ArrowRight className="hidden size-4 opacity-60 lg:ml-auto lg:block" aria-hidden="true" />
                    )}
                  </p>
                  <p className="mt-0.5 text-sm opacity-80">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </Container>
    </section>
  );
}
