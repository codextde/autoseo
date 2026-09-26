"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, actionProject, runAction } from "@/server/auth/guards";
import { logAudit } from "@/server/audit";
import {
  CrawlabilityError,
  deleteCrawlabilityCheck,
  generateLlmsTxtTemplate,
  startAiLlmsTxt,
  startCrawlabilityCheck,
} from "@/server/crawlability/service";

function mapError(err: unknown): never {
  if (err instanceof CrawlabilityError) {
    throw new ActionError(err.message, err.code === "NOT_FOUND" ? "not_found" : err.code === "ALREADY_RUNNING" ? "conflict" : "invalid");
  }
  throw err;
}

export async function startCrawlabilityCheckAction(projectId: string, input: { urls?: string[] }) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "seo.run");
    const urls = z.array(z.string().trim().max(2048)).max(10).default([]).parse(input.urls ?? []);
    const res = await startCrawlabilityCheck({ projectId, workspaceId: ctx.project.workspaceId, userId: ctx.user.id }, { urls, trigger: "manual" }).catch(mapError);
    await logAudit("crawlability.start", {
      actor: { id: ctx.user.id, email: ctx.user.email },
      targetType: "crawlability_check",
      targetId: res.checkId,
      projectId,
      workspaceId: ctx.project.workspaceId,
    });
    revalidatePath(`/p/${projectId}/crawlability`);
    return res;
  });
}

export async function generateLlmsTxtAction(projectId: string, checkId: string, mode: "template" | "ai") {
  return runAction(async () => {
    const ctx = await actionProject(projectId, "seo.run");
    const id = z.string().min(1).parse(checkId);
    if (z.enum(["template", "ai"]).parse(mode) === "template") {
      const text = await generateLlmsTxtTemplate(projectId, id).catch(mapError);
      return { status: "done" as const, text };
    }
    await startAiLlmsTxt({ projectId, workspaceId: ctx.project.workspaceId, userId: ctx.user.id }, id).catch(mapError);
    return { status: "running" as const, text: null };
  });
}

export async function deleteCrawlabilityCheckAction(projectId: string, checkId: string) {
  return runAction(async () => {
    await actionProject(projectId, "seo.run");
    await deleteCrawlabilityCheck(projectId, z.string().min(1).parse(checkId));
    revalidatePath(`/p/${projectId}/crawlability`);
    return true;
  });
}
