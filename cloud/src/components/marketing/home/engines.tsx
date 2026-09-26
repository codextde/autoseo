import { engines, engineStrip } from "../content";
import { Container } from "../primitives";

export function EngineStrip() {
  return (
    <section aria-labelledby="engines-title" className="border-y bg-card/60 py-14 sm:py-16">
      <Container>
        <div className="mx-auto max-w-2xl text-center">
          <h2 id="engines-title" className="text-lg font-semibold tracking-tight sm:text-xl">
            {engineStrip.title}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base">{engineStrip.subtitle}</p>
        </div>
        <ul className="mx-auto mt-8 flex max-w-4xl flex-wrap justify-center gap-2 sm:gap-2.5">
          {engines.map((engine) => (
            <li
              key={engine.name}
              className="inline-flex items-center gap-2 rounded-full border bg-background py-1.5 pr-3.5 pl-1.5 text-sm font-medium shadow-xs"
            >
              <span
                aria-hidden="true"
                className="grid size-6 place-items-center rounded-full bg-foreground text-[0.65rem] font-bold text-background"
              >
                {monogram(engine.name)}
              </span>
              {engine.name}
              <span className="sr-only">by {engine.vendor}</span>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}

/** Neutral monochrome glyph instead of vendor logos. */
function monogram(name: string) {
  const words = name.replace("Google ", "").replace("Microsoft ", "").split(" ");
  return words.length > 1 ? `${words[0][0]}${words[1][0]}` : words[0].slice(0, 2);
}
