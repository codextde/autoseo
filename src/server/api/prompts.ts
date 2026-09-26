import "server-only";
import { addTrackedPrompts, applyPromptTags, ensureTags, type NewPromptInput } from "@/server/ai/tracking/prompts";
import { startTrackingRun, TrackingError } from "@/server/ai/tracking/runs";
import type { ApiProject } from "./auth";
import { resolveEngines } from "./ai-data";
import { ApiError } from "./errors";

/** Adds tracked prompts via the tracking module and optionally starts a scoped tracking run. */
export async function addPromptsToProject(
  project: ApiProject,
  input: { prompts: NewPromptInput[]; models?: string[]; runNow: boolean; userId: string },
) {
  const engines = input.models?.length ? resolveEngines(input.models) : null;
  let res: Awaited<ReturnType<typeof addTrackedPrompts>>;
  try {
    res = await addTrackedPrompts({ projectId: project.id, prompts: input.prompts, engines, source: "api", userId: input.userId });
  } catch (err) {
    if (err instanceof TrackingError) throw new ApiError("validation_error", err.message);
    throw err;
  }
  let run: { runId: string; tasks: number; skipped: { engine: string; reason: string }[] } | null = null;
  let runError: string | null = null;
  if (input.runNow && res.created.length) {
    try {
      const r = await startTrackingRun({ projectId: project.id, trigger: "api", promptIds: res.created, userId: input.userId });
      run = { runId: r.runId, tasks: r.tasks, skipped: r.skipped };
      if (r.error) runError = r.error;
    } catch (err) {
      runError = err instanceof Error ? err.message : "Could not start tracking run.";
    }
  }
  return { created: res.created, duplicates: res.duplicates, skippedOverLimit: res.skippedOverLimit, run, runError };
}

/** Creates tags (idempotent) and optionally applies them to prompts. */
export async function createAndApplyTags(project: ApiProject, names: string[], promptIds: string[] | undefined, mode: "add" | "set" = "add") {
  const map = await ensureTags(project.id, names);
  const applied = promptIds?.length ? await applyPromptTags(project.id, promptIds, names, mode) : 0;
  return { tags: [...map.entries()].map(([name, id]) => ({ id, name })), appliedToPrompts: applied };
}
