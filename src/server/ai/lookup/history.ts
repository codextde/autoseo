import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { aiLookups, users } from "@/server/db/schema";
import { enqueueJob } from "@/server/jobs/queue";
import { BRAND_LOOKUP_JOB } from "./brand-lookup";
import { PROMPT_EXPLORER_JOB } from "./prompt-explorer";
import type { LookupHistoryItem } from "@/features/ai-research/types";

type LookupRow = typeof aiLookups.$inferSelect;

export async function createLookup(opts: {
  projectId: string;
  kind: "brand_lookup" | "prompt_explorer";
  query: string;
  params: Record<string, unknown>;
  userId: string | null;
}): Promise<LookupRow> {
  const [row] = await db
    .insert(aiLookups)
    .values({ projectId: opts.projectId, kind: opts.kind, query: opts.query.slice(0, 1000), params: opts.params, createdBy: opts.userId, status: "queued" })
    .returning();
  const job = await enqueueJob(
    opts.kind === "brand_lookup" ? BRAND_LOOKUP_JOB : PROMPT_EXPLORER_JOB,
    { lookupId: row!.id },
    { projectId: opts.projectId, createdBy: opts.userId, maxAttempts: 1, priority: 20 },
  );
  if (job) await db.update(aiLookups).set({ jobId: job.id }).where(eq(aiLookups.id, row!.id));
  return { ...row!, jobId: job?.id ?? null };
}

export async function getLookup(projectId: string, id: string): Promise<LookupRow | null> {
  const [row] = await db
    .select()
    .from(aiLookups)
    .where(and(eq(aiLookups.id, id), eq(aiLookups.projectId, projectId)))
    .limit(1);
  return row ?? null;
}

export async function listLookups(projectId: string, kind: "brand_lookup" | "prompt_explorer", limit = 30): Promise<LookupHistoryItem[]> {
  const rows = await db
    .select({ l: aiLookups, name: users.name, email: users.email })
    .from(aiLookups)
    .leftJoin(users, eq(users.id, aiLookups.createdBy))
    .where(and(eq(aiLookups.projectId, projectId), eq(aiLookups.kind, kind)))
    .orderBy(desc(aiLookups.createdAt))
    .limit(limit);
  return rows.map(({ l, name, email }) => ({
    id: l.id,
    kind: l.kind,
    query: l.query,
    status: l.status,
    error: l.error,
    costUsd: l.costUsd,
    createdAt: l.createdAt.toISOString(),
    params: l.params,
    createdByName: name ?? email ?? null,
  }));
}

export async function deleteLookup(projectId: string, id: string) {
  await db.delete(aiLookups).where(and(eq(aiLookups.id, id), eq(aiLookups.projectId, projectId)));
}
