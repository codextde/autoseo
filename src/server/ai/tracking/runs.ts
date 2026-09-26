import "server-only";
import { and, asc, desc, eq, inArray, lt, max, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { aiAnswers, aiRuns, projects, prompts } from "@/server/db/schema";
import { enqueueJob } from "@/server/jobs/queue";
import { getSetting } from "@/server/settings";
import { assertBudget, BudgetExceededError } from "@/server/usage";
import { DataForSeoError, DataForSeoNotConfiguredError } from "@/server/dataforseo/client";
import { getEngine, type EngineId } from "@/lib/engines";
import { answerPrompt, EngineUnavailableError, getEngineAvailability, type AnswerResult } from "@/server/ai/engines";

export type RunTrigger = "schedule" | "manual" | "prompt_added" | "api";

export class TrackingError extends Error {}

export function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function startOfUtcDay(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

type ProjectRow = typeof projects.$inferSelect;

/** Demo projects (generated sample data, `settings.demo = true`) are never sent to real AI engines. */
export function isDemoProject(p: Pick<ProjectRow, "settings">): boolean {
  return (p.settings as Record<string, unknown> | null)?.demo === true;
}

export function isPitchExpired(p: Pick<ProjectRow, "isPitch" | "pitchExpiresAt">, now = new Date()): boolean {
  return Boolean(p.isPitch && p.pitchExpiresAt && p.pitchExpiresAt.getTime() < now.getTime());
}

/** Engines a prompt runs on: its own selection (if any) limited to the project's enabled engines. */
export function promptEngines(project: Pick<ProjectRow, "engines">, prompt: { engines: string[] | null }): EngineId[] {
  const enabled = (project.engines ?? []).filter((e) => getEngine(e)) as EngineId[];
  if (!prompt.engines?.length) return enabled;
  return enabled.filter((e) => prompt.engines!.includes(e));
}

export type StartRunResult = {
  runId: string;
  tasks: number;
  skipped: { engine: string; reason: string }[];
  status: "queued" | "failed" | "completed";
  error: string | null;
};

/**
 * Creates an `ai_runs` row and enqueues one `ai.answer` job per (active prompt × usable engine).
 * Engines without a configured provider are skipped (reason stored on the run).
 */
export async function startTrackingRun(input: {
  projectId: string;
  trigger: RunTrigger;
  promptIds?: string[];
  userId?: string | null;
}): Promise<StartRunResult> {
  const [project] = await db.select().from(projects).where(eq(projects.id, input.projectId)).limit(1);
  if (!project) throw new TrackingError("Project not found.");
  if (project.archived) throw new TrackingError("This project is archived.");
  if (isPitchExpired(project)) throw new TrackingError("This pitch project has expired — tracking is stopped.");
  if (isDemoProject(project)) throw new TrackingError("This is a demo project with generated sample data — it is not tracked. Create a real project to track your brand.");
  const limits = await getSetting("limits");
  const scoped = Boolean(input.promptIds?.length);

  const conds = [eq(prompts.projectId, project.id), eq(prompts.status, "active")];
  if (scoped) conds.push(inArray(prompts.id, input.promptIds!));
  const rows = await db
    .select({ id: prompts.id, engines: prompts.engines })
    .from(prompts)
    .where(and(...conds))
    .orderBy(asc(prompts.createdAt))
    .limit(limits.maxPromptsPerProject);

  const availability = await getEngineAvailability({ workspaceId: project.workspaceId });
  const availMap = new Map(availability.map((a) => [a.id, a]));
  const skipped = new Map<string, string>();
  const usable = new Set<EngineId>();
  for (const e of project.engines ?? []) {
    const a = availMap.get(e as EngineId);
    if (!a) continue;
    if (a.configured && a.provider) usable.add(a.id);
    else skipped.set(a.id, a.reason);
  }

  const [run] = await db
    .insert(aiRuns)
    .values({
      projectId: project.id,
      trigger: input.trigger,
      status: "queued",
      fullRun: !scoped,
      createdBy: input.userId ?? null,
      meta: {
        ...(scoped ? { promptIds: input.promptIds } : {}),
        engines: [...usable],
        skipped: [...skipped].map(([engine, reason]) => ({ engine, reason })),
      },
    })
    .returning();
  const runId = run!.id;

  let error: string | null = null;
  if (!rows.length) error = scoped ? "The selected prompts are archived or deleted." : "No active prompts to track yet — add prompts first.";
  else if (!usable.size) {
    error = project.engines?.length
      ? `No enabled AI engine can answer right now: ${[...skipped].map(([e, r]) => `${getEngine(e)?.name ?? e} — ${r}`).join("; ")}`
      : "No AI engines are enabled for this project (Model Settings).";
  }
  if (!error) {
    try {
      await assertBudget();
    } catch (err) {
      if (err instanceof BudgetExceededError) error = err.message;
      else throw err;
    }
  }
  if (error) {
    await db.update(aiRuns).set({ status: "failed", error, finishedAt: new Date() }).where(eq(aiRuns.id, runId));
    return { runId, tasks: 0, skipped: [...skipped].map(([engine, reason]) => ({ engine, reason })), status: "failed", error };
  }

  const day = utcDay();
  // Scheduled runs don't re-answer pairs that already have a successful answer today (e.g. new prompts).
  const answeredToday = new Set<string>();
  if (input.trigger === "schedule") {
    const done = await db
      .select({ promptId: aiAnswers.promptId, engine: aiAnswers.engine })
      .from(aiAnswers)
      .where(and(eq(aiAnswers.projectId, project.id), eq(aiAnswers.answerDate, day), eq(aiAnswers.status, "ok")));
    for (const d of done) answeredToday.add(`${d.promptId}:${d.engine}`);
  }
  let tasks = 0;
  for (const p of rows) {
    for (const engine of promptEngines(project, p)) {
      if (!usable.has(engine) || answeredToday.has(`${p.id}:${engine}`)) continue;
      const job = await enqueueJob(
        "ai.answer",
        { runId, promptId: p.id, engine },
        {
          projectId: project.id,
          workspaceId: project.workspaceId,
          createdBy: input.userId ?? null,
          priority: input.trigger === "schedule" ? 100 : 50,
          maxAttempts: 1,
          dedupeKey: `ai.answer:${p.id}:${engine}:${day}`,
        },
      );
      if (job) tasks++;
    }
  }
  const status = tasks ? "queued" : "completed";
  await db
    .update(aiRuns)
    .set({ totalTasks: tasks, status, ...(tasks ? {} : { finishedAt: new Date(), error: "All prompts were already answered (or are being answered) today." }) })
    .where(eq(aiRuns.id, runId));
  return { runId, tasks, skipped: [...skipped].map(([engine, reason]) => ({ engine, reason })), status, error: null };
}

/** Records one finished task on the run and finalizes the run when all tasks are done. */
async function finishTask(runId: string | null | undefined, ok: boolean, costUsd: number, error?: string | null) {
  if (!runId) return;
  await db.execute(sql`
    UPDATE ai_runs SET
      done_tasks = done_tasks + ${ok ? 1 : 0},
      failed_tasks = failed_tasks + ${ok ? 0 : 1},
      cost_usd = cost_usd + ${costUsd},
      started_at = COALESCE(started_at, now()),
      error = COALESCE(${error ?? null}, error),
      status = CASE
        WHEN done_tasks + failed_tasks + 1 >= total_tasks THEN
          CASE
            WHEN failed_tasks + ${ok ? 0 : 1} = 0 THEN 'completed'
            WHEN done_tasks + ${ok ? 1 : 0} = 0 THEN 'failed'
            ELSE 'partial'
          END
        ELSE 'running'
      END,
      finished_at = CASE WHEN done_tasks + failed_tasks + 1 >= total_tasks THEN now() ELSE finished_at END
    WHERE id = ${runId}`);
}

function isTransient(err: unknown): boolean {
  if (err instanceof EngineUnavailableError || err instanceof BudgetExceededError || err instanceof DataForSeoNotConfiguredError) return false;
  if (err instanceof DataForSeoError) {
    const code = err.statusCode ?? 0;
    return code === 0 || code === 429 || (code >= 500 && code < 600) || (code >= 50000 && code < 60000);
  }
  const status = (err as { status?: number }).status;
  if (typeof status === "number") return status === 429 || status >= 500;
  const msg = err instanceof Error ? err.message : String(err);
  return /timed? ?out|ECONNRESET|ECONNREFUSED|fetch failed|socket hang up|request failed/i.test(msg);
}

function errorText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 1000);
}

