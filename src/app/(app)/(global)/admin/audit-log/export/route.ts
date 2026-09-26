import { getUserContext } from "@/server/auth/context";
import { auditFiltersFromParams, csvCell, iterateAuditLogs } from "@/server/admin/audit-log";
import { auditActionLabel } from "@/features/admin/audit-labels";
import { logAudit } from "@/server/audit";

export const dynamic = "force-dynamic";

const HEADER = ["time", "action", "description", "actor_email", "actor_id", "target_type", "target_id", "workspace", "project", "ip", "details"];

/** Streams the (filtered) audit log as CSV. Instance admins only. */
export async function GET(req: Request) {
  const ctx = await getUserContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  if (!ctx.isInstanceAdmin) return new Response("Forbidden", { status: 403 });

  const url = new URL(req.url);
  const filters = auditFiltersFromParams((k) => url.searchParams.get(k));
  void logAudit("audit_log.exported", { actor: { id: ctx.user.id, email: ctx.user.email }, meta: { filters } });

  const encoder = new TextEncoder();
  const iterator = iterateAuditLogs(filters);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // BOM so Excel detects UTF-8.
      controller.enqueue(encoder.encode(`﻿${HEADER.join(",")}\r\n`));
    },
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done || !value) {
          controller.close();
          return;
        }
        const lines = value.map(({ log, workspaceName, projectName }) =>
          [
            log.createdAt.toISOString(),
            log.action,
            auditActionLabel(log.action),
            log.actorEmail,
            log.actorId,
            log.targetType,
            log.targetId,
            workspaceName ?? log.workspaceId,
            projectName ?? log.projectId,
            log.ip,
            log.meta && Object.keys(log.meta).length ? log.meta : "",
          ]
            .map(csvCell)
            .join(","),
        );
        controller.enqueue(encoder.encode(`${lines.join("\r\n")}\r\n`));
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() {
      await iterator.return(undefined);
    },
  });

  const date = new Date().toISOString().slice(0, 10);
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-log-${date}.csv"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
