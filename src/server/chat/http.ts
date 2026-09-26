import "server-only";
import { z } from "zod";
import { getProjectContext, type ProjectContext } from "@/server/auth/context";

export const projectIdSchema = z.string().min(3).max(64).regex(/^[A-Za-z0-9_-]+$/);
export const idSchema = z.string().min(3).max(64).regex(/^[A-Za-z0-9_-]+$/);

export function jsonError(status: number, error: string, extra: Record<string, unknown> = {}) {
  return Response.json({ error, ...extra }, { status, headers: { "Cache-Control": "no-store" } });
}

/** Session-authenticated project context for chat route handlers (404 hides other projects). */
export async function chatContext(projectId: string | null | undefined): Promise<ProjectContext | Response> {
  const parsed = projectIdSchema.safeParse(projectId);
  if (!parsed.success) return jsonError(400, "Missing or invalid projectId.");
  const ctx = await getProjectContext(parsed.data);
  if (!ctx) return jsonError(404, "Not found.");
  if (!ctx.permissions.has("project.view")) return jsonError(403, "Forbidden.");
  return ctx;
}
