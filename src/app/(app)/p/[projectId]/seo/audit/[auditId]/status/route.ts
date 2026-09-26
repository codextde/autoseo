import { NextResponse } from "next/server";
import { getProjectContext } from "@/server/auth/context";
import { getAuditStatus } from "@/server/audit-crawler/service";

/** Live progress for the audit detail page (polled while the audit runs). */
export async function GET(_req: Request, ctx: RouteContext<"/p/[projectId]/seo/audit/[auditId]/status">) {
  const { projectId, auditId } = await ctx.params;
  const project = await getProjectContext(projectId);
  if (!project) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const status = await getAuditStatus(projectId, auditId, 40);
  if (!status) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}
