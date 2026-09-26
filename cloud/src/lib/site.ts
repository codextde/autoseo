/** Public facts about the product used across the marketing site, metadata and emails. */
export const site = {
  name: "AutoSEO",
  tagline: "Open-source AI SEO & GEO platform",
  description:
    "AutoSEO is the open-source AI visibility and SEO platform. Track how ChatGPT, Perplexity, Gemini, Claude and Google AI Overviews mention your brand, research keywords, track rankings, audit your site and automate content — self-host for free or get your own managed instance for $50/month.",
  url: (process.env.APP_URL ?? `https://${process.env.DOMAIN ?? "autoseo.codext.de"}`).replace(/\/+$/, ""),
  github: "https://github.com/codextde/autoseo",
  image: "ghcr.io/codextde/autoseo",
  priceMonthlyUsd: 50,
  company: "Codext GmbH",
  contactEmail: "info@codext.de",
  /** Canonical public host of the marketing site (used in copy, e.g. install one-liner and instance hosts). */
  host: "autoseo.codext.de",
  /** Raw installer served via the `/install` redirect. */
  installScript: "https://raw.githubusercontent.com/codextde/autoseo/main/deploy/install.sh",
  composeFile: "https://raw.githubusercontent.com/codextde/autoseo/main/deploy/docker-compose.yml",
  /** Date the legal pages were last reviewed (ISO). */
  legalUpdated: "2026-09-26",
  /** Legal entity as published at https://www.codext.de/impressum. */
  legal: {
    name: "Codext GmbH",
    street: "Frankenstraße 10",
    postalCode: "74549",
    city: "Wolpertshausen",
    country: "Deutschland",
    countryCode: "DE",
    managingDirector: "Daniel Ehrhardt",
    registerCourt: "Amtsgericht Stuttgart",
    registerNumber: "HRB 772091",
    vatId: "DE327501500",
    phone: "+49 7904 5203106",
    email: "kontakt@codext.de",
    website: "https://www.codext.de",
  },
} as const;

/** Absolute URL for a site path. */
export function absoluteUrl(path = "/") {
  return path === "/" ? site.url : `${site.url}${path.startsWith("/") ? path : `/${path}`}`;
}
