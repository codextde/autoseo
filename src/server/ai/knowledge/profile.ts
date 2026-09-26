import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { competitors, projects, type ProjectBrand } from "@/server/db/schema";
import { runLlm } from "@/server/ai/llm";
import { getCountry, LANGUAGES } from "@/lib/countries";
import { getKnowledge, patchKnowledgeData, saveKnowledge } from "./store";
import type { BrandProfile, PersonasData, ProfileExtra } from "@/features/ai-research/types";

const EMPTY_EXTRA: ProfileExtra = { valueProps: [], tone: "", categories: [], audience: "", differentiators: [] };

export async function getProjectRow(projectId: string) {
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!p) throw new Error("Project not found");
  return p;
}

export async function getBrandProfile(projectId: string): Promise<BrandProfile> {
  const p = await getProjectRow(projectId);
  const extra = await getKnowledge<ProfileExtra>(projectId, "profile");
  const e = { ...EMPTY_EXTRA, ...(extra.data ?? {}) };
  return {
    name: p.name,
    description: p.description ?? p.brand.description ?? "",
    industry: p.brand.industry ?? "",
    aliases: p.brand.aliases ?? [],
    domains: p.brand.domains ?? [],
    primaryDomain: p.domain,
    country: p.country,
    language: p.language,
    valueProps: e.valueProps ?? [],
    tone: e.tone ?? "",
    categories: e.categories ?? [],
    audience: e.audience ?? "",
    differentiators: e.differentiators ?? [],
    generatedAt: e.generatedAt ?? null,
  };
}

export const profileInput = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000),
  industry: z.string().trim().max(160),
  aliases: z.array(z.string().trim().min(1).max(120)).max(30),
  domains: z.array(z.string().trim().min(3).max(253)).max(30),
  valueProps: z.array(z.string().trim().min(1).max(300)).max(20),
  tone: z.string().trim().max(500),
  categories: z.array(z.string().trim().min(1).max(120)).max(30),
  audience: z.string().trim().max(1000),
  differentiators: z.array(z.string().trim().min(1).max(300)).max(20),
});

export type ProfileInput = z.infer<typeof profileInput>;

function cleanDomain(d: string) {
  return d
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0]!;
}

export async function updateBrandProfile(projectId: string, input: ProfileInput) {
  const p = await getProjectRow(projectId);
  const brand: ProjectBrand = {
    ...p.brand,
    aliases: [...new Set(input.aliases)],
    domains: [...new Set(input.domains.map(cleanDomain).filter((d) => d && d !== p.domain))],
    description: input.description,
    industry: input.industry,
  };
  await db.update(projects).set({ name: input.name, description: input.description || null, brand }).where(eq(projects.id, projectId));
  const current = await getKnowledge<ProfileExtra>(projectId, "profile");
  await patchKnowledgeData(projectId, "profile", {
    ...(current.data ?? {}),
    valueProps: input.valueProps,
    tone: input.tone,
    categories: input.categories,
    audience: input.audience,
    differentiators: input.differentiators,
  });
}

export function languageName(code: string) {
  return LANGUAGES.find((l) => l.code === code)?.name ?? code;
}

/** Compact brand briefing used in every LLM prompt of the module. */
export async function brandBriefing(projectId: string): Promise<string> {
  const profile = await getBrandProfile(projectId);
  const comps = await db.select({ name: competitors.name, domain: competitors.domain }).from(competitors).where(eq(competitors.projectId, projectId));
  const personas = await getKnowledge<PersonasData>(projectId, "personas");
  const country = getCountry(profile.country)?.name ?? profile.country;
  const lines = [
    `Brand: ${profile.name} (${profile.primaryDomain})`,
    profile.description && `Description: ${profile.description}`,
    profile.industry && `Industry: ${profile.industry}`,
    profile.categories.length ? `Product/service categories: ${profile.categories.join(", ")}` : null,
    profile.valueProps.length ? `Value propositions: ${profile.valueProps.join("; ")}` : null,
    profile.audience && `Audience: ${profile.audience}`,
    profile.aliases.length ? `Brand aliases: ${profile.aliases.join(", ")}` : null,
    `Market: ${country} (language: ${languageName(profile.language)})`,
    comps.length ? `Competitors: ${comps.map((c) => (c.domain ? `${c.name} (${c.domain})` : c.name)).join(", ")}` : null,
    personas.data?.personas?.length ? `Buyer personas: ${personas.data.personas.map((p) => `${p.name} — ${p.role}`).join("; ")}` : null,
  ].filter(Boolean);
  return lines.join("\n");
}

