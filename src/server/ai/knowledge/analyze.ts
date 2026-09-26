import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { jobs, projects } from "@/server/db/schema";
import { enqueueJob } from "@/server/jobs/queue";
import type { JobContext } from "@/server/jobs/types";
import { analyzeSitemap } from "./sitemap";
import { analyzeInterest } from "./interest";
import { analyzePersonas } from "./personas";
import { generateBrandProfile } from "./profile";
import { getStreamConfig, syncFeed } from "./products";
import { failKnowledge, getKnowledge, markKnowledgeRunning, notifyKnowledge, saveKnowledge, setKnowledgeJob } from "./store";
import type { KnowledgeKind, SitemapData } from "@/features/ai-research/types";

export const KNOWLEDGE_JOB = "ai_research.knowledge_analysis";

/** Every Brand Knowledge tab runs its analysis as a background job ("products" = feed sync). */
export type AnalysisKind = KnowledgeKind;

export async function startKnowledgeAnalysis(projectId: string, kind: AnalysisKind, userId: string | null): Promise<string | null> {
  const current = await getKnowledge(projectId, kind);
  if (current.status === "running" && current.jobId) return current.jobId;
  await markKnowledgeRunning(projectId, kind, userId, null);
  const dedupeKey = `knowledge:${projectId}:${kind}`;
  const job = await enqueueJob(KNOWLEDGE_JOB, { projectId, kind, userId }, { projectId, createdBy: userId, dedupeKey, maxAttempts: 1, priority: 60 });
  let jobId = job?.id ?? null;
  if (!jobId) {
    // An identical analysis is already queued/running — attach to it.
    const [existing] = await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.dedupeKey, dedupeKey), inArray(jobs.status, ["queued", "running"]))).limit(1);
    jobId = existing?.id ?? null;
  }
  if (jobId) await setKnowledgeJob(projectId, kind, jobId);
  return jobId;
}

export async function runKnowledgeAnalysis(payload: { projectId: string; kind: AnalysisKind; userId: string | null }, ctx: JobContext) {
  const { projectId, kind, userId } = payload;
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return { skipped: "project deleted" };
  const progress = async (p: { step: string; message?: string; done?: number; total?: number }) => ctx.progress(p);
  try {
    let summary = "";
    switch (kind) {
      case "sitemap": {
        const prev = await getKnowledge<SitemapData>(projectId, "sitemap");
        const data = await analyzeSitemap({
          domain: project.domain,
          previousImportant: prev.data?.important ?? [],
          onProgress: progress,
          isCancelled: ctx.isCancelled,
        });
        await saveKnowledge(projectId, "sitemap", data as unknown as Record<string, unknown>);
        summary = `${data.totalUrls.toLocaleString("en-US")} pages in ${data.sitemaps.filter((s) => !s.error).length} sitemap files mapped for ${project.domain}.`;
        break;
      }
      case "interest": {
        const { data, summary: s } = await analyzeInterest(projectId, userId, progress);
        await saveKnowledge(projectId, "interest", data as unknown as Record<string, unknown>);
        summary = s;
        break;
      }
      case "personas": {
        await progress({ step: "personas", message: "Researching your audience" });
        const { data, summary: s } = await analyzePersonas(projectId, userId);
        await saveKnowledge(projectId, "personas", data as unknown as Record<string, unknown>);
        summary = s;
        break;
      }
      case "profile": {
        await progress({ step: "profile", message: "Researching the brand" });
        summary = await generateBrandProfile(projectId, userId);
        break;
      }
      case "products": {
        const cfg = await getStreamConfig(projectId);
        if (!cfg.feedUrl) throw new Error("No product feed URL configured.");
        await progress({ step: "feed", message: `Importing ${cfg.feedUrl}` });
        const stats = await syncFeed(projectId, cfg.feedUrl);
        await saveKnowledge(projectId, "products", { lastSync: new Date().toISOString(), ...stats });
        summary = `${stats.received.toLocaleString("en-US")} products imported from your feed (${stats.created} new, ${stats.updated} updated, ${stats.skipped} skipped).`;
        break;
      }
    }
    await notifyKnowledge({ projectId, userId, kind, ok: true, summary });
    return { summary };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failKnowledge(projectId, kind, message);
    if (kind === "products") {
      const { recordStreamError } = await import("./products");
      await recordStreamError(projectId, message);
    }
    await notifyKnowledge({ projectId, userId, kind, ok: false, summary: message.slice(0, 500) });
    throw err;
  }
}
