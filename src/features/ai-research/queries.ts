import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { competitors } from "@/server/db/schema";
import { availableLlmProviders } from "@/server/ai/llm";
import { isDataForSeoConfigured } from "@/server/dataforseo/client";
import { ensureDefaultList, getItems, getLists } from "@/server/ai/research/lists";
import { syncTrackedState, trackerQuota } from "@/server/ai/research/tracker";
import { getAllKnowledge, getKnowledge } from "@/server/ai/knowledge/store";
import { getBrandProfile, hasBrandContext } from "@/server/ai/knowledge/profile";
import { getStreamConfig, listProducts } from "@/server/ai/knowledge/products";
import { listContextNotes } from "@/server/ai/knowledge/context";
import { listLookups } from "@/server/ai/lookup/history";
import { LOOKUP_COST } from "@/server/ai/lookup/brand-lookup";
import { env } from "@/server/env";
import type { InterestData, PersonasData } from "./types";

export async function providerStatus() {
  const [dataforseo, providers] = await Promise.all([isDataForSeoConfigured(), availableLlmProviders()]);
  return { dataforseo, llm: providers.length > 0, llmProviders: providers };
}

export async function loadPromptResearch(projectId: string, listParam: string | undefined) {
  await ensureDefaultList(projectId);
  await syncTrackedState(projectId);
  const lists = await getLists(projectId);
  const active = lists.find((l) => l.id === listParam) ?? lists.find((l) => l.isDefault) ?? lists[0]!;
  const [items, quota, providers, interest, personas, comps, profile, brandContext] = await Promise.all([
    getItems(projectId, active.id),
    trackerQuota(projectId),
    providerStatus(),
    getKnowledge<InterestData>(projectId, "interest"),
    getKnowledge<PersonasData>(projectId, "personas"),
    db.select({ name: competitors.name }).from(competitors).where(eq(competitors.projectId, projectId)),
    getBrandProfile(projectId),
    hasBrandContext(projectId),
  ]);
  const topicSuggestions = [
    ...new Set([
      ...(interest.data?.clusters ?? []).filter((c) => c.name !== "Other").map((c) => c.name),
      ...profile.categories,
      ...items.map((i) => i.topic).filter((t): t is string => !!t),
    ]),
  ].slice(0, 40);
  return {
    lists,
    active,
    items,
    quota,
    providers,
    brandContext,
    brandName: profile.name,
    suggestions: {
      topics: topicSuggestions,
      personas: (personas.data?.personas ?? []).map((p) => p.name),
      competitors: comps.map((c) => c.name),
    },
    project: { country: profile.country, language: profile.language },
  };
}

export async function loadKnowledge(projectId: string) {
  const [all, profile, stream, products, notes, providers] = await Promise.all([
    getAllKnowledge(projectId),
    getBrandProfile(projectId),
    getStreamConfig(projectId),
    listProducts(projectId, { limit: 100 }),
    listContextNotes(projectId),
    providerStatus(),
  ]);
  return { all, profile, stream, products, notes, providers, pushEndpoint: `${env.appUrl}/api/public/products/${projectId}` };
}

export async function loadLookups(projectId: string, kind: "brand_lookup" | "prompt_explorer") {
  const [history, providers, profile] = await Promise.all([listLookups(projectId, kind), providerStatus(), getBrandProfile(projectId)]);
  return { history, providers, profile, cost: LOOKUP_COST };
}
