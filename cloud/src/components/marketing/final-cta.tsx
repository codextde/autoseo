import { finalCta } from "./content";
import { CtaLink, Container, LogoMark } from "./primitives";

export function FinalCta() {
  return (
    <section aria-labelledby="final-cta" className="pb-20 sm:pb-28">
      <Container>
        <div className="mk-dark-panel relative overflow-hidden rounded-3xl px-6 py-16 text-center text-white sm:px-12 sm:py-20">
          <div className="mk-dots-light absolute inset-0" aria-hidden="true" />
          <div className="relative">
            <LogoMark className="mx-auto size-12 rounded-xl ring-1 ring-white/15" />
            <h2 id="final-cta" className="mx-auto mt-6 max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-5xl">
              {finalCta.title}
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-pretty text-white/75">{finalCta.subtitle}</p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <CtaLink href={finalCta.primary.href} variant="inverted" size="lg" arrow className="w-full sm:w-auto">
                {finalCta.primary.label}
              </CtaLink>
              <CtaLink href={finalCta.secondary.href} variant="inverted-outline" size="lg" className="w-full sm:w-auto">
                {finalCta.secondary.label}
              </CtaLink>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
