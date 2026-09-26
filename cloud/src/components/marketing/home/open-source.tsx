import { Check } from "lucide-react";
import { installCommand, openSource } from "../content";
import { CtaLink, Container, GitHubIcon } from "../primitives";

export function OpenSource() {
  return (
    <section id="open-source" aria-labelledby="open-source-title" className="scroll-mt-20 py-20 sm:py-28">
      <Container>
        <div className="mk-dark-panel relative overflow-hidden rounded-3xl p-6 text-white sm:p-10 lg:p-14">
          <div className="mk-dots-light absolute inset-0" aria-hidden="true" />
          <div className="relative grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
            <div>
              <p className="text-sm font-semibold tracking-wide text-green-400 uppercase">{openSource.eyebrow}</p>
              <h2 id="open-source-title" className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-5xl">
                {openSource.title}
              </h2>
              <p className="mt-5 text-[1.05rem] leading-7 text-white/75">{openSource.body}</p>
              <ul className="mt-7 space-y-3">
                {openSource.bullets.map((b) => (
                  <li key={b} className="flex gap-3 text-[0.95rem] leading-6 text-white/90">
                    <Check className="mt-0.5 size-5 shrink-0 text-green-400" aria-hidden="true" />
                    {b}
                  </li>
                ))}
              </ul>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <CtaLink href={openSource.primaryCta.href} variant="inverted" size="lg">
                  <GitHubIcon />
                  {openSource.primaryCta.label}
                </CtaLink>
                <CtaLink href={openSource.secondaryCta.href} variant="inverted-outline" size="lg" arrow>
                  {openSource.secondaryCta.label}
                </CtaLink>
              </div>
            </div>
            <Terminal />
          </div>
        </div>
      </Container>
    </section>
  );
}

/** Illustrative installer session (decorative; the real guide lives on /self-hosting). */
function Terminal() {
  return (
    <div aria-hidden="true" className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-black/40 shadow-2xl backdrop-blur">
      <div className="flex h-10 items-center gap-1.5 border-b border-white/10 px-4">
        <span className="size-2.5 rounded-full bg-white/20" />
        <span className="size-2.5 rounded-full bg-white/20" />
        <span className="size-2.5 rounded-full bg-white/20" />
        <span className="ml-3 font-mono text-xs text-white/60">root@my-server: ~</span>
      </div>
      <pre className="overflow-hidden p-5 font-mono text-[0.72rem] leading-6 whitespace-pre-wrap text-white/85 sm:text-[0.8rem]">
        <span className="text-green-400">$ </span>
        {installCommand}
        {"\n\n"}
        <span className="font-semibold text-white">AutoSEO installer</span>
        {"\n"}
        <Step>Installing into /opt/autoseo</Step>
        <span className="text-white/60">Domain for this AutoSEO instance: </span>seo.example.com{"\n"}
        <Step>Generated a Postgres password.</Step>
        <Step>DNS check: seo.example.com → 203.0.113.10 ✓</Step>
        <Step>Pulling images…</Step>
        <Step>Starting AutoSEO…</Step>
        {"\n"}
        <span className="font-semibold text-white">AutoSEO is running</span>
        {"\n"}
        <span className="text-white">  Open https://seo.example.com/setup</span>
        {"\n"}
        <span className="text-white">  Setup code: </span>
        <span className="text-green-400">1234-5678</span>
      </pre>
    </div>
  );
}

function Step({ children }: { children: string }) {
  return (
    <>
      <span className="text-green-400">▸ </span>
      {children}
      {"\n"}
    </>
  );
}