/**
 * Handler body of the `ai.answer` job: asks the engine, stores/updates the day's answer and
 * enqueues its analysis. Records success/failure on the run. Throws a clear error on failure.
 */
export async function processAnswerTask(payload: { runId?: string | null; promptId: string; engine: string }): Promise<Record<string, unknown>> {
  const [row] = await db
    .select({ prompt: prompts, project: projects })
    .from(prompts)
    .innerJoin(projects, eq(projects.id, prompts.projectId))
    .where(eq(prompts.id, payload.promptId))
    .limit(1);
  if (!row) {
    await finishTask(payload.runId, false, 0, "Prompt was deleted before it could run.");
    return { skipped: "prompt_deleted" };
  }
  const { prompt, project } = row;
  const engine = getEngine(payload.engine);
  const skip = async (reason: string) => {
    await finishTask(payload.runId, false, 0, reason);
    return { skipped: reason };
  };
  if (!engine) return skip(`Unknown engine ${payload.engine}`);
  if (prompt.status !== "active") return skip("Prompt was archived.");
  if (project.archived) return skip("Project was archived.");
  if (isPitchExpired(project)) return skip("Pitch project expired.");
  if (isDemoProject(project)) return skip("Demo projects are not tracked.");

  const started = Date.now();
  let result: AnswerResult | null = null;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2 && !result; attempt++) {
    try {
      await assertBudget();
      result = await answerPrompt({
        engine: engine.id,
        prompt: prompt.text,
        country: prompt.country,
        language: prompt.language,
        project: { id: project.id, workspaceId: project.workspaceId, name: project.name, domain: project.domain },
      });
    } catch (err) {
      lastErr = err;
      if (!isTransient(err) || attempt === 1) break;
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }

  const answerDate = utcDay();
  if (!result) {
    const detail = errorText(lastErr);
    const message = detail.startsWith(`${engine.name}:`) ? detail : `${engine.name}: ${detail}`;
    // Keep an error row for the day (never overwrite a successful answer of the same day).
    await db
      .insert(aiAnswers)
      .values({
        projectId: project.id,
        promptId: prompt.id,
        runId: payload.runId ?? null,
        engine: engine.id,
        provider: "none",
        country: prompt.country,
        language: prompt.language,
        answerDate,
        status: "error",
        error: message,
        durationMs: Date.now() - started,
        analysisStatus: "skipped",
      })
      .onConflictDoUpdate({
        target: [aiAnswers.promptId, aiAnswers.engine, aiAnswers.answerDate],
        set: { error: message, runId: payload.runId ?? null, durationMs: Date.now() - started },
        setWhere: sql`${aiAnswers.status} = 'error'`,
      });
    await finishTask(payload.runId, false, 0, message);
    throw new Error(message);
  }

  const values = {
    projectId: project.id,
    promptId: prompt.id,
    runId: payload.runId ?? null,
    engine: engine.id,
    provider: result.provider,
    model: result.model,
    country: prompt.country,
    language: prompt.language,
    answerDate,
    status: "ok" as const,
    error: null,
    text: result.text,
    raw: {
      citations: result.citations,
      fanouts: result.fanouts,
      shopping: result.shopping,
      ads: result.ads,
      provider: result.raw,
    },
    durationMs: Date.now() - started,
    costUsd: result.costUsd,
    brandMentioned: false,
    brandCited: false,
    brandPosition: null,
    mentionDepth: null,
    sentiment: null,
    brandCount: 0,
    citationCount: result.citations.length,
    ownCitationCount: 0,
    analysisStatus: "pending" as const,
    analysisError: null,
    analyzedAt: null,
  };
  const update: Partial<typeof aiAnswers.$inferInsert> = { ...values, createdAt: new Date() };
  delete update.projectId;
  delete update.promptId;
  delete update.engine;
  delete update.answerDate;
  const [answer] = await db
    .insert(aiAnswers)
    .values(values)
    .onConflictDoUpdate({ target: [aiAnswers.promptId, aiAnswers.engine, aiAnswers.answerDate], set: update })
    .returning({ id: aiAnswers.id });
  await db.update(prompts).set({ lastRunAt: new Date() }).where(eq(prompts.id, prompt.id));
  await finishTask(payload.runId, true, result.costUsd);
  await enqueueJob("ai.analyze", { answerId: answer!.id }, { projectId: project.id, workspaceId: project.workspaceId, dedupeKey: `ai.analyze:${answer!.id}`, maxAttempts: 2 });
  return { answerId: answer!.id, provider: result.provider, model: result.model, costUsd: result.costUsd, citations: result.citations.length };
}