const profileSchema = z.object({
  name: z.string(),
  description: z.string(),
  industry: z.string(),
  aliases: z.array(z.string()),
  categories: z.array(z.string()),
  valueProps: z.array(z.string()),
  audience: z.string(),
  tone: z.string(),
  differentiators: z.array(z.string()),
});

/**
 * Researches the brand with the LLM router (web search enabled) and stores the extended profile.
 * Only fills project fields that are still empty so manual edits are never overwritten.
 */
export async function generateBrandProfile(projectId: string, userId: string | null): Promise<string> {
  const p = await getProjectRow(projectId);
  const country = getCountry(p.country)?.name ?? p.country;
  const res = await runLlm({
    purpose: "brand_knowledge_profile",
    timeoutMs: 15 * 60_000,
    webSearch: true,
    projectId,
    workspaceId: p.workspaceId,
    userId,
    system: "You are a brand strategist. Research the company behind the website and describe it factually. Never invent facts; leave fields empty when unknown.",
    prompt: `Research the brand behind https://${p.domain} (market: ${country}). Current name in our system: "${p.name}".
Write the description, categories, value propositions, audience, tone and differentiators in ${languageName(p.language)}.
- name: the brand name as customers use it
- description: 2–3 sentences about what the company sells and to whom
- industry: short industry label
- aliases: alternative spellings, product-line names or the legal company name customers might use (max 8)
- categories: the main product/service categories (max 10)
- valueProps: key value propositions (max 6)
- audience: who buys (1–2 sentences)
- tone: brand voice in a few words
- differentiators: what sets them apart from competitors (max 6)`,
    schema: profileSchema,
    maxTokens: 4000,
  });
  const d = res.data;
  const brand: ProjectBrand = {
    ...p.brand,
    aliases: p.brand.aliases?.length ? p.brand.aliases : d.aliases.slice(0, 8),
    description: p.brand.description || d.description,
    industry: p.brand.industry || d.industry,
  };
  await db
    .update(projects)
    .set({ description: p.description || d.description || null, brand, name: p.name === p.domain && d.name ? d.name : p.name })
    .where(eq(projects.id, projectId));
  const current = await getKnowledge<ProfileExtra>(projectId, "profile");
  const cur = { ...EMPTY_EXTRA, ...(current.data ?? {}) };
  await saveKnowledge(projectId, "profile", {
    valueProps: cur.valueProps.length ? cur.valueProps : d.valueProps.slice(0, 6),
    tone: cur.tone || d.tone,
    categories: cur.categories.length ? cur.categories : d.categories.slice(0, 10),
    audience: cur.audience || d.audience,
    differentiators: cur.differentiators.length ? cur.differentiators : d.differentiators.slice(0, 6),
    generatedAt: new Date().toISOString(),
    provider: res.provider,
  });
  return `Brand profile for ${d.name || p.name} researched (${d.categories.length} categories, ${d.valueProps.length} value propositions).`;
}

/** True when enough brand context exists to auto-generate a default prompt list. */
export async function hasBrandContext(projectId: string): Promise<boolean> {
  const profile = await getBrandProfile(projectId);
  const personas = await getKnowledge<PersonasData>(projectId, "personas");
  return Boolean(profile.description || profile.industry || profile.categories.length || personas.data?.personas?.length);
}
