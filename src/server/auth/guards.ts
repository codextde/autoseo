import "server-only";
import { forbidden, notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { getProjectContext, getUserContext, type ProjectContext, type UserContext } from "./context";
import type { Permission } from "./permissions";

async function currentPath(): Promise<string> {
  const h = await headers();
  return h.get("x-pathname") ?? "/";
}

/** For pages/layouts/actions: returns the user context or redirects to /login. */
export async function requireUser(): Promise<UserContext> {
  const ctx = await getUserContext();
  if (!ctx) {
    const next = await currentPath();
    redirect(`/login${next && next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`);
  }
  return ctx;
}

/** Requires access to a project (and optionally a permission in its workspace). */
export async function requireProject(projectId: string, permission?: Permission): Promise<ProjectContext> {
  await requireUser();
  const ctx = await getProjectContext(projectId);
  if (!ctx) notFound();
  if (permission && !ctx.permissions.has(permission)) forbidden();
  return ctx;
}

export async function requireAdmin(): Promise<UserContext> {
  const ctx = await requireUser();
  if (!ctx.isInstanceAdmin) forbidden();
  return ctx;
}

/** Requires a permission in (any or a specific) workspace. */
export async function requireWorkspacePermission(permission: Permission, workspaceId?: string) {
  const ctx = await requireUser();
  const membership = ctx.memberships.find(
    (m) => (!workspaceId || m.workspace.id === workspaceId) && m.permissions.has(permission),
  );
  if (!membership && !ctx.isInstanceAdmin) forbidden();
  return { ctx, membership: membership ?? ctx.memberships[0] };
}

export class ActionError extends Error {
  constructor(
    message: string,
    public code: "unauthorized" | "forbidden" | "not_found" | "invalid" | "conflict" | "error" = "error",
  ) {
    super(message);
  }
}

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string; code?: string };

/** Wraps server-action bodies: converts thrown errors to a serializable result. */
export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    // Let Next.js navigation errors (redirect/notFound) propagate.
    if (err && typeof err === "object" && "digest" in err) throw err;
    if (err instanceof ActionError) return { ok: false, error: err.message, code: err.code };
    if (err && typeof err === "object" && "issues" in err) {
      const issues = (err as { issues: Array<{ path: PropertyKey[]; message: string }> }).issues;
      return {
        ok: false,
        error: issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "),
        code: "invalid",
      };
    }
    const ref = Math.random().toString(36).slice(2, 8);
    console.error(`[action] ref=${ref}`, err);
    // Database/driver errors carry SQL + parameters — never send those to the browser.
    const e = err as { name?: string; code?: unknown; query?: unknown; severity?: unknown };
    const isDbError =
      e?.name === "DrizzleQueryError" || e?.name === "PostgresError" || typeof e?.query === "string" || typeof e?.severity === "string";
    if (isDbError) return { ok: false, error: `Something went wrong while saving (ref ${ref}). Please try again.` };
    return { ok: false, error: err instanceof Error ? err.message : "Unexpected error" };
  }
}

/** Server-action friendly checks (throw ActionError instead of redirecting). */
export async function actionUser(): Promise<UserContext> {
  const ctx = await getUserContext();
  if (!ctx) throw new ActionError("Please sign in again.", "unauthorized");
  return ctx;
}

export async function actionProject(projectId: string, permission?: Permission): Promise<ProjectContext> {
  const ctx = await getProjectContext(projectId);
  if (!ctx) throw new ActionError("Project not found.", "not_found");
  if (permission && !ctx.permissions.has(permission))
    throw new ActionError("You don't have permission to do this.", "forbidden");
  return ctx;
}

export async function actionAdmin(): Promise<UserContext> {
  const ctx = await actionUser();
  if (!ctx.isInstanceAdmin) throw new ActionError("Admin access required.", "forbidden");
  return ctx;
}
