"use server";

import { z } from "zod";
import { actionProject, ActionError, runAction } from "@/server/auth/guards";
import { logAudit } from "@/server/audit";
import { startKnowledgeAnalysis } from "@/server/ai/knowledge/analyze";
import { getKnowledge, patchKnowledgeData } from "@/server/ai/knowledge/store";
import { deletePersona, personaInput, upsertPersona } from "@/server/ai/knowledge/personas";
import { profileInput, updateBrandProfile } from "@/server/ai/knowledge/profile";
import { contextNoteInput, deleteContextNote, upsertContextNote } from "@/server/ai/knowledge/context";
import {
  clearCatalog,
  detectAndParse,
  disconnectStream,
  listProducts,
  MAX_PRODUCTS_PER_IMPORT,
  recordImport,
  rotatePushToken,
  setFeedUrl,
  upsertProducts,
} from "@/server/ai/knowledge/products";
import { assertSafeUrl, UnsafeUrlError } from "@/server/ai/knowledge/safe-fetch";
import { availableLlmProviders } from "@/server/ai/llm";
import { ensureDefaultList } from "@/server/ai/research/lists";
import { defaultPromptSetConfig, startPromptGeneration } from "@/server/ai/research/generate";
import type { KnowledgeKind, KnowledgeState, PersonasData, SitemapData } from "../types";

/*
 * Permissions (Brand Knowledge):
 * - viewing: project access
 * - running analyses (incl. the DataForSEO calls of the interest analysis), editing personas,
 *   important sections, product imports and project context notes: `prompts.manage`
 * - editing the brand profile (name, aliases, own domains — affects tracking metrics): `projects.manage`
 * - creating / rotating the product push-API token (a credential): `settings.manage`
 */

const kindSchema = z.enum(["interest", "sitemap", "personas", "products", "profile"]);

export async function startAnalysisAction(projectId: string, kind: KnowledgeKind) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "prompts.manage");
    const k = kindSchema.parse(kind);
    if ((k === "personas" || k === "profile") && !(await availableLlmProviders()).length)
      throw new ActionError("No AI provider is available. Connect a local agent or add an API key in Admin → AI Providers.", "invalid");
    const jobId = await startKnowledgeAnalysis(projectId, k, ctx.user.id);
    void logAudit("knowledge.analysis_started", { actor: ctx.user, projectId, meta: { kind: k } });
    return { jobId };
  });
}

export async function getKnowledgeStatusAction(projectId: string, kind: KnowledgeKind) {
  return runAction(async () => {
    await actionProject(projectId);
    const s = await getKnowledge(projectId, kindSchema.parse(kind));
    return { status: s.status, jobId: s.jobId, error: s.error, finishedAt: s.finishedAt } satisfies Partial<KnowledgeState<unknown>>;
  });
}

export async function setImportantSectionsAction(projectId: string, paths: string[]) {
  return runAction(async () => {
    await actionProject(projectId, "prompts.manage");
    const list = z.array(z.string().startsWith("/").max(500)).max(200).parse(paths);
    const s = await getKnowledge<SitemapData>(projectId, "sitemap");
    if (!s.data) throw new ActionError("Run the sitemap analysis first.", "invalid");
    await patchKnowledgeData(projectId, "sitemap", { ...(s.data as unknown as Record<string, unknown>), important: [...new Set(list)] });
    return true;
  });
}

export async function savePersonaAction(projectId: string, persona: z.input<typeof personaInput>) {
  return runAction(async () => {
    await actionProject(projectId, "prompts.manage");
    return upsertPersona(projectId, personaInput.parse(persona));
  });
}

export async function deletePersonaAction(projectId: string, personaId: string) {
  return runAction(async () => {
    await actionProject(projectId, "prompts.manage");
    await deletePersona(projectId, z.string().parse(personaId));
    return true;
  });
}

/** "Generate prompts for persona" → starts a Prompt Set Helper run on the default list. */
export async function generatePersonaPromptsAction(projectId: string, personaId: string) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "prompts.manage");
    if (!(await availableLlmProviders()).length)
      throw new ActionError("No AI provider is available. Connect a local agent or add an API key in Admin → AI Providers.", "invalid");
    const personas = await getKnowledge<PersonasData>(projectId, "personas");
    const persona = personas.data?.personas.find((p) => p.id === personaId);
    if (!persona) throw new ActionError("Persona not found.", "not_found");
    const list = await ensureDefaultList(projectId);
    const base = await defaultPromptSetConfig(projectId);
    const { jobId } = await startPromptGeneration({
      projectId,
      listId: list.id,
      userId: ctx.user.id,
      config: { ...base, personas: [persona.name], count: 20, instructions: `All prompts are asked by the persona "${persona.name}" (${persona.role}).` },
    });
    return { listId: list.id, jobId };
  });
}

