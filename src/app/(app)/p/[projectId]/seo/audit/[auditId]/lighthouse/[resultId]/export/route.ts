import { NextResponse } from "next/server";
import { z } from "zod";
import { getProjectContext } from "@/server/auth/context";
import { AuditServiceError, exportLighthouseResult } from "@/server/audit-crawler/service";

const query = z.object({
  mode: z.enum(["full", "issues", "category", "csv"]).default("issues"),
  category: z.enum(["performance", "accessibility", "best-practices", "seo"]).optional(),
});

/** Lighthouse drill-down exports: full stored payload, issues JSON (all / per category) or CSV. */
export async function GET(req: Request, ctx: RouteContext<"/p/[projectId]/seo/audit/[auditId]/lighthouse/[resultId]/export">) {
  const { projectId, auditId, resultId } = await ctx.params;
  if (!(await getProjectContext(projectId))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const parsed = query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  try {
    const file = await exportLighthouseResult(projectId, auditId, resultId, parsed.data.mode, parsed.data.category);
    return new NextResponse(file.content, {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof AuditServiceError && err.code === "NOT_FOUND") return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw err;
  }
}
