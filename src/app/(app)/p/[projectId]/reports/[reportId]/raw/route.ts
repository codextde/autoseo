import type { NextRequest } from "next/server";
import { getProjectContext } from "@/server/auth/context";
import { getReport } from "@/server/reports/service";
import { reportDocumentResponse } from "@/server/reports/document";

/** Raw, sandboxed document for agent-written HTML reports (members only). */
export async function GET(req: NextRequest, ctx: RouteContext<"/p/[projectId]/reports/[reportId]/raw">) {
  const { projectId, reportId } = await ctx.params;
  const pctx = await getProjectContext(projectId);
  if (!pctx) return new Response("This report does not exist or you do not have access to it.", { status: 404 });
  const report = await getReport(projectId, reportId);
  if (!report || report.kind !== "html" || !report.html) {
    return new Response("This report does not exist or you do not have access to it.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  // top-level rendering only for navigations started inside the app (or typed/bookmarked by a member)
  const dest = req.headers.get("sec-fetch-dest");
  const site = req.headers.get("sec-fetch-site");
  if (dest && dest !== "iframe" && site && site !== "same-origin" && site !== "none") {
    return Response.redirect(new URL(`/p/${projectId}/reports/${reportId}`, req.url), 302);
  }
  return reportDocumentResponse(report.html, { print: req.nextUrl.searchParams.get("print") === "1" });
}
