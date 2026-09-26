import { getApiProject } from "@/server/api/auth";
import { apiRoute, parseQuery } from "@/server/api/handler";
import { auditExportQuery } from "@/server/api/audit";
import { corsPreflight } from "@/server/api/urls";
import { exportAudit } from "@/server/audit-crawler/service";

/** GET /api/v1/projects/{projectId}/audits/{auditId}/export — issues, pages or performance as CSV / JSON (export scope). */
export const GET = apiRoute<{ projectId: string; auditId: string }>({ scope: "export" }, async ({ principal, params, url }) => {
  const project = await getApiProject(principal, params.projectId);
  const q = parseQuery(url, auditExportQuery);
  const file = await exportAudit(project.id, params.auditId, q.kind, q.format, { issueType: q.issueType });
  return new Response(file.content, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${file.filename.replace(/["\\\r\n]/g, "_")}"`,
      "Cache-Control": "no-store",
    },
  });
});

export const OPTIONS = corsPreflight;
