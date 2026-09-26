import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { optimizeTasks, projects } from "@/server/db/schema";
import { newId } from "@/server/db/schema/_helpers";
import { AiNotConfiguredError, availableLlmProviders, runLlm } from "@/server/ai/llm";
import type { TaskContentPlan, TaskEvidence } from "@/server/db/schema";
import { TASK_CATEGORY_META, type TaskCategoryKey } from "@/features/optimize/constants";

export const TASKS_WRITE_JOB = "optimize.tasks.write";

export type WriterInput = {
  key: string;
  category: TaskCategoryKey;
  title: string;
  summary: string;
  steps: string[];
  acceptanceCriteria: string[];
  contentPlan: TaskContentPlan | null;
  evidence: TaskEvidence[];
  data: Record<string, unknown>;
};

export type WriterOutput = {
  key: string;
  title: string;
  summary: string;
  description: string;
  steps: string[];
  acceptanceCriteria: string[];
  contentPlan: TaskContentPlan | null;
};

const contentPlanSchema = z.object({
  format: z.string(),
  workingTitle: z.string(),
  targetPrompt: z.string(),
  targetKeyword: z.string(),
  wordCount: z.number(),
  outline: z.array(z.string()),
  questions: z.array(z.string()),
  entities: z.array(z.string()),
  schemaTypes: z.array(z.string()),
  notes: z.string(),
});

const schema = z.object({
  tasks: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      summary: z.string(),
      description: z.string(),
      steps: z.array(z.string()),
      acceptanceCriteria: z.array(z.string()),
      contentPlan: contentPlanSchema.nullable(),
    }),
  ),
});

const SYSTEM = `You are a senior GEO/AEO strategist (generative/answer engine optimization). You turn analytics findings into
concrete, evidence-backed tasks for a marketing/web team. Rules:
- Never invent numbers, URLs, brands or facts that are not in the provided evidence.
- Title: imperative, specific, max 80 characters, no trailing period.
- Summary: one sentence with the key numbers from the evidence.
- Description: 2–4 sentences of markdown explaining why this matters and what the evidence shows (bold the key entity).
- Steps: 3–6 concrete, numbered-in-order actions (no numbering prefix), each doable by the owner of the category.
- Acceptance criteria: 2–3 measurable conditions that tell us the fix is live (these are re-checked automatically).
- Content plan: only for tasks that require creating/updating content (content, visibility, competitor); otherwise null.
  Outline items are H2-level section titles; questions are follow-up questions to answer; keep entities to real names from the evidence.`;

function evidenceDigest(evidence: TaskEvidence[]): string {
  return evidence
    .map((e) => {
      const items = (e.items ?? [])
        .slice(0, 6)
        .map((i) => `  - ${i.label}${i.value != null ? `: ${i.value}` : ""}${i.detail ? ` (${i.detail})` : ""}${i.href ? ` <${i.href}>` : ""}`)
        .join("\n");
      return `* ${e.label}${e.value ? `: ${e.value}` : ""}${e.description ? ` — ${e.description}` : ""}${items ? `\n${items}` : ""}`;
    })
    .join("\n");
}

/** True when an AI provider is usable right now (skip writing otherwise). */
export async function canWriteWithAi(): Promise<boolean> {
  return (await availableLlmProviders().catch(() => [])).length > 0;
}

/**
 * Rewrites templated task texts with the LLM (batches of 4). Returns only the tasks that were written;
 * callers keep the templated text for the rest.
 */
