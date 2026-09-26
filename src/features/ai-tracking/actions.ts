"use server";

import { refresh } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { aiAnswers, projects } from "@/server/db/schema";
import { actionProject, ActionError, runAction } from "@/server/auth/guards";
import { logAudit } from "@/server/audit";
import { enqueueJob } from "@/server/jobs/queue";
import { ENGINES, getEngine } from "@/lib/engines";
import { getCountry } from "@/lib/countries";
import {
  addTrackedPrompts,
  applyPromptTags,
  deletePrompts,
  parsePromptCsv,
  setPromptStatus,
} from "@/server/ai/tracking/prompts";
import { isDemoProject, startTrackingRun, TrackingError } from "@/server/ai/tracking/runs";
import { getAnswerDetail, listPromptAnswers } from "@/server/ai/metrics";
import type { AnswerDetail, AnswerListItem } from "./types";

const id = z.string().min(3).max(64);
const ids = z.array(id).min(1).max(1000);
const engineId = z.string().refine((e) => !!getEngine(e), "Unknown engine");
const country = z.string().refine((c) => !!getCountry(c), "Unknown country");
const tagName = z.string().trim().min(1).max(60);

function wrapTracking<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((err) => {
    if (err instanceof TrackingError) throw new ActionError(err.message, "invalid");
    throw err;
  });
}

async function runForPrompts(projectId: string, promptIds: string[], userId: string) {
  if (!promptIds.length) return null;
  try {
    return await startTrackingRun({ projectId, trigger: "prompt_added", promptIds, userId });
  } catch (err) {
    if (err instanceof TrackingError) return null;
    throw err;
  }
}

/* ─────────────────────────── Prompts ─────────────────────────── */

const addSchema = z.object({
  texts: z.array(z.string().trim().min(3).max(2000)).min(1).max(200),
  country,
  tags: z.array(tagName).max(20).default([]),
  /** null = all engines enabled for the project */
  engines: z.array(engineId).max(ENGINES.length).nullable().default(null),
});

export async function addPromptsAction(projectId: string, input: z.input<typeof addSchema>) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "prompts.manage");
    const data = addSchema.parse(input);
    const res = await wrapTracking(() =>
      addTrackedPrompts({
        projectId,
        prompts: data.texts.map((text) => ({ text, country: data.country, tags: data.tags })),
        engines: data.engines,
        source: "manual",
        userId: ctx.user.id,
      }),
    );
    const run = await runForPrompts(projectId, res.created, ctx.user.id);
    void logAudit("prompts.added", {
      actor: { id: ctx.user.id, email: ctx.user.email },
      targetType: "project",
      targetId: projectId,
      projectId,
      workspaceId: ctx.project.workspaceId,
      meta: { count: res.created.length },
    });
    refresh();
    return { ...res, run: run ? { tasks: run.tasks, status: run.status, error: run.error } : null };
  });
}

export async function importPromptsCsvAction(projectId: string, csv: string) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "prompts.manage");
    if (csv.length > 2_000_000) throw new ActionError("The file is too large (max 2 MB).", "invalid");
    const rows = parsePromptCsv(csv, ctx.project.country).filter((r) => !r.error);
    if (!rows.length) throw new ActionError("No valid rows found. Expected columns: prompt, tags, country.", "invalid");
    if (rows.length > 1000) throw new ActionError("Import at most 1000 prompts at once.", "invalid");
    const res = await wrapTracking(() =>
      addTrackedPrompts({
        projectId,
        prompts: rows.map((r) => ({ text: r.text, country: r.country, tags: r.tags })),
        source: "import",
        userId: ctx.user.id,
      }),
    );
    const run = await runForPrompts(projectId, res.created, ctx.user.id);
    void logAudit("prompts.imported", {
      actor: { id: ctx.user.id, email: ctx.user.email },
      targetType: "project",
      targetId: projectId,
      projectId,
      workspaceId: ctx.project.workspaceId,
      meta: { count: res.created.length },
    });
    refresh();
    return { ...res, run: run ? { tasks: run.tasks, status: run.status, error: run.error } : null };
  });
}

export async function setPromptsArchivedAction(projectId: string, promptIds: string[], archived: boolean) {
  return runAction(async () => {
    await actionProject(projectId, "prompts.manage");
    const n = await wrapTracking(() => setPromptStatus(projectId, ids.parse(promptIds), archived ? "archived" : "active"));
    refresh();
    return { updated: n };
  });
}