/** Last full-project run (any status) — used to decide whether a project is due. */
async function lastFullRun(projectId: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: max(aiRuns.createdAt) })
    .from(aiRuns)
    .where(and(eq(aiRuns.projectId, projectId), eq(aiRuns.fullRun, true)));
  return row?.at ?? null;
}

export function isDue(frequency: string, last: Date | null, now = new Date()): boolean {
  if (frequency === "paused") return false;
  if (!last) return true;
  const today = startOfUtcDay(now).getTime();
  const day = 86_400_000;
  if (frequency === "daily") return last.getTime() < today;
  if (frequency === "weekly") return last.getTime() < today - 6 * day;
  if (frequency === "monthly") return last.getTime() < today - 29 * day;
  return false;
}

/** Hourly schedule: start runs for every project whose tracking frequency is due. */
export async function runDueProjects(): Promise<{ started: string[]; skipped: number }> {
  await closeStaleRuns();
  const list = await db
    .select({
      id: projects.id,
      frequency: projects.trackingFrequency,
      isPitch: projects.isPitch,
      pitchExpiresAt: projects.pitchExpiresAt,
      settings: projects.settings,
    })
    .from(projects)
    .where(eq(projects.archived, false));
  const started: string[] = [];
  let skipped = 0;
  for (const p of list) {
    if (p.frequency === "paused" || isPitchExpired(p) || isDemoProject(p)) {
      skipped++;
      continue;
    }
    const [active] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(prompts)
      .where(and(eq(prompts.projectId, p.id), eq(prompts.status, "active")));
    if (!active?.n) {
      skipped++;
      continue;
    }
    if (!isDue(p.frequency, await lastFullRun(p.id))) {
      skipped++;
      continue;
    }
    try {
      await startTrackingRun({ projectId: p.id, trigger: "schedule" });
      started.push(p.id);
    } catch (err) {
      console.error(`[ai-tracking] could not start run for ${p.id}:`, err instanceof Error ? err.message : err);
    }
  }
  return { started, skipped };
}

/** Runs whose jobs never reported back (worker crash, cancelled jobs) are closed after 6h. */
async function closeStaleRuns() {
  const cutoff = new Date(Date.now() - 6 * 3600_000);
  await db
    .update(aiRuns)
    .set({
      status: sql`CASE WHEN ${aiRuns.doneTasks} > 0 THEN 'partial' ELSE 'failed' END`,
      finishedAt: new Date(),
      error: sql`COALESCE(${aiRuns.error}, 'Some tasks never finished (timed out).')`,
    })
    .where(and(inArray(aiRuns.status, ["queued", "running"]), lt(aiRuns.createdAt, cutoff)));
}

export async function latestRuns(projectId: string, limit = 5) {
  return db.select().from(aiRuns).where(eq(aiRuns.projectId, projectId)).orderBy(desc(aiRuns.createdAt)).limit(limit);
}
