import type { NextRequest } from "next/server";
import { getProjectContext } from "@/server/auth/context";
import { rateLimit } from "@/server/rate-limit";
import { getReport, reportDeck } from "@/server/reports/service";
import { loadReportData } from "@/server/reports/data";
import { resolveDataProject } from "@/server/reports/access";
import { buildReportPptxBuffer } from "@/server/reports/pptx";
import { pptxFileName } from "@/features/reports/lib/pptx";

/** Server-side PowerPoint export (also usable from scripts with a session cookie). */
export async function GET(req: NextRequest, ctx: RouteContext<"/p/[projectId]/reports/[reportId]/pptx">) {
  const { projectId, reportId } = await ctx.params;
  const pctx = await getProjectContext(projectId);
  if (!pctx) return new Response("Not found", { status: 404 });
  if (!rateLimit(`reports:pptx:${pctx.user.id}`, 30, 10 * 60_000)) return new Response("Too many exports — try again in a few minutes.", { status: 429 });
  const report = await getReport(projectId, reportId);
  const deck = report ? reportDeck(report) : null;
  if (!report || !deck) return new Response("Not found", { status: 404 });
  const dataProject = await resolveDataProject(projectId, req.nextUrl.searchParams.get("client") ?? undefined);
  const bundle = await loadReportData(dataProject, report.dateRange).catch(() => null);
  const buf = await buildReportPptxBuffer({ deck, bundle, title: report.title, subtitle: report.subtitle, workspaceId: pctx.project.workspaceId });
  const name = pptxFileName(report.title);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Content-Length": String(buf.length),
      "Cache-Control": "private, no-store",
    },
  });
}
