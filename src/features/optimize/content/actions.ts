"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { contentPersonas, contentPieces, optimizeTasks, CONTENT_STATUSES } from "@/server/db/schema";
import { actionProject, ActionError, runAction } from "@/server/auth/guards";
import { availableLlmProviders } from "@/server/ai/llm";
import { parsePublicUrl, UnsafeUrlError } from "@/server/optimize/net";
import {
  contentJobState,
  createContent,
  deleteContent,
  getContent,
  listPersonas,
  saveContent,
} from "@/server/optimize/content/service";
import { enqueueContentGeneration, enqueuePersonaGeneration, enqueueUrlOptimization } from "@/server/optimize/content/jobs";
import { insertLibraryPersonas } from "@/server/optimize/content/personas";
import { extractEntities, generateFaqs, generateMeta } from "@/server/optimize/content/assist";
import { addTaskActivity } from "@/server/optimize/tasks/activity";

const pid = z.string().min(1).max(64);
const cid = z.string().min(1).max(64);

async function hasAi() {
  return (await availableLlmProviders().catch(() => [])).length > 0;
}

async function assertPersonaInProject(projectId: string, personaId: string) {
  const [p] = await db
    .select({ id: contentPersonas.id })
    .from(contentPersonas)
    .where(and(eq(contentPersonas.id, personaId), eq(contentPersonas.projectId, projectId)))
    .limit(1);
  if (!p) throw new ActionError("Persona not found.", "not_found");
}

const NO_AI = "No AI provider is available. Connect a local agent (Local Agents) or add an API key in Admin → AI Providers.";

const generateSchema = z.object({
  target: z.string().trim().min(3, "Enter a topic or question").max(400),
  keyword: z.string().trim().max(120).optional().default(""),
  contentType: z.enum(["article", "guide", "comparison", "listicle", "how-to", "faq", "product"]).default("article"),
  wordCount: z.number().int().min(400).max(4000).default(1500),
  personaId: z.string().max(64).nullable().default(null),
  language: z.string().min(2).max(8).optional(),
  includeFaq: z.boolean().default(true),
  tone: z.string().max(120).optional().default(""),
  instructions: z.string().max(2000).optional().default(""),
});

export async function generateContentAction(projectId: string, input: z.input<typeof generateSchema>) {
  return runAction(async () => {
    const ctx = await actionProject(pid.parse(projectId), "prompts.manage");
    const data = generateSchema.parse(input);
    if (!(await hasAi())) throw new ActionError(NO_AI, "invalid");
    if (data.personaId) await assertPersonaInProject(ctx.project.id, data.personaId);
    const row = await createContent(
      ctx.project.id,
      {
        title: data.target,
        status: "generating",
        targetPrompt: data.target,
        targetKeyword: data.keyword || null,
        topic: data.keyword || data.target,
        language: data.language ?? ctx.project.language,
        personaId: data.personaId,
        generationStage: "queued",
        brief: { wordCount: data.wordCount },
      },
      ctx.user.id,
    );
    await enqueueContentGeneration(
      ctx.project.id,
      row.id,
      { contentType: data.contentType, wordCount: data.wordCount, includeFaq: data.includeFaq, tone: data.tone || undefined, instructions: data.instructions || undefined },
      ctx.user.id,
    );
    return { id: row.id };
  });
}

export async function createBlankContentAction(projectId: string, input: { title: string; targetPrompt?: string; keyword?: string }) {
  return runAction(async () => {
    const ctx = await actionProject(pid.parse(projectId), "prompts.manage");
    const data = z
      .object({ title: z.string().trim().min(3).max(300), targetPrompt: z.string().trim().max(400).optional(), keyword: z.string().trim().max(120).optional() })
      .parse(input);
    const row = await createContent(
      ctx.project.id,
      { title: data.title, targetPrompt: data.targetPrompt || null, targetKeyword: data.keyword || null, language: ctx.project.language },
      ctx.user.id,
    );
    return { id: row.id };
  });
}

const optimizeSchema = z.object({
  url: z.string().trim().min(4).max(2000),
  keyword: z.string().trim().max(120).optional().default(""),
  targetPrompt: z.string().trim().max(400).optional().default(""),
  rewrite: z.boolean().default(true),
});

