"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { prompts } from "@/server/db/schema";
import { actionProject, ActionError, runAction } from "@/server/auth/guards";
import { logAudit } from "@/server/audit";
import { enqueueJob } from "@/server/jobs/queue";
import { getSetting } from "@/server/settings";
import { topCountriesForQueries } from "@/server/analytics/search-console/queries";
import { getCountry } from "@/lib/countries";
import {
  getCachedInspection,
  InspectionError,
  inspectUrl,
  type InspectionErrorCode,
  type InspectUrlResult,
} from "@/server/analytics/search-console/inspection";

const projectIdSchema = z.string().min(3).max(64);
const queriesSchema = z.array(z.string().trim().min(2).max(500)).min(1).max(100);

/** Adds Search Console queries as tracked AI prompts (source "gsc"). Skips case-insensitive duplicates. */
export async function addQueriesAsPromptsAction(projectId: string, queries: string[]) {
  return runAction(async () => {
    const ctx = await actionProject(projectIdSchema.parse(projectId), "prompts.manage");
    const list = [...new Map(queriesSchema.parse(queries).map((q) => [q.toLowerCase(), q])).values()];
    const existing = await db
      .select({ text: prompts.text, status: prompts.status })
      .from(prompts)
      .where(eq(prompts.projectId, ctx.project.id));
    const known = new Set(existing.map((p) => p.text.trim().toLowerCase()));
    const fresh = list.filter((q) => !known.has(q.toLowerCase()));
    if (!fresh.length) return { inserted: 0, skipped: list.length };

    const limits = await getSetting("limits");
    const activeCount = existing.filter((p) => p.status === "active").length;
    if (activeCount + fresh.length > limits.maxPromptsPerProject)
      throw new ActionError(
        `This project can track at most ${limits.maxPromptsPerProject} prompts (currently ${activeCount}).`,
        "invalid",
      );

    const countries = await topCountriesForQueries(ctx.project.id, fresh);
    const toMarket = (iso: string | undefined) => {
      if (!iso) return ctx.project.country;
      const c = getCountry(iso); // accepts GB → UK
      return c?.iso ?? ctx.project.country;
    };
    const inserted = await db
      .insert(prompts)
      .values(
        fresh.map((text) => ({
          projectId: ctx.project.id,
          text,
          country: toMarket(countries.get(text)),
          language: ctx.project.language,
          source: "gsc" as const,
          createdBy: ctx.user.id,
        })),
      )
      .returning({ id: prompts.id });
    await logAudit("prompts.add_from_gsc", {
      actor: { id: ctx.user.id, email: ctx.user.email },
      targetType: "project",
      targetId: ctx.project.id,
      workspaceId: ctx.project.workspaceId,
      projectId: ctx.project.id,
      meta: { count: inserted.length },
    });
    revalidatePath(`/p/${ctx.project.id}/analytics/search-console`);
    revalidatePath(`/p/${ctx.project.id}/ai/tracker`);
    return { inserted: inserted.length, skipped: list.length - inserted.length };
  });
}

/** Queues the optional LLM refinement of query intents. */
export async function refineIntentsAction(projectId: string) {
  return runAction(async () => {
    const ctx = await actionProject(projectIdSchema.parse(projectId), "prompts.manage");
    const job = await enqueueJob(
      "analytics.sc.intents",
      { projectId: ctx.project.id, limit: 300 },
      { dedupeKey: `analytics.sc.intents:${ctx.project.id}`, projectId: ctx.project.id, workspaceId: ctx.project.workspaceId, createdBy: ctx.user.id },
    );
    return { jobId: job?.id ?? null, alreadyQueued: !job };
  });
}

export type InspectActionResult =
  | { status: "ok"; inspection: InspectUrlResult }
  | { status: "error"; code: InspectionErrorCode | "forbidden"; message: string };

/**
 * Inspects a URL with the Search Console URL Inspection API. Anyone with project access may load a
 * cached result (< 24 h); running a live inspection spends the property's daily Google quota and
 * needs "Run paid SEO research" (seo.run) or "Integrations" (settings.manage).
 */
export async function inspectUrlAction(projectId: string, url: string, force = false) {
  return runAction(async (): Promise<InspectActionResult> => {
    const ctx = await actionProject(projectIdSchema.parse(projectId));
    const target = z.string().trim().min(8).max(2048).parse(url);
    const canLive = ctx.permissions.has("seo.run") || ctx.permissions.has("settings.manage") || ctx.isInstanceAdmin;
    try {
      if (!force || !canLive) {
        const cached = await getCachedInspection(ctx.project.id, target);
        if (cached) return { status: "ok", inspection: cached };
      }
      if (!canLive) {
        return {
          status: "error",
          code: "forbidden",
          message: "No recent inspection of this URL. Running a new one needs the “Run paid SEO research” or “Integrations” permission.",
        };
      }
      const inspection = await inspectUrl({ projectId: ctx.project.id, url: target, force, userId: ctx.user.id });
      if (!inspection.cached) {
        await logAudit("gsc.url_inspect", {
          actor: { id: ctx.user.id, email: ctx.user.email },
          targetType: "project",
          targetId: ctx.project.id,
          workspaceId: ctx.project.workspaceId,
          projectId: ctx.project.id,
          meta: { url: inspection.url, verdict: inspection.result.verdict },
        });
      }
      return { status: "ok", inspection };
    } catch (err) {
      if (err instanceof InspectionError) return { status: "error", code: err.code, message: err.message };
      throw err;
    }
  });
}
