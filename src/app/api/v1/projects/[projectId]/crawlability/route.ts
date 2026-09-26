import { z } from "zod";
import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseBody, parseQuery } from "@/server/api/handler";
import { apiActor } from "@/server/api/module-context";
import { crawlabilityHistory, startCrawlabilityBody } from "@/server/api/audit";
import type { ProjectParams } from "@/server/api/rest";
import { corsPreflight } from "@/server/api/urls";
import { startCrawlabilityCheck } from "@/server/crawlability/service";
import { logAudit } from "@/server/audit";

const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });

/** GET /api/v1/projects/{projectId}/crawlability — AI crawlability checks, newest first. */
export const GET = apiRoute<ProjectParams>({ scope: "read" }, async ({ principal, params, url }) => {
  const project = await getApiProject(principal, params.projectId);
  return { data: await crawlabilityHistory(project.id, parseQuery(url, listQuery).limit) };
});

/** POST /api/v1/projects/{projectId}/crawlability — start an AI crawlability check (write + seo.run). Poll GET …/crawlability/{checkId}. */
export const POST = apiRoute<ProjectParams>({ scope: "write", permission: "seo.run", spend: true }, async ({ principal, params, req }) => {
  const project = await getApiProject(principal, params.projectId);
  const body = await parseBody(req, startCrawlabilityBody);
  const res = await startCrawlabilityCheck(apiActor(principal, project), { urls: body.urls, trigger: "api" });
  void logAudit("crawlability.start", {
    actor: { id: principal.user.id, email: principal.user.email },
    targetType: "crawlability_check",
    targetId: res.checkId,
    projectId: project.id,
    workspaceId: project.workspaceId,
    meta: { via: "api" },
  });
  return { status: 202, data: res };
});

export const OPTIONS = corsPreflight;
