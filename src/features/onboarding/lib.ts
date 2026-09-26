import { getCountry } from "@/lib/countries";
import type { DraftCompetitor, DraftPrompt, OnboardingPageData, WizardDraft } from "./types";

/** Client-side mirror of `normalizeDomain` (server re-validates). */
export function cleanDomainInput(input: string): string {
  const raw = input.trim().toLowerCase();
  if (!raw) return "";
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return raw.replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0] ?? "";
  }
}

export function isDomain(d: string): boolean {
  return /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(d);
}

export function isEmail(e: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());
}

export function emailAllowed(email: string, allowed: string[]): boolean {
  const list = allowed.map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
  if (!list.length) return true;
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  return list.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/** "solakon.de" → "Solakon", "my-brand.co.uk" → "My Brand" */
export function nameFromDomain(domain: string): string {
  const first = domain.split(".")[0] ?? "";
  return first
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

let counter = 0;
export function uid(prefix = "d"): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function suggestionKey(d: Pick<WizardDraft, "domain" | "country" | "language">) {
  return `${cleanDomainInput(d.domain)}|${d.country}|${d.language}`;
}

export function initialDraft(data: OnboardingPageData): WizardDraft {
  const c = data.config;
  const country = getCountry(c.defaultCountry)?.iso ?? "US";
  return {
    workspaceId: data.workspaces[0]?.id ?? "",
    domain: "",
    name: "",
    nameTouched: false,
    isPitch: false,
    pitchDays: c.defaultPitchDays,
    country,
    language: c.defaultLanguage || getCountry(country)?.language || "en",
    languageTouched: false,
    brand: { description: "", industry: "", aliases: [], logoUrl: null },
    brandKey: null,
    competitors: [],
    competitorsKey: null,
    prompts: [],
    promptsKey: null,
    engines: c.defaultEngines.filter((id) => data.engines.some((e) => e.id === id && !e.disabled)),
    frequency: c.defaultTrackingFrequency,
    goToIntegrations: false,
    invites: [],
  };
}

/* ─────────────────────── Preview (admin) sample content ─────────────────────── */

const sampleCompetitors: DraftCompetitor[] = [
  { id: "c1", name: "SunVolt", domain: "sunvolt.example", ai: true },
  { id: "c2", name: "Heliora", domain: "heliora.example", ai: true },
  { id: "c3", name: "BrightRoof", domain: "brightroof.example", ai: true },
  { id: "c4", name: "Solaris Home", domain: "", ai: true },
];

const samplePrompts: DraftPrompt[] = [
  { id: "p1", text: "Which balcony solar kit is best for renters?", topic: "Balcony solar", funnelStage: "mofu", branded: false, selected: true, ai: true },
  { id: "p2", text: "How much can a plug-in solar system save per year?", topic: "Balcony solar", funnelStage: "tofu", branded: false, selected: true, ai: true },
  { id: "p3", text: "Best home battery for a small solar setup", topic: "Storage", funnelStage: "mofu", branded: false, selected: true, ai: true },
  { id: "p4", text: "Is Northwind Solar a good brand?", topic: "Storage", funnelStage: "bofu", branded: true, selected: false, ai: true },
  { id: "p5", text: "Do I need an electrician to install a solar kit?", topic: "Installation", funnelStage: "tofu", branded: false, selected: true, ai: true },
];

/** Clearly-labelled sample draft used only by the admin live preview. */
export function previewDraft(data: OnboardingPageData): WizardDraft {
  const base = initialDraft(data);
  return {
    ...base,
    workspaceId: data.workspaces[0]?.id ?? "preview",
    domain: "northwind-solar.example",
    name: "Northwind Solar",
    nameTouched: true,
    brand: {
      description: "Plug-in solar kits and home batteries for apartments and houses.",
      industry: "Solar energy",
      aliases: ["Northwind", "NW Solar"],
      logoUrl: null,
    },
    competitors: sampleCompetitors,
    prompts: samplePrompts,
    invites: [{ id: "i1", email: "teammate@company.example", roleKey: data.defaultRoleKey }],
  };
}
