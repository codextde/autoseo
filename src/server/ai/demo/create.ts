import "server-only";
import { and, count, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { projects } from "@/server/db/schema";
import { ActionError } from "@/server/auth/guards";
import { logAudit } from "@/server/audit";
import { createDemoProject } from "./generate";

export const MAX_DEMO_PROJECTS = 3;

/** Creates a labelled demo project in a workspace (at most MAX_DEMO_PROJECTS active ones). Callers check permissions. */
export async function createDemoProjectWithinLimit(workspaceId: string, actor: { id: string; email: string }) {
  const [existing] = await db
    .select({ n: count() })
    .from(projects)
    .where(and(eq(projects.workspaceId, workspaceId), eq(projects.archived, false), sql`${projects.settings}->>'demo' = 'true'`));
  if ((existing?.n ?? 0) >= MAX_DEMO_PROJECTS)
    throw new ActionError(`This workspace already has ${MAX_DEMO_PROJECTS} demo projects. Delete one in the project settings first.`, "conflict");
  const result = await createDemoProject(workspaceId, actor.id).catch((e: unknown) => {
    throw new ActionError(e instanceof Error ? e.message : "Could not create the demo project.", "error");
  });
  void logAudit("project.demo_created", {
    actor,
    targetType: "project",
    targetId: result.projectId,
    workspaceId,
    projectId: result.projectId,
    meta: result.stats,
  });
  return { projectId: result.projectId };
}
