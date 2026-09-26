"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { actionProject, ActionError, runAction } from "@/server/auth/guards";
import { logAudit } from "@/server/audit";
import {
  createCompetitor,
  dismissBrandSuggestion,
  removeCompetitor,
  setCompetitorTracked,
  updateCompetitor,
} from "@/server/ai/insights/competitor-admin";
import { getAnswerDetail } from "@/server/ai/insights/answers";
import { getAdDetail } from "@/server/ai/insights/ads";
import { parseInsightFilter } from "@/server/ai/insights/filters";
import { createDemoProjectWithinLimit } from "@/server/ai/demo/create";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { CHECKLIST_STEPS } from "@/server/ai/insights/dashboard";
import { eq } from "drizzle-orm";

const idSchema = z.string().trim().min(1).max(64).regex(/^[a-z0-9_-]+$/i);

const competitorSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  domain: z.string().trim().max(253).optional().nullable(),
  aliases: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  tracked: z.boolean().optional(),
});

export async function createCompetitorAction(projectId: string, input: z.input<typeof competitorSchema>) {
  return runAction(async () => {
    const ctx = await actionProject(idSchema.parse(projectId), "prompts.manage");
    const data = competitorSchema.parse(input);
    const row = await createCompetitor(ctx.project.id, { ...data, source: "manual" }).catch((e: unknown) => {
      throw new ActionError(e instanceof Error ? e.message : "Could not add competitor.", "invalid");
    });
    void logAudit("competitor.created", { actor: ctx.user, targetType: "competitor", targetId: row.id, projectId: ctx.project.id, workspaceId: ctx.project.workspaceId, meta: { name: row.name } });
    refresh();
    return { id: row.id };
  });
}

export async function updateCompetitorAction(projectId: string, competitorId: string, input: z.input<typeof competitorSchema>) {
  return runAction(async () => {
    const ctx = await actionProject(idSchema.parse(projectId), "prompts.manage");
    const data = competitorSchema.parse(input);
    const row = await updateCompetitor(ctx.project.id, idSchema.parse(competitorId), data).catch((e: unknown) => {
      throw new ActionError(e instanceof Error ? e.message : "Could not update competitor.", "invalid");
    });
    void logAudit("competitor.updated", { actor: ctx.user, targetType: "competitor", targetId: row.id, projectId: ctx.project.id, workspaceId: ctx.project.workspaceId, meta: { name: row.name } });
    refresh();
    return { id: row.id };
  });
}

export async function setCompetitorTrackedAction(projectId: string, competitorId: string, tracked: boolean) {
  return runAction(async () => {
    const ctx = await actionProject(idSchema.parse(projectId), "prompts.manage");
    await setCompetitorTracked(ctx.project.id, idSchema.parse(competitorId), z.boolean().parse(tracked)).catch((e: unknown) => {
      throw new ActionError(e instanceof Error ? e.message : "Could not update competitor.", "not_found");
    });
    refresh();
    return true;
  });
}

export async function removeCompetitorAction(projectId: string, competitorId: string) {
  return runAction(async () => {
    const ctx = await actionProject(idSchema.parse(projectId), "prompts.manage");
    const row = await removeCompetitor(ctx.project.id, idSchema.parse(competitorId)).catch((e: unknown) => {
      throw new ActionError(e instanceof Error ? e.message : "Could not remove competitor.", "not_found");
    });
    void logAudit("competitor.removed", { actor: ctx.user, targetType: "competitor", targetId: row.id, projectId: ctx.project.id, workspaceId: ctx.project.workspaceId, meta: { name: row.name } });
    refresh();
    return true;
  });
}

const suggestionSchema = z.string().trim().min(1).max(80);

export async function acceptSuggestionAction(projectId: string, name: string) {
  return runAction(async () => {
    const ctx = await actionProject(idSchema.parse(projectId), "prompts.manage");
    const row = await createCompetitor(ctx.project.id, { name: suggestionSchema.parse(name), source: "auto", tracked: true }).catch((e: unknown) => {
      throw new ActionError(e instanceof Error ? e.message : "Could not add competitor.", "invalid");
    });
    void logAudit("competitor.created", { actor: ctx.user, targetType: "competitor", targetId: row.id, projectId: ctx.project.id, workspaceId: ctx.project.workspaceId, meta: { name: row.name, from: "suggestion" } });
    refresh();
    return { id: row.id };
  });
}

export async function dismissSuggestionAction(projectId: string, name: string) {
  return runAction(async () => {
    const ctx = await actionProject(idSchema.parse(projectId), "prompts.manage");
    await dismissBrandSuggestion(ctx.project.id, suggestionSchema.parse(name));
    refresh();
    return true;
  });
}

export async function getAnswerAction(projectId: string, answerId: string) {
  return runAction(async () => {
    const ctx = await actionProject(idSchema.parse(projectId), "project.view");
    const detail = await getAnswerDetail(ctx.project.id, idSchema.parse(answerId));
    if (!detail) throw new ActionError("Answer not found.", "not_found");
    return detail;
  });
}

const filterSchema = z
  .object({
    period: z.string().max(10).optional(),
    from: z.string().max(10).optional(),
    to: z.string().max(10).optional(),
    models: z.string().max(400).optional(),
    tags: z.string().max(2000).optional(),
  })
  .partial();

export async function getAdDetailAction(projectId: string, adId: string, filters: z.input<typeof filterSchema> = {}) {
  return runAction(async () => {
    const ctx = await actionProject(idSchema.parse(projectId), "project.view");
    const f = parseInsightFilter(ctx.project.id, filterSchema.parse(filters));
    const detail = await getAdDetail(ctx.project, f, idSchema.parse(adId));
    if (!detail) throw new ActionError("Ad not found.", "not_found");
    return detail;
  });
}

/** Creates a clearly labelled "Demo · …" project with generated sample data in the same workspace. */
export async function createDemoProjectAction(projectId: string) {
  return runAction(async () => {
    const ctx = await actionProject(idSchema.parse(projectId), "projects.manage");
    return createDemoProjectWithinLimit(ctx.project.workspaceId, ctx.user);
  });
}

/** "Skip for now" / "Restore" for a dashboard setup-checklist step (per user and project). */
export async function setChecklistStepSkippedAction(projectId: string, step: string, skipped: boolean) {
  return runAction(async () => {
    const ctx = await actionProject(idSchema.parse(projectId), "project.view");
    const key = z.enum(CHECKLIST_STEPS).parse(step);
    const flag = z.boolean().parse(skipped);
    const [row] = await db.select({ preferences: users.preferences }).from(users).where(eq(users.id, ctx.user.id)).limit(1);
    const prefs = { ...((row?.preferences as Record<string, unknown> | null) ?? {}) };
    const dash = { ...((prefs.dashboard as Record<string, unknown> | undefined) ?? {}) };
    const skippedMap = { ...((dash.skipped as Record<string, string[]> | undefined) ?? {}) };
    const current = new Set(Array.isArray(skippedMap[ctx.project.id]) ? skippedMap[ctx.project.id] : []);
    if (flag) current.add(key);
    else current.delete(key);
    skippedMap[ctx.project.id] = [...current];
    await db
      .update(users)
      .set({ preferences: { ...prefs, dashboard: { ...dash, skipped: skippedMap } } })
      .where(eq(users.id, ctx.user.id));
    refresh();
    return true;
  });
}