export async function writeTasksWithAi(
  inputs: WriterInput[],
  ctx: { projectId: string; workspaceId: string; brand: string; domain: string; language: string },
): Promise<WriterOutput[]> {
  const out: WriterOutput[] = [];
  for (let i = 0; i < inputs.length; i += 4) {
    const batch = inputs.slice(i, i + 4);
    const prompt = `Brand: ${ctx.brand} (${ctx.domain}). Write the following ${batch.length} task(s).

${batch
  .map(
    (t) => `### Task key: ${t.key}
Category: ${TASK_CATEGORY_META[t.category].label} (owner: ${TASK_CATEGORY_META[t.category].owner})
Draft title: ${t.title}
Draft summary: ${t.summary}
Facts: ${JSON.stringify(t.data).slice(0, 1800)}
Evidence:
${evidenceDigest(t.evidence)}
Draft steps: ${t.steps.map((s, n) => `${n + 1}. ${s}`).join(" ")}
Draft acceptance criteria: ${t.acceptanceCriteria.join(" | ")}
Draft content plan: ${t.contentPlan ? JSON.stringify(t.contentPlan).slice(0, 1200) : "none"}`,
  )
  .join("\n\n")}

Return every task with the same "key".`;
    try {
      const res = await runLlm({
        purpose: "tasks.write",
        system: SYSTEM,
        prompt,
        schema,
        effort: "low",
        maxTokens: 6000,
        projectId: ctx.projectId,
        workspaceId: ctx.workspaceId,
      });
      for (const t of res.data.tasks) {
        const input = batch.find((b) => b.key === t.key);
        if (!input || !t.title.trim() || !t.steps.length) continue;
        out.push({
          key: t.key,
          title: t.title.trim().replace(/\.$/, "").slice(0, 140),
          summary: t.summary.trim().slice(0, 400),
          description: t.description.trim().slice(0, 4000),
          steps: t.steps.map((s) => s.replace(/^\d+[.)]\s*/, "").trim()).filter(Boolean).slice(0, 8),
          acceptanceCriteria: t.acceptanceCriteria.map((s) => s.trim()).filter(Boolean).slice(0, 5),
          contentPlan: input.contentPlan || t.contentPlan ? { ...(input.contentPlan ?? {}), ...cleanPlan(t.contentPlan) } : null,
        });
      }
    } catch (err) {
      if (err instanceof AiNotConfiguredError) break;
      console.error("[optimize] task writer batch failed", err instanceof Error ? err.message : err);
    }
  }
  return out;
}

function cleanPlan(plan: z.infer<typeof contentPlanSchema> | null): TaskContentPlan {
  if (!plan) return {};
  const out: TaskContentPlan = {};
  if (plan.format) out.format = plan.format;
  if (plan.workingTitle) out.workingTitle = plan.workingTitle;
  if (plan.targetPrompt) out.targetPrompt = plan.targetPrompt;
  if (plan.targetKeyword) out.targetKeyword = plan.targetKeyword;
  if (plan.wordCount > 0) out.wordCount = Math.round(plan.wordCount);
  if (plan.outline?.length) out.outline = plan.outline.slice(0, 12);
  if (plan.questions?.length) out.questions = plan.questions.slice(0, 12);
  if (plan.entities?.length) out.entities = plan.entities.slice(0, 12);
  if (plan.schemaTypes?.length) out.schemaTypes = plan.schemaTypes.slice(0, 6);
  if (plan.notes) out.notes = plan.notes;
  return out;
}

/** Background job body: rewrites the given tasks' templated texts with the LLM. */
export async function writePendingTasks(projectId: string, taskIds: string[]): Promise<{ written: number }> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project || !taskIds.length) return { written: 0 };
  const rows = await db
    .select()
    .from(optimizeTasks)
    .where(and(eq(optimizeTasks.projectId, projectId), inArray(optimizeTasks.id, taskIds)));
  const todo = rows
    .filter((t) => t.writtenBy !== "user" && (t.writtenBy === "template" || t.writtenHash !== t.signalHash))
    .sort((a, b) => b.priority - a.priority);
  if (!todo.length) return { written: 0 };
  const inputs: WriterInput[] = todo.map((t) => ({
    key: t.id,
    category: t.category,
    title: t.title,
    summary: t.summary,
    steps: t.steps.map((s) => s.text),
    acceptanceCriteria: t.acceptanceCriteria,
    contentPlan: t.contentPlan,
    evidence: t.evidence,
    data: t.signalData,
  }));
  const written = await writeTasksWithAi(inputs, {
    projectId,
    workspaceId: project.workspaceId,
    brand: project.name,
    domain: project.domain,
    language: project.language,
  });
  let n = 0;
  for (const w of written) {
    const t = todo.find((x) => x.id === w.key);
    if (!t) continue;
    const steps = w.steps.map((text) => {
      const prev = t.steps.find((p) => p.text.trim().toLowerCase() === text.trim().toLowerCase());
      return { id: prev?.id ?? newId("stp").slice(4), text, done: prev?.done ?? false };
    });
    // Skip if a teammate edited the task meanwhile.
    const [fresh] = await db.select({ writtenBy: optimizeTasks.writtenBy }).from(optimizeTasks).where(eq(optimizeTasks.id, t.id)).limit(1);
    if (!fresh || fresh.writtenBy === "user") continue;
    await db
      .update(optimizeTasks)
      .set({
        title: w.title,
        summary: w.summary,
        description: w.description,
        steps,
        acceptanceCriteria: w.acceptanceCriteria,
        contentPlan: w.contentPlan,
        writtenBy: "ai",
        writtenHash: t.signalHash,
      })
      .where(eq(optimizeTasks.id, t.id));
    n++;
  }
  return { written: n };
}