export async function saveProfileAction(projectId: string, input: z.input<typeof profileInput>) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "projects.manage");
    await updateBrandProfile(projectId, profileInput.parse(input));
    void logAudit("knowledge.profile_updated", { actor: ctx.user, projectId, targetType: "project", targetId: projectId });
    return true;
  });
}

/* ───────────────────────────── Product stream ───────────────────────────── */

export async function connectFeedAction(projectId: string, feedUrl: string, syncDaily: boolean) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "prompts.manage");
    let url: string;
    try {
      url = assertSafeUrl(z.string().trim().url().max(2048).parse(feedUrl)).toString();
    } catch (err) {
      throw new ActionError(err instanceof UnsafeUrlError ? err.message : "Please enter a valid http(s) feed URL.", "invalid");
    }
    await setFeedUrl(projectId, url, z.boolean().parse(syncDaily), ctx.user.id);
    const jobId = await startKnowledgeAnalysis(projectId, "products", ctx.user.id);
    void logAudit("knowledge.product_feed_connected", { actor: ctx.user, projectId, meta: { url } });
    return { jobId };
  });
}

export async function syncFeedNowAction(projectId: string) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "prompts.manage");
    const jobId = await startKnowledgeAnalysis(projectId, "products", ctx.user.id);
    return { jobId };
  });
}

export async function uploadProductsAction(projectId: string, form: FormData) {
  return runAction(async () => {
    await actionProject(projectId, "prompts.manage");
    const file = form.get("file");
    const replace = form.get("replace") === "true";
    if (!(file instanceof File)) throw new ActionError("Please choose a file.", "invalid");
    if (file.size > 20 * 1024 * 1024) throw new ActionError("File is larger than 20 MB.", "invalid");
    const text = await file.text();
    let items: Record<string, unknown>[];
    try {
      items = detectAndParse(text, { filename: file.name, contentType: file.type });
    } catch (err) {
      throw new ActionError(`Could not parse the file: ${err instanceof Error ? err.message : String(err)}`, "invalid");
    }
    if (!items.length) throw new ActionError("No products found. Supported: CSV (with header row), JSON array, Google Merchant XML.", "invalid");
    if (items.length > MAX_PRODUCTS_PER_IMPORT) throw new ActionError(`At most ${MAX_PRODUCTS_PER_IMPORT.toLocaleString("en-US")} products per file.`, "invalid");
    const stats = await upsertProducts(projectId, items, "file", { replace });
    await recordImport(projectId, "file", stats);
    return stats;
  });
}

/** Creates or rotates the push-API token. The plain token is returned exactly once. */
export async function rotateProductTokenAction(projectId: string) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "settings.manage");
    const token = await rotatePushToken(projectId, ctx.user.id);
    void logAudit("knowledge.product_token_rotated", { actor: ctx.user, projectId });
    return { token };
  });
}

export async function disconnectStreamAction(projectId: string) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "prompts.manage");
    await disconnectStream(projectId);
    void logAudit("knowledge.product_stream_disconnected", { actor: ctx.user, projectId });
    return true;
  });
}

export async function clearCatalogAction(projectId: string) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "prompts.manage");
    await clearCatalog(projectId);
    void logAudit("knowledge.catalog_cleared", { actor: ctx.user, projectId });
    return true;
  });
}

export async function listProductsAction(projectId: string, q: string, offset: number) {
  return runAction(async () => {
    await actionProject(projectId);
    return listProducts(projectId, { q: z.string().max(200).parse(q) || undefined, offset: z.number().int().min(0).parse(offset), limit: 100 });
  });
}

/* ───────────────────────────── Project context ───────────────────────────── */

export async function saveContextNoteAction(projectId: string, input: z.input<typeof contextNoteInput>) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "prompts.manage");
    return upsertContextNote(projectId, contextNoteInput.parse(input), { kind: "user", userId: ctx.user.id });
  });
}

export async function deleteContextNoteAction(projectId: string, id: string) {
  return runAction(async () => {
    await actionProject(projectId, "prompts.manage");
    await deleteContextNote(projectId, z.string().parse(id));
    return true;
  });
}
