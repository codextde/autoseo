import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { competitors, optimizeRuns, optimizeTasks, projects, type TaskStep } from "@/server/db/schema";
import { newId } from "@/server/db/schema/_helpers";
import { getOptimizeSettings } from "@/server/optimize/settings";
import { addTaskActivity } from "./activity";
import { priorityScore, stableHash, taskFingerprint } from "./scoring";
import { getTaskSignals, type SignalOutcome, type TaskFinding } from "./signals";
import { tableExists } from "./signals/helpers";
import { enqueueJob } from "@/server/jobs/queue";
import { canWriteWithAi, TASKS_WRITE_JOB } from "./writer";

export type GenerationTrigger = "schedule" | "manual" | "tracking" | "api";

export type GenerationStats = {
  created: number;
  updated: number;
  reopened: number;
  resolved: number;
  aiQueued: number;
  providers: Record<string, { findings: number; ok: boolean; note?: string; error?: string; ms: number }>;
};

type TaskRow = typeof optimizeTasks.$inferSelect;

function toSteps(texts: string[], previous: TaskStep[] = []): TaskStep[] {
  return texts.map((text) => {
    const prev = previous.find((p) => p.text.trim().toLowerCase() === text.trim().toLowerCase());
    return { id: prev?.id ?? newId("stp").slice(4), text, done: prev?.done ?? false };
  });
}

function hashFinding(f: TaskFinding): string {
  return stableHash({ data: f.data, impact: f.impact, effort: f.effort });
}

/**
 * Runs every registered signal provider for a project, upserts tasks (dedup by fingerprint),
 * refreshes evidence, auto-resolves tasks whose signal disappeared, re-opens auto-resolved tasks
 * whose signal came back, and lets the LLM write the texts (templated fallback without AI).
 */
