import "server-only";
import { db } from "@/server/db/client";
import { auditLogs } from "@/server/db/schema";
import { getRequestMeta } from "@/server/auth/session";

export async function logAudit(
  action: string,
  opts: {
    actor?: { id: string; email: string } | null;
    targetType?: string;
    targetId?: string;
    workspaceId?: string | null;
    projectId?: string | null;
    meta?: Record<string, unknown>;
  } = {},
) {
  try {
    const { ip } = await getRequestMeta().catch(() => ({ ip: null }));
    await db.insert(auditLogs).values({
      action,
      actorId: opts.actor?.id ?? null,
      actorEmail: opts.actor?.email ?? null,
      targetType: opts.targetType,
      targetId: opts.targetId,
      workspaceId: opts.workspaceId ?? null,
      projectId: opts.projectId ?? null,
      ip,
      meta: opts.meta ?? {},
    });
  } catch (err) {
    console.error("[audit] failed to write", action, err);
  }
}