export async function optimizeUrlAction(projectId: string, input: z.input<typeof optimizeSchema>) {
  return runAction(async () => {
    const ctx = await actionProject(pid.parse(projectId), "prompts.manage");
    const data = optimizeSchema.parse(input);
    let url: URL;
    try {
      url = parsePublicUrl(/^https?:\/\//i.test(data.url) ? data.url : `https://${data.url}`);
    } catch (err) {
      throw new ActionError(err instanceof UnsafeUrlError ? err.message : "Enter a valid public URL.", "invalid");
    }
    const row = await createContent(
      ctx.project.id,
      {
        title: url.hostname + url.pathname,
        kind: "rewrite",
        status: "generating",
        sourceUrl: url.toString(),
        targetKeyword: data.keyword || null,
        targetPrompt: data.targetPrompt || null,
        language: ctx.project.language,
        generationStage: "queued",
      },
      ctx.user.id,
    );
    await enqueueUrlOptimization(ctx.project.id, row.id, data.rewrite, ctx.user.id);
    return { id: row.id, rewrite: data.rewrite && (await hasAi()) };
  });
}

export async function createContentFromTaskAction(projectId: string, taskId: string) {
  return runAction(async () => {
    const ctx = await actionProject(pid.parse(projectId), "prompts.manage");
    const [task] = await db
      .select()
      .from(optimizeTasks)
      .where(and(eq(optimizeTasks.projectId, ctx.project.id), eq(optimizeTasks.id, z.string().max(64).parse(taskId))))
      .limit(1);
    if (!task) throw new ActionError("Task not found.", "not_found");
    const plan = task.contentPlan ?? {};
    const target = plan.targetPrompt ?? task.targetPrompts[0] ?? plan.workingTitle ?? task.title;
    const ai = await hasAi();
    const outline = plan.outline ?? [];
    const row = await createContent(
      ctx.project.id,
      {
        title: plan.workingTitle ?? target,
        status: ai ? "generating" : "draft",
        targetPrompt: target,
        targetKeyword: plan.targetKeyword ?? null,
        topic: plan.targetKeyword ?? target,
        language: ctx.project.language,
        taskId: task.id,
        generationStage: ai ? "queued" : null,
        brief: {
          outline,
          questions: plan.questions ?? [],
          entities: plan.entities ?? [],
          wordCount: plan.wordCount ?? 1500,
          notes: plan.notes,
          angle: plan.format,
        },
        body: ai ? "" : outline.map((h) => `## ${h}\n\n`).join(""),
      },
      ctx.user.id,
    );
    if (ai) await enqueueContentGeneration(ctx.project.id, row.id, { contentType: plan.format ?? "article", wordCount: plan.wordCount ?? 1500, includeFaq: true }, ctx.user.id);
    await addTaskActivity({ taskId: task.id, projectId: ctx.project.id, kind: "edited", userId: ctx.user.id, body: `Content draft created: ${row.title}`, meta: { contentId: row.id } });
    return { id: row.id, generating: ai };
  });
}

const faqSchema = z.object({ question: z.string().max(500), answer: z.string().max(3000) });
const entitySchema = z.object({ name: z.string().max(200), type: z.string().max(80).optional(), sameAs: z.string().max(500).nullable().optional(), mentions: z.number().optional() });
const citationSchema = z.object({ url: z.string().max(2000), title: z.string().max(500).nullable().optional(), note: z.string().max(1000).nullable().optional() });

const patchSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  body: z.string().max(400_000).optional(),
  status: z.enum(CONTENT_STATUSES).exclude(["generating"]).optional(),
  targetPrompt: z.string().trim().max(400).nullable().optional(),
  targetKeyword: z.string().trim().max(120).nullable().optional(),
  metaTitle: z.string().max(300).nullable().optional(),
  metaDescription: z.string().max(600).nullable().optional(),
  slug: z.string().max(200).nullable().optional(),
  schemaJsonLd: z.string().max(100_000).nullable().optional(),
  faqs: z.array(faqSchema).max(30).optional(),
  entities: z.array(entitySchema).max(60).optional(),
  citations: z.array(citationSchema).max(60).optional(),
  personaId: z.string().max(64).nullable().optional(),
});

export async function saveContentAction(projectId: string, contentId: string, patch: z.input<typeof patchSchema>) {
  return runAction(async () => {
    const ctx = await actionProject(pid.parse(projectId), "prompts.manage");
    const data = patchSchema.parse(patch);
    if (data.personaId) await assertPersonaInProject(ctx.project.id, data.personaId);
    return saveContent(ctx.project.id, cid.parse(contentId), data, ctx.user.id);
  });
}

export async function deleteContentAction(projectId: string, ids: string[]) {
  return runAction(async () => {
    const ctx = await actionProject(pid.parse(projectId), "prompts.manage");
    await deleteContent(ctx.project.id, z.array(cid).min(1).max(200).parse(ids));
    return true;
  });
}

