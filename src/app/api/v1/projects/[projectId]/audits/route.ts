import { z } from "zod";
import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseBody, parseQuery } from "@/server/api/handler";
import { apiActor } from "@/server/api/module-context";
import { listAudits, startAuditBody } from "@/server/api/audit";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";
import { startAudit } from "@/server/audit-crawler/service";
import { logAudit } from "@/server/audit";

const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });

/** GET /api/v1/projects/{projectId}/audits — site audits, newest first. */
export const GET = apiRoute<ProjectParams>({ scope: "read" }, async ({ principal, params, url }) => {
  const project = await getApiProject(principal, params.projectId);
  const q = parseQuery(url, listQuery);
  return { data: await listAudits(project.id, q.limit) };
});

/** POST /api/v1/projects/{projectId}/audits — start a background site audit (write + seo.run). */
export const POST = apiRoute<ProjectParams>({ scope: "write", permission: "seo.run", spend: true }, async ({ principal, params, req }) => {
  const project = await getApiProject(principal, params.projectId);
  const body = await parseBody(req, startAuditBody);
  const res = await startAudit(apiActor(principal, project), { ...body, trigger: "api" });
  void logAudit("site_audit.start", {
    actor: { id: principal.user.id, email: principal.user.email },
    targetType: "site_audit",
    targetId: res.auditId,
    projectId: project.id,
    workspaceId: project.workspaceId,
    meta: { startUrl: res.startUrl, maxPages: body.maxPages ?? null, lighthouse: body.lighthouse, via: "api" },
  });
  return { status: 202, data: res };
});

export const OPTIONS = corsPreflight;
