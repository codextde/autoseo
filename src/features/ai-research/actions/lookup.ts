"use server";

import { z } from "zod";
import { actionProject, ActionError, runAction } from "@/server/auth/guards";
import { logAudit } from "@/server/audit";
import { isDataForSeoConfigured } from "@/server/dataforseo/client";
import { createLookup, deleteLookup, getLookup, listLookups } from "@/server/ai/lookup/history";
import { explorerAvailability, MAX_EXPLORER_PROMPT } from "@/server/ai/lookup/prompt-explorer";
import { trackPromptText } from "@/server/ai/research/tracker";
import { getCountry } from "@/lib/countries";
import type { BrandLookupParams, ExplorerParams } from "../types";

/*
 * Permissions: Brand Lookup and Prompt Explorer are ad-hoc paid research tools (DataForSEO /
 * LLM API spend) → `seo.run`. "Track this prompt" writes to the tracker → `prompts.manage`.
 * Viewing history/results needs project access only.
 */

const brandLookupInput = z.object({
  query: z.string().trim().min(1).max(250),
  competitors: z.array(z.string().trim().min(1).max(250)).max(5).default([]),
  scope: z.enum(["domain", "subdomains"]).default("subdomains"),
  country: z.string().min(2).max(3),
});

export async function runBrandLookupAction(projectId: string, input: z.input<typeof brandLookupInput>) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "seo.run");
    if (!(await isDataForSeoConfigured())) throw new ActionError("DataForSEO is not configured (Admin → Data Providers).", "invalid");
    const data = brandLookupInput.parse(input);
    const country = getCountry(data.country);
    if (!country) throw new ActionError("Unknown market.", "invalid");
    const competitors = data.competitors.filter((c) => c.toLowerCase() !== data.query.toLowerCase());
    const params: BrandLookupParams = {
      query: data.query,
      competitors,
      scope: data.scope,
      country: country.iso,
      locationCode: country.locationCode,
      languageCode: country.language,
    };
    const row = await createLookup({ projectId, kind: "brand_lookup", query: data.query, params, userId: ctx.user.id });
    void logAudit("ai.brand_lookup", { actor: ctx.user, projectId, targetType: "ai_lookup", targetId: row.id, meta: { query: data.query } });
    return { id: row.id };
  });
}

const explorerInput = z.object({
  prompt: z.string().trim().min(3).max(MAX_EXPLORER_PROMPT),
  models: z.array(z.enum(["chat_gpt", "claude", "gemini", "perplexity", "autoseo"])).min(1, "Select at least one model.").max(5),
  webSearch: z.boolean().default(true),
  country: z.string().min(2).max(3).default("US"),
  highlightBrand: z.string().trim().max(120).nullish(),
});

export async function runPromptExplorerAction(projectId: string, input: z.input<typeof explorerInput>) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "seo.run");
    const data = explorerInput.parse(input);
    const avail = await explorerAvailability();
    const needsDfs = data.models.some((m) => m !== "autoseo");
    if (needsDfs && !avail.dataforseo) throw new ActionError("DataForSEO is not configured (Admin → Data Providers). Use the local agent / API model instead.", "invalid");
    if (data.models.includes("autoseo") && !avail.internal) throw new ActionError("No local agent or AI API provider is available (Admin → AI Providers).", "invalid");
    const params: ExplorerParams = { ...data, models: [...new Set(data.models)], highlightBrand: data.highlightBrand || null };
    const row = await createLookup({ projectId, kind: "prompt_explorer", query: data.prompt, params, userId: ctx.user.id });
    return { id: row.id };
  });
}

export async function getLookupAction(projectId: string, id: string) {
  return runAction(async () => {
    await actionProject(projectId);
    const row = await getLookup(projectId, z.string().parse(id));
    if (!row) throw new ActionError("Lookup not found.", "not_found");
    return { id: row.id, status: row.status, error: row.error, costUsd: row.costUsd, result: row.status === "done" ? row.result : null };
  });
}

export async function listLookupsAction(projectId: string, kind: "brand_lookup" | "prompt_explorer") {
  return runAction(async () => {
    await actionProject(projectId);
    return listLookups(projectId, z.enum(["brand_lookup", "prompt_explorer"]).parse(kind));
  });
}

export async function deleteLookupAction(projectId: string, id: string) {
  return runAction(async () => {
    await actionProject(projectId, "seo.run");
    await deleteLookup(projectId, z.string().parse(id));
    return true;
  });
}

export async function trackPromptAction(projectId: string, text: string) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "prompts.manage");
    const res = await trackPromptText(projectId, z.string().trim().min(3).max(2000).parse(text), ctx.user.id);
    if (!res.created.length && res.duplicates) return { status: "duplicate" as const };
    if (!res.created.length && res.skippedOverLimit) throw new ActionError("Prompt limit reached for this project (Admin → Limits & Budgets).", "conflict");
    return { status: "added" as const };
  });
}