export async function deletePromptsAction(projectId: string, promptIds: string[]) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "prompts.manage");
    const n = await deletePrompts(projectId, ids.parse(promptIds));
    void logAudit("prompts.deleted", {
      actor: { id: ctx.user.id, email: ctx.user.email },
      targetType: "project",
      targetId: projectId,
      projectId,
      workspaceId: ctx.project.workspaceId,
      meta: { count: n },
    });
    refresh();
    return { deleted: n };
  });
}

export async function applyTagsAction(projectId: string, promptIds: string[], tagNames: string[], mode: "add" | "clear" | "set") {
  return runAction(async () => {
    await actionProject(projectId, "prompts.manage");
    const m = z.enum(["add", "clear", "set"]).parse(mode);
    const names = z.array(tagName).max(20).parse(tagNames);
    if (m !== "clear" && !names.length) throw new ActionError("Choose at least one tag.", "invalid");
    const n = await applyPromptTags(projectId, ids.parse(promptIds), names, m);
    refresh();
    return { updated: n };
  });
}

/* ─────────────────────────── Runs & analysis ─────────────────────────── */

export async function runNowAction(projectId: string, promptIds?: string[]) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "prompts.manage");
    const scoped = promptIds?.length ? ids.parse(promptIds) : undefined;
    const run = await wrapTracking(() => startTrackingRun({ projectId, trigger: "manual", promptIds: scoped, userId: ctx.user.id }));
    refresh();
    if (run.status === "failed") throw new ActionError(run.error ?? "The run could not start.", "invalid");
    return { runId: run.runId, tasks: run.tasks, skipped: run.skipped };
  });
}

export async function reanalyzePromptAction(projectId: string, promptId: string) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "prompts.manage");
    if (isDemoProject(ctx.project)) throw new ActionError("Demo projects contain generated sample data and are not re-analyzed.", "invalid");
    const answers = await db
      .select({ id: aiAnswers.id })
      .from(aiAnswers)
      .where(and(eq(aiAnswers.projectId, projectId), eq(aiAnswers.promptId, id.parse(promptId)), eq(aiAnswers.status, "ok")));
    for (const a of answers) {
      await enqueueJob("ai.analyze", { answerId: a.id }, { projectId, dedupeKey: `ai.analyze:${a.id}`, maxAttempts: 2 });
    }
    if (answers.length) {
      await db.update(aiAnswers).set({ analysisStatus: "pending" }).where(inArray(aiAnswers.id, answers.map((a) => a.id)));
    }
    refresh();
    return { queued: answers.length };
  });
}

/* ─────────────────────────── Response drawer (reads) ─────────────────────────── */

export async function loadPromptAnswersAction(projectId: string, promptId: string) {
  return runAction<AnswerListItem[]>(async () => {
    await actionProject(projectId, "project.view");
    return listPromptAnswers(projectId, id.parse(promptId));
  });
}

export async function loadAnswerDetailAction(projectId: string, answerId: string) {
  return runAction<AnswerDetail>(async () => {
    await actionProject(projectId, "project.view");
    const detail = await getAnswerDetail(projectId, id.parse(answerId));
    if (!detail) throw new ActionError("Answer not found.", "not_found");
    return detail;
  });
}

/* ─────────────────────────── Model settings ─────────────────────────── */

const modelSettingsSchema = z.object({
  engines: z.array(engineId).max(ENGINES.length).optional(),
  trackingFrequency: z.enum(["daily", "weekly", "monthly", "paused"]).optional(),
  country: country.optional(),
  language: z.string().min(2).max(8).optional(),
});

export async function updateModelSettingsAction(projectId: string, input: z.input<typeof modelSettingsSchema>) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "prompts.manage");
    const data = modelSettingsSchema.parse(input);
    // Engines and tracking frequency drive paid spend → project/settings managers only.
    if ((data.engines || data.trackingFrequency) && !(ctx.isInstanceAdmin || ctx.permissions.has("projects.manage") || ctx.permissions.has("settings.manage"))) {
      throw new ActionError("Only project or settings managers can change AI models and the tracking frequency.", "forbidden");
    }
    const patch: Partial<typeof projects.$inferInsert> = {};
    if (data.engines) patch.engines = [...new Set(data.engines)];
    if (data.trackingFrequency) patch.trackingFrequency = data.trackingFrequency;
    if (data.country) patch.country = getCountry(data.country)!.iso;
    if (data.language) patch.language = data.language;
    if (!Object.keys(patch).length) return { ok: true };
    await db.update(projects).set(patch).where(eq(projects.id, projectId));
    void logAudit("project.model_settings", {
      actor: { id: ctx.user.id, email: ctx.user.email },
      targetType: "project",
      targetId: projectId,
      projectId,
      workspaceId: ctx.project.workspaceId,
      meta: data,
    });
    refresh();
    return { ok: true };
  });
}
