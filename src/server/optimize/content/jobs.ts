import "server-only";
import { defineJob } from "@/server/jobs/define";
import { enqueueJob } from "@/server/jobs/queue";
import { runContentGeneration, runUrlOptimization, type GenerationOptions } from "./generate";
import { generatePersonasWithAi, insertLibraryPersonas } from "./personas";

export const CONTENT_GENERATE_JOB = "optimize.content.generate";
export const CONTENT_OPTIMIZE_URL_JOB = "optimize.content.optimize_url";
export const CONTENT_PERSONAS_JOB = "optimize.content.personas";

export function enqueueContentGeneration(projectId: string, contentId: string, options: GenerationOptions, userId: string | null) {
  return enqueueJob(CONTENT_GENERATE_JOB, { contentId, options }, { projectId, createdBy: userId, dedupeKey: `${CONTENT_GENERATE_JOB}:${contentId}`, maxAttempts: 1, priority: 60 });
}

export function enqueueUrlOptimization(projectId: string, contentId: string, rewrite: boolean, userId: string | null) {
  return enqueueJob(CONTENT_OPTIMIZE_URL_JOB, { contentId, rewrite }, { projectId, createdBy: userId, dedupeKey: `${CONTENT_OPTIMIZE_URL_JOB}:${contentId}`, maxAttempts: 1, priority: 60 });
}

export function enqueuePersonaGeneration(projectId: string, topic: string, userId: string | null) {
  return enqueueJob(CONTENT_PERSONAS_JOB, { projectId, topic }, { projectId, createdBy: userId, dedupeKey: `${CONTENT_PERSONAS_JOB}:${projectId}:${topic.toLowerCase()}`, maxAttempts: 1, priority: 70 });
}

defineJob<{ contentId: string; options?: GenerationOptions }>({
  type: CONTENT_GENERATE_JOB,
  concurrency: 2,
  timeoutMs: 45 * 60_000,
  retryable: false,
  async run(payload) {
    return runContentGeneration(payload.contentId, payload.options ?? {});
  },
});

defineJob<{ contentId: string; rewrite?: boolean }>({
  type: CONTENT_OPTIMIZE_URL_JOB,
  concurrency: 2,
  timeoutMs: 25 * 60_000,
  retryable: false,
  async run(payload) {
    return runUrlOptimization(payload.contentId, { rewrite: payload.rewrite !== false });
  },
});

defineJob<{ projectId: string; topic: string }>({
  type: CONTENT_PERSONAS_JOB,
  concurrency: 2,
  timeoutMs: 10 * 60_000,
  retryable: false,
  async run(payload) {
    try {
      const n = await generatePersonasWithAi(payload.projectId, payload.topic);
      if (n >= 12) return { created: n, source: "ai" };
      return { created: n + (await insertLibraryPersonas(payload.projectId, payload.topic)), source: "ai+library" };
    } catch (err) {
      // Keep the library usable even when the AI call fails.
      const n = await insertLibraryPersonas(payload.projectId, payload.topic);
      return { created: n, source: "library", error: err instanceof Error ? err.message : String(err) };
    }
  },
});
