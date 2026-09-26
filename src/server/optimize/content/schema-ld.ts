/** JSON-LD generator for content pieces (pure, isomorphic — used by the editor and the generator job). */

export type JsonLdInput = {
  title: string;
  description?: string | null;
  url?: string | null;
  language?: string | null;
  authorName?: string | null;
  authorTitle?: string | null;
  publisherName?: string | null;
  publisherUrl?: string | null;
  publisherLogo?: string | null;
  datePublished?: string | null;
  dateModified?: string | null;
  image?: string | null;
  faqs?: Array<{ question: string; answer: string }>;
  entities?: Array<{ name: string; type?: string | null; sameAs?: string | null }>;
  howToSteps?: string[];
  type?: "Article" | "BlogPosting" | "HowTo";
};

export function buildJsonLd(input: JsonLdInput): Record<string, unknown> {
  const graph: Record<string, unknown>[] = [];
  const orgId = input.publisherUrl ? `${input.publisherUrl.replace(/\/+$/, "")}/#organization` : undefined;
  if (input.publisherName) {
    graph.push({
      "@type": "Organization",
      ...(orgId ? { "@id": orgId } : {}),
      name: input.publisherName,
      ...(input.publisherUrl ? { url: input.publisherUrl } : {}),
      ...(input.publisherLogo ? { logo: { "@type": "ImageObject", url: input.publisherLogo } } : {}),
    });
  }
  const main: Record<string, unknown> = {
    "@type": input.type ?? "Article",
    headline: input.title.slice(0, 110),
    ...(input.description ? { description: input.description } : {}),
    ...(input.url ? { url: input.url, mainEntityOfPage: input.url } : {}),
    ...(input.language ? { inLanguage: input.language } : {}),
    ...(input.image ? { image: input.image } : {}),
    datePublished: input.datePublished ?? new Date().toISOString().slice(0, 10),
    dateModified: input.dateModified ?? input.datePublished ?? new Date().toISOString().slice(0, 10),
    ...(input.authorName
      ? { author: { "@type": "Person", name: input.authorName, ...(input.authorTitle ? { jobTitle: input.authorTitle } : {}) } }
      : input.publisherName
        ? { author: { "@type": "Organization", name: input.publisherName } }
        : {}),
    ...(input.publisherName ? { publisher: orgId ? { "@id": orgId } : { "@type": "Organization", name: input.publisherName } } : {}),
  };
  const ents = (input.entities ?? []).filter((e) => e.name?.trim()).slice(0, 12);
  if (ents.length) {
    main.about = ents.slice(0, 3).map((e) => ({ "@type": e.type || "Thing", name: e.name, ...(e.sameAs ? { sameAs: e.sameAs } : {}) }));
    if (ents.length > 3) main.mentions = ents.slice(3).map((e) => ({ "@type": e.type || "Thing", name: e.name, ...(e.sameAs ? { sameAs: e.sameAs } : {}) }));
  }
  if (input.type === "HowTo" && input.howToSteps?.length) {
    main.name = input.title;
    main.step = input.howToSteps.map((text, i) => ({ "@type": "HowToStep", position: i + 1, text }));
  }
  graph.push(main);
  const faqs = (input.faqs ?? []).filter((f) => f.question?.trim() && f.answer?.trim());
  if (faqs.length) {
    graph.push({
      "@type": "FAQPage",
      mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })),
    });
  }
  return { "@context": "https://schema.org", "@graph": graph };
}

export function buildJsonLdString(input: JsonLdInput): string {
  return JSON.stringify(buildJsonLd(input), null, 2);
}