export async function retryContentAction(projectId: string, contentId: string) {
  return runAction(async () => {
    const ctx = await actionProject(pid.parse(projectId), "prompts.manage");
    const row = await getContent(ctx.project.id, cid.parse(contentId));
    if (!row) throw new ActionError("Content not found.", "not_found");
    if (row.status === "generating") return true;
    if (row.kind === "rewrite" && row.sourceUrl) {
      await db.update(contentPieces).set({ status: "generating", generationStage: "queued", error: null }).where(eq(contentPieces.id, row.id));
      await enqueueUrlOptimization(ctx.project.id, row.id, true, ctx.user.id);
    } else {
      if (!(await hasAi())) throw new ActionError(NO_AI, "invalid");
      await db.update(contentPieces).set({ status: "generating", generationStage: "queued", error: null }).where(eq(contentPieces.id, row.id));
      await enqueueContentGeneration(ctx.project.id, row.id, { wordCount: row.brief?.wordCount ?? 1500 }, ctx.user.id);
    }
    return true;
  });
}

export async function contentStateAction(projectId: string, contentId: string) {
  return runAction(async () => {
    const ctx = await actionProject(pid.parse(projectId));
    return contentJobState(ctx.project.id, cid.parse(contentId));
  });
}

const assistInput = z.object({
  title: z.string().max(300),
  body: z.string().min(20, "Write some content first").max(400_000),
  targetPrompt: z.string().max(400).nullable().optional(),
  targetKeyword: z.string().max(120).nullable().optional(),
});

export async function assistContentAction(projectId: string, kind: "faqs" | "entities" | "meta", input: z.input<typeof assistInput>) {
  return runAction(async () => {
    const ctx = await actionProject(pid.parse(projectId), "prompts.manage");
    const data = assistInput.parse(input);
    const c = { projectId: ctx.project.id, workspaceId: ctx.project.workspaceId, language: ctx.project.language };
    const k = z.enum(["faqs", "entities", "meta"]).parse(kind);
    if (k === "faqs") return { kind: k, ...(await generateFaqs({ title: data.title, body: data.body, targetPrompt: data.targetPrompt ?? null }, c)) };
    if (k === "entities") return { kind: k, ...(await extractEntities({ title: data.title, body: data.body }, c)) };
    return { kind: k, ...(await generateMeta({ title: data.title, body: data.body, targetKeyword: data.targetKeyword ?? null, targetPrompt: data.targetPrompt ?? null }, c)) };
  });
}

/* ─────────────── Personas ─────────────── */

export async function listPersonasAction(projectId: string) {
  return runAction(async () => {
    const ctx = await actionProject(pid.parse(projectId));
    return listPersonas(ctx.project.id);
  });
}

export async function generatePersonasAction(projectId: string, topic: string) {
  return runAction(async () => {
    const ctx = await actionProject(pid.parse(projectId), "prompts.manage");
    const t = z.string().trim().min(2, "Enter a topic").max(120).parse(topic);
    if (await hasAi()) {
      await enqueuePersonaGeneration(ctx.project.id, t, ctx.user.id);
      return { mode: "queued" as const, created: 0 };
    }
    const created = await insertLibraryPersonas(ctx.project.id, t);
    return { mode: "library" as const, created };
  });
}

const personaSchema = z.object({
  topic: z.string().trim().min(2).max(120),
  name: z.string().trim().min(2).max(80),
  role: z.string().trim().min(2).max(120),
  expertise: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
  bio: z.string().trim().max(600).default(""),
  voice: z.string().trim().max(400).default(""),
  credentials: z.string().trim().max(300).optional(),
});

export async function createPersonaAction(projectId: string, input: z.input<typeof personaSchema>) {
  return runAction(async () => {
    const ctx = await actionProject(pid.parse(projectId), "prompts.manage");
    const data = personaSchema.parse(input);
    const [row] = await db
      .insert(contentPersonas)
      .values({ ...data, credentials: data.credentials || null, projectId: ctx.project.id, source: "manual" })
      .returning();
    return row!;
  });
}

export async function deletePersonaAction(projectId: string, personaId: string) {
  return runAction(async () => {
    const ctx = await actionProject(pid.parse(projectId), "prompts.manage");
    await db.delete(contentPersonas).where(and(eq(contentPersonas.projectId, ctx.project.id), eq(contentPersonas.id, z.string().max(64).parse(personaId))));
    return true;
  });
}
