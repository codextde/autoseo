import "server-only";
import { enqueueJob } from "@/server/jobs/queue";

export const FC_JOBS = {
  run: "optimize.factcheck.run",
  document: "optimize.factcheck.document",
  discover: "optimize.factcheck.discover",
} as const;

export type FcRunPayload = {
  projectId: string;
  assetId?: string | null;
  trigger?: "schedule" | "manual" | "tracking" | "api";
};

/** Enqueues a fact-check run (deduplicated per project / asset while queued or running). */
export async function enqueueFactCheck(payload: FcRunPayload, opts: { createdBy?: string | null; delayMs?: number } = {}) {
  return enqueueJob(FC_JOBS.run, payload, {
    projectId: payload.projectId,
    dedupeKey: `factcheck:${payload.projectId}:${payload.assetId ?? "all"}`,
    createdBy: opts.createdBy ?? null,
    runAt: opts.delayMs ? new Date(Date.now() + opts.delayMs) : undefined,
    priority: payload.trigger === "manual" ? 50 : 120,
  });
}

export async function enqueueDocumentProcessing(doc: { id: string; projectId: string; assetId: string }, createdBy?: string | null) {
  return enqueueJob(
    FC_JOBS.document,
    { documentId: doc.id, projectId: doc.projectId, assetId: doc.assetId },
    { projectId: doc.projectId, priority: 40, maxAttempts: 1, createdBy: createdBy ?? null },
  );
}
