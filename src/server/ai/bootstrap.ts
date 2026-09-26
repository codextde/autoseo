import "server-only";
import * as cheerio from "cheerio";
import { z } from "zod";
import { count, eq } from "drizzle-orm";
import { runLlm } from "@/server/ai/llm";
import { db } from "@/server/db/client";
import { competitors, projects, prompts } from "@/server/db/schema";
import { getSetting } from "@/server/settings";
import { getCountry, LANGUAGES } from "@/lib/countries";
import { safeFetchText } from "@/server/ai/tracking/safe-fetch";

/**
 * AI-assisted project setup used by onboarding, the API and MCP.
 * Implemented by the AI tracking module (uses runLlm → local agent / API fallback).
 * All functions throw AiNotConfiguredError when no AI provider is available.
 */

export type BrandProfileSuggestion = {
  name: string;
  description: string;
  industry: string;
  aliases: string[];
  logoUrl: string | null;
  language: string;
};

export type CompetitorSuggestion = { name: string; domain: string | null; reason?: string };

export type PromptSuggestion = {
  text: string;
  topic: string;
  funnelStage: "tofu" | "mofu" | "bofu";
  branded: boolean;
  persona?: string;
};

function languageName(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.name ?? code;
}

function cleanDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = input.trim().toLowerCase();
  try {
    const host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.replace(/^www\./, "");
    return /^([a-z0-9-]+\.)+[a-z]{2,63}$/.test(host) ? host : null;
  } catch {
    return null;
  }
}

type PageInfo = { title: string; description: string; siteName: string; logoUrl: string | null; text: string; lang: string };

/** Fetches the homepage (SSRF-safe) and extracts what the LLM needs to describe the brand. */
async function readHomepage(domain: string): Promise<PageInfo | null> {
  for (const url of [`https://${domain}/`, `https://www.${domain}/`]) {
    try {
      const res = await safeFetchText(url, { timeoutMs: 15_000 });
      if (res.status >= 400 || !/html/i.test(res.contentType || "text/html")) continue;
      const $ = cheerio.load(res.body);
      const abs = (href: string | undefined) => {
        if (!href) return null;
        try {
          const u = new URL(href, res.url);
          return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
        } catch {
          return null;
        }
      };
      const logo =
        abs($('link[rel="apple-touch-icon"]').attr("href")) ??
        abs($('meta[property="og:logo"]').attr("content")) ??
        abs($('link[rel="icon"][sizes]').last().attr("href")) ??
        abs($('link[rel~="icon"]').first().attr("href"));
      $("script, style, noscript, svg, iframe, template").remove();
      const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, 6000);
      return {
        title: $("title").first().text().trim().slice(0, 200),
        description: ($('meta[name="description"]').attr("content") ?? $('meta[property="og:description"]').attr("content") ?? "").trim().slice(0, 500),
        siteName: ($('meta[property="og:site_name"]').attr("content") ?? "").trim().slice(0, 100),
        logoUrl: logo,
        text,
        lang: ($("html").attr("lang") ?? "").slice(0, 2).toLowerCase(),
      };
    } catch {
      // try next variant
    }
  }
  return null;
}

const profileSchema = z.object({
  name: z.string().describe("The brand name as customers know it (not the legal entity unless that is the brand)"),
  description: z.string().describe("2-3 sentence description of what the brand offers and for whom"),
  industry: z.string().describe("Short industry / category label in English"),
  aliases: z.array(z.string()).describe("Other spellings, abbreviations or product-line names that should count as a mention of the brand"),
});

/** Who the AI work is for — routes it to that workspace's local agents (and records usage there). */
export type AiScopeInput = { workspaceId?: string | null; projectId?: string | null; userId?: string | null };

function scopeOf(input: AiScopeInput) {
  return { workspaceId: input.workspaceId ?? null, projectId: input.projectId ?? null, userId: input.userId ?? null };
}