export async function generateTasks(projectId: string, trigger: GenerationTrigger = "manual"): Promise<GenerationStats & { runId: string }> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new Error("Project not found");
  const [run] = await db.insert(optimizeRuns).values({ projectId, kind: "tasks", trigger, status: "running" }).returning();
  const stats: GenerationStats = { created: 0, updated: 0, reopened: 0, resolved: 0, aiQueued: 0, providers: {} };

  try {
    const comps = await db.select().from(competitors).where(eq(competitors.projectId, projectId));
    const settings = await getOptimizeSettings(projectId);
    const existing = await db
      .select()
      .from(optimizeTasks)
      .where(and(eq(optimizeTasks.projectId, projectId), eq(optimizeTasks.source, "generator")));
    const byFp = new Map(existing.map((t) => [t.fingerprint, t]));
    const now = new Date();
    const since = new Date(now.getTime() - 30 * 86400000);
    const brandNames = [project.name, ...(project.brand?.aliases ?? [])].map((s) => s.toLowerCase()).filter(Boolean);
    const ownDomains = [project.domain, ...(project.brand?.domains ?? [])]
      .map((d) => d.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]!)
      .filter(Boolean);

    const found = new Set<string>();
    const createdIds: string[] = [];
    const resolvedIds: string[] = [];
    const needsWriting: Array<{ task: TaskRow; finding: TaskFinding }> = [];

    for (const provider of getTaskSignals()) {
      const started = Date.now();
      const openFingerprints = new Set(
        existing.filter((t) => t.signal === provider.key && (t.status === "open" || t.status === "in_progress")).map((t) => t.fingerprint),
      );
      let outcome: SignalOutcome;
      try {
        outcome = await provider.collect({
          projectId,
          project,
          competitors: comps,
          since,
          sinceDate: since.toISOString().slice(0, 10),
          now,
          brandNames,
          ownDomains,
          tableExists,
          fingerprint: (parts) => taskFingerprint(provider.key, parts),
          openFingerprints,
        });
      } catch (err) {
        console.error(`[optimize] signal ${provider.key} failed`, err);
        stats.providers[provider.key] = { findings: 0, ok: false, error: err instanceof Error ? err.message : String(err), ms: Date.now() - started };
        // Never resolve tasks of a provider that failed.
        for (const t of existing) if (t.signal === provider.key) found.add(t.fingerprint);
        continue;
      }
      stats.providers[provider.key] = { findings: outcome.findings.length, ok: true, note: outcome.note, ms: Date.now() - started };

      for (const f of outcome.findings) {
        const fingerprint = taskFingerprint(provider.key, f.subject);
        if (found.has(fingerprint)) continue;
        found.add(fingerprint);
        const signalHash = hashFinding(f);
        const priority = priorityScore(f.impact, f.effort);
        const evidence = f.evidence.filter((e) => (e.items?.length ?? 0) > 0 || e.value || e.chart?.length || e.description);
        const signalData = { ...f.data, datasets: f.datasets };
        const prev = byFp.get(fingerprint);
        if (!prev) {
          const [row] = await db
            .insert(optimizeTasks)
            .values({
              projectId,
              fingerprint,
              signal: provider.key,
              category: f.category,
              title: f.title,
              summary: f.summary,
              description: f.description,
              steps: toSteps(f.steps),
              acceptanceCriteria: f.acceptanceCriteria,
              contentPlan: f.contentPlan ?? null,
              targetUrls: f.targetUrls ?? [],
              targetPrompts: f.targetPrompts ?? [],
              evidence,
              signalData,
              signalHash,
              writtenBy: "template",
              impact: f.impact,
              effort: f.effort,
              priority,
              status: "open",
              autoResolvable: f.autoResolvable ?? true,
              signalActive: true,
              assigneeId: settings.routing?.[f.category]?.assigneeId ?? null,
              source: "generator",
              firstDetectedAt: now,
              lastDetectedAt: now,
            })
            .onConflictDoNothing()
            .returning();
          if (row) {
            stats.created++;
            createdIds.push(row.id);
            needsWriting.push({ task: row, finding: f });
            await addTaskActivity({ taskId: row.id, projectId, kind: "created", body: `Detected by ${provider.label}.`, meta: { datasets: f.datasets } });
          }
          continue;
        }

        const changed = prev.signalHash !== signalHash;
        const patch: Partial<typeof optimizeTasks.$inferInsert> = {
          evidence,
          signalData,
          signalHash,
          impact: f.impact,
          effort: f.effort,
          priority,
          targetUrls: f.targetUrls ?? prev.targetUrls,
          targetPrompts: f.targetPrompts ?? prev.targetPrompts,
          autoResolvable: f.autoResolvable ?? true,
          signalActive: true,
          lastDetectedAt: now,
        };
        if (prev.writtenBy === "template") {
          Object.assign(patch, {
            title: f.title,
            summary: f.summary,
            description: f.description,
            steps: toSteps(f.steps, prev.steps),
            acceptanceCriteria: f.acceptanceCriteria,
            contentPlan: f.contentPlan ?? null,
          });
        }
        const reopen = prev.status === "done" && prev.resolution === "auto";
        if (reopen) Object.assign(patch, { status: "open", resolution: null, resolvedAt: null });
        await db.update(optimizeTasks).set(patch).where(eq(optimizeTasks.id, prev.id));
        stats.updated++;
        if (reopen) {
          stats.reopened++;
          await addTaskActivity({ taskId: prev.id, projectId, kind: "reopened", body: "The signal came back after the automatic resolution." });
        } else if (changed && (prev.status === "open" || prev.status === "in_progress")) {
          await addTaskActivity({ taskId: prev.id, projectId, kind: "evidence", body: f.summary });
        }
        if (prev.writtenBy === "template" || (prev.writtenBy === "ai" && changed && prev.status === "open")) {
          needsWriting.push({ task: { ...prev, ...patch } as TaskRow, finding: f });
        }
      }

      // Auto-resolve tasks of this provider whose signal disappeared.
      for (const t of existing) {
        if (t.signal !== provider.key || found.has(t.fingerprint)) continue;
        const coveredByRun = outcome.evaluated === "all" || (outcome.evaluated instanceof Set && outcome.evaluated.has(t.fingerprint));
        if (!coveredByRun) continue;
        if (t.status === "open" || t.status === "in_progress") {
          if (t.autoResolvable && settings.autoResolve) {
            await db
              .update(optimizeTasks)
              .set({ status: "done", resolution: "auto", resolvedAt: now, signalActive: false })
              .where(eq(optimizeTasks.id, t.id));
            stats.resolved++;
            resolvedIds.push(t.id);
            await addTaskActivity({ taskId: t.id, projectId, kind: "auto_resolved", body: "Re-check shows the fix is live — the signal is gone." });
          } else if (t.signalActive) {
            await db.update(optimizeTasks).set({ signalActive: false }).where(eq(optimizeTasks.id, t.id));
          }
        } else if (t.signalActive) {
          await db.update(optimizeTasks).set({ signalActive: false }).where(eq(optimizeTasks.id, t.id));
        }
      }
    }

    /* AI writing runs as a follow-up job so tasks show up immediately (templated) and get
       rewritten by the LLM in the background — highest priority first. */
    const toWrite = needsWriting
      .filter(({ task }) => task.writtenBy !== "user")
      .sort((a, b) => b.task.priority - a.task.priority)
      .map(({ task }) => task.id)
      .slice(0, 24);
    if (toWrite.length && (await canWriteWithAi())) {
      await enqueueJob(
        TASKS_WRITE_JOB,
        { projectId, taskIds: toWrite },
        { dedupeKey: `${TASKS_WRITE_JOB}:${projectId}`, projectId, priority: 150, maxAttempts: 1 },
      );
      stats.aiQueued = toWrite.length;
    }

    /* Notify integrations (webhooks, auto-push routing) */
    try {
      const integrations = await import("@/server/optimize/integrations");
      if (createdIds.length) await integrations.emitTaskEvents(projectId, "task.created", createdIds);
      if (resolvedIds.length) await integrations.emitTaskEvents(projectId, "task.resolved", resolvedIds);
      if (createdIds.length) {
        const created = await db
          .select({ id: optimizeTasks.id, category: optimizeTasks.category })
          .from(optimizeTasks)
          .where(inArray(optimizeTasks.id, createdIds));
        const byProvider = new Map<string, string[]>();
        for (const t of created) {
          const rule = settings.routing?.[t.category];
          if (rule?.autoPush && rule.provider) {
            if (!byProvider.has(rule.provider)) byProvider.set(rule.provider, []);
            byProvider.get(rule.provider)!.push(t.id);
          }
        }
        for (const [provider, ids] of byProvider) await integrations.enqueueTaskPush(projectId, ids, provider, null);
      }
    } catch (err) {
      console.error("[optimize] task integrations hook failed", err);
    }

    await db
      .update(optimizeRuns)
      .set({ status: "completed", finishedAt: new Date(), stats: stats as unknown as Record<string, unknown> })
      .where(eq(optimizeRuns.id, run!.id));
    return { ...stats, runId: run!.id };
  } catch (err) {
    await db
      .update(optimizeRuns)
      .set({ status: "failed", finishedAt: new Date(), error: err instanceof Error ? err.message : String(err), stats: stats as unknown as Record<string, unknown> })
      .where(eq(optimizeRuns.id, run!.id));
    throw err;
  }
}