export async function suggestBrandProfile(input: { domain: string; country: string; language: string } & AiScopeInput): Promise<BrandProfileSuggestion> {
  const domain = cleanDomain(input.domain) ?? input.domain;
  const page = await readHomepage(domain);
  const market = getCountry(input.country)?.name ?? input.country;
  const context = page
    ? `Homepage title: ${page.title}\nSite name: ${page.siteName}\nMeta description: ${page.description}\nPage text (excerpt): ${page.text}`
    : "The homepage could not be fetched — research the domain on the web.";
  const res = await runLlm({
    purpose: "brand_profile",
    prompt: `Describe the brand behind the website ${domain} (market: ${market}).\n\n${context}\n\nWrite the description in ${languageName(input.language)}. Aliases must be real alternative names people use for this brand (no generic words, no competitor names). Return at most 6 aliases.`,
    schema: profileSchema,
    webSearch: !page,
    effort: "low",
    ...scopeOf(input),
  });
  const d = res.data;
  const stem = domain.split(".")[0] ?? domain;
  const name = d.name.trim() || page?.siteName || stem;
  const aliases = [...new Set(d.aliases.map((a) => a.trim()).filter((a) => a.length >= 2 && a.toLowerCase() !== name.toLowerCase()))].slice(0, 8);
  return {
    name,
    description: d.description.trim(),
    industry: d.industry.trim(),
    aliases,
    logoUrl: page?.logoUrl ?? null,
    language: page?.lang && LANGUAGES.some((l) => l.code === page.lang) ? page.lang : input.language,
  };
}

const competitorsSchema = z.object({
  competitors: z.array(
    z.object({
      name: z.string(),
      domain: z.string().nullable().describe("Main website domain, e.g. example.com"),
      reason: z.string().describe("One short sentence why it competes"),
    }),
  ),
});

export async function suggestCompetitors(input: {
  domain: string;
  brandName: string;
  description?: string;
  country: string;
  language: string;
  count: number;
} & AiScopeInput): Promise<CompetitorSuggestion[]> {
  if (input.count <= 0) return [];
  const market = getCountry(input.country)?.name ?? input.country;
  const res = await runLlm({
    purpose: "competitor_discovery",
    prompt: `Brand: ${input.brandName} (${input.domain})${input.description ? `\nAbout: ${input.description}` : ""}\nMarket: ${market}\n\nList the ${input.count} most relevant direct competitors that customers in ${market} compare ${input.brandName} with (brands offering similar products/services and likely to be recommended by AI assistants for the same questions). Prefer brands active in ${market}. Do not include ${input.brandName} itself, retailers/marketplaces or review sites.`,
    schema: competitorsSchema,
    webSearch: true,
    effort: "low",
    ...scopeOf(input),
  });
  const own = cleanDomain(input.domain);
  const seen = new Set<string>();
  const out: CompetitorSuggestion[] = [];
  for (const c of res.data.competitors) {
    const name = c.name.trim();
    const domain = cleanDomain(c.domain);
    if (!name || name.toLowerCase() === input.brandName.toLowerCase() || (domain && own && domain === own)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: name.slice(0, 120), domain, reason: c.reason.trim() || undefined });
    if (out.length >= input.count) break;
  }
  return out;
}

const promptsSchema = z.object({
  prompts: z.array(
    z.object({
      text: z.string(),
      topic: z.string().describe("Short topic cluster label (2-3 words) in the prompt language"),
      funnelStage: z.enum(["tofu", "mofu", "bofu"]),
      branded: z.boolean().describe("true when the prompt names the brand"),
      persona: z.string().nullable(),
    }),
  ),
});

export async function suggestPrompts(input: {
  brandName: string;
  domain: string;
  description?: string;
  competitors: string[];
  country: string;
  language: string;
  count: number;
} & AiScopeInput): Promise<PromptSuggestion[]> {
  if (input.count <= 0) return [];
  const market = getCountry(input.country)?.name ?? input.country;
  const lang = languageName(input.language);
  const res = await runLlm({
    purpose: "prompt_generation",
    prompt: `Generate ${input.count} realistic prompts that people in ${market} type into AI assistants (ChatGPT, Perplexity, Google AI Mode…) when they research the category of this brand. These prompts will be tracked to measure the brand's AI visibility.

Brand: ${input.brandName} (${input.domain})${input.description ? `\nAbout: ${input.description}` : ""}${input.competitors.length ? `\nCompetitors: ${input.competitors.join(", ")}` : ""}

Rules:
- Write every prompt in ${lang}, natural and conversational (8-25 words), like a real user would ask.
- Mix funnel stages: ~40% tofu (problem/education), ~35% mofu (comparison, "best …", alternatives), ~25% bofu (purchase decision, pricing, where to buy).
- About 80% unbranded (no brand names) so they measure organic visibility; at most 20% may mention ${input.brandName} or a competitor (set branded=true when ${input.brandName} is named).
- Group them into 4-7 topics (topic label in ${lang}).
- No duplicates, no numbering.`,
    schema: promptsSchema,
    effort: "low",
    ...scopeOf(input),
  });
  const seen = new Set<string>();
  const out: PromptSuggestion[] = [];
  for (const p of res.data.prompts) {
    const text = p.text.trim().replace(/^\d+[.)]\s*/, "");
    const key = text.toLowerCase();
    if (text.length < 8 || seen.has(key)) continue;
    seen.add(key);
    out.push({
      text: text.slice(0, 500),
      topic: p.topic.trim().slice(0, 60) || "General",
      funnelStage: p.funnelStage,
      branded: p.branded || text.toLowerCase().includes(input.brandName.toLowerCase()),
      persona: p.persona?.trim() || undefined,
    });
    if (out.length >= input.count) break;
  }
  return out;
}

/* ─────────────────────────── ai.project_bootstrap ─────────────────────────── */

export type BootstrapStep = { step: "brand" | "competitors" | "prompts" | "run"; status: "done" | "skipped" | "failed"; detail: string };

/**
 * Background setup for a new project: fills a missing brand profile, discovers competitors when
 * none exist, generates prompts when none exist and starts the first tracking run.
 * Each step is independent — a missing AI provider skips the AI steps without failing the job.
 */
export async function bootstrapProject(projectId: string, opts: { userId?: string | null } = {}): Promise<BootstrapStep[]> {
  const { addTrackedPrompts } = await import("@/server/ai/tracking/prompts");
  const { startTrackingRun } = await import("@/server/ai/tracking/runs");
  const steps: BootstrapStep[] = [];
  const onboarding = await getSetting("onboarding");
  const load = async () => (await db.select().from(projects).where(eq(projects.id, projectId)).limit(1))[0];
  let project = await load();
  if (!project) throw new Error("Project not found");
  if ((project.settings as Record<string, unknown> | null)?.demo === true) {
    return [{ step: "run", status: "skipped", detail: "Demo project — generated sample data is not bootstrapped or tracked." }];
  }
  const errText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

  // 1) Brand profile
  const brand = project.brand ?? { aliases: [], domains: [] };
  if (!project.description || !brand.industry || !(brand.aliases?.length)) {
    try {
      const profile = await suggestBrandProfile({
        domain: project.domain,
        country: project.country,
        language: project.language,
        workspaceId: project.workspaceId,
        projectId,
        userId: opts.userId ?? null,
      });
      const nameIsDomain = project.name === project.domain || project.name.toLowerCase() === project.domain.split(".")[0];
      await db
        .update(projects)
        .set({
          name: nameIsDomain && profile.name ? profile.name.slice(0, 120) : project.name,
          description: project.description || profile.description || null,
          logoUrl: project.logoUrl || profile.logoUrl,
          brand: {
            ...brand,
            aliases: brand.aliases?.length ? brand.aliases : profile.aliases,
            domains: brand.domains ?? [],
            description: brand.description || profile.description,
            industry: brand.industry || profile.industry,
          },
        })
        .where(eq(projects.id, projectId));
      steps.push({ step: "brand", status: "done", detail: `${profile.name} · ${profile.industry}` });
    } catch (err) {
      steps.push({ step: "brand", status: "failed", detail: errText(err) });
    }
  } else steps.push({ step: "brand", status: "skipped", detail: "Brand profile already complete." });
  project = (await load())!;

  // 2) Competitors
  const [{ n: compCount } = { n: 0 }] = await db.select({ n: count() }).from(competitors).where(eq(competitors.projectId, projectId));
  if (!onboarding.autoDiscoverCompetitors) steps.push({ step: "competitors", status: "skipped", detail: "Disabled in Admin → Onboarding." });
  else if (Number(compCount) > 0) steps.push({ step: "competitors", status: "skipped", detail: `${compCount} competitors already set.` });
  else {
    try {
      const list = await suggestCompetitors({
        domain: project.domain,
        brandName: project.name,
        description: project.description ?? undefined,
        country: project.country,
        language: project.language,
        count: onboarding.suggestedCompetitorCount,
        workspaceId: project.workspaceId,
        projectId,
        userId: opts.userId ?? null,
      });
      for (const c of list) {
        await db.insert(competitors).values({ projectId, name: c.name, domain: c.domain, source: "auto", tracked: true }).onConflictDoNothing();
      }
      steps.push({ step: "competitors", status: "done", detail: `${list.length} competitors discovered.` });
    } catch (err) {
      steps.push({ step: "competitors", status: "failed", detail: errText(err) });
    }
  }

  // 3) Prompts
  const [{ n: promptCount } = { n: 0 }] = await db.select({ n: count() }).from(prompts).where(eq(prompts.projectId, projectId));
  if (!onboarding.autoGeneratePrompts) steps.push({ step: "prompts", status: "skipped", detail: "Disabled in Admin → Onboarding." });
  else if (Number(promptCount) > 0) steps.push({ step: "prompts", status: "skipped", detail: `${promptCount} prompts already exist.` });
  else {
    try {
      const comps = await db.select({ name: competitors.name }).from(competitors).where(eq(competitors.projectId, projectId));
      const list = await suggestPrompts({
        brandName: project.name,
        domain: project.domain,
        description: project.description ?? undefined,
        competitors: comps.map((c) => c.name),
        country: project.country,
        language: project.language,
        count: onboarding.suggestedPromptCount,
        workspaceId: project.workspaceId,
        projectId,
        userId: opts.userId ?? null,
      });
      const res = await addTrackedPrompts({
        projectId,
        prompts: list.map((p) => ({ text: p.text, topic: p.topic, funnelStage: p.funnelStage, branded: p.branded, persona: p.persona ?? null, tags: [p.topic] })),
        source: "generated",
        userId: opts.userId ?? null,
      });
      steps.push({ step: "prompts", status: "done", detail: `${res.created.length} prompts generated.` });
    } catch (err) {
      steps.push({ step: "prompts", status: "failed", detail: errText(err) });
    }
  }

  // 4) First run
  try {
    const run = await startTrackingRun({ projectId, trigger: "schedule", userId: opts.userId ?? null });
    steps.push({
      step: "run",
      status: run.status === "failed" ? "failed" : "done",
      detail: run.status === "failed" ? (run.error ?? "Run could not start.") : `${run.tasks} answers queued.`,
    });
  } catch (err) {
    steps.push({ step: "run", status: "failed", detail: errText(err) });
  }

  await db
    .update(projects)
    .set({ onboardingState: { ...(project.onboardingState ?? {}), bootstrap: { at: new Date().toISOString(), steps } } })
    .where(eq(projects.id, projectId));
  return steps;
}
