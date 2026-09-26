import { NextResponse } from "next/server";
import { z } from "zod";
import { getProjectContext } from "@/server/auth/context";
import { AuditServiceError, exportAudit } from "@/server/audit-crawler/service";

const query = z.object({
  kind: z.enum(["issues", "pages", "performance"]).default("issues"),
  format: z.enum(["csv", "json"]).default("csv"),
  issueType: z.string().max(64).regex(/^[a-z0-9-]+$/).optional(),
});

/** CSV / JSON exports of an audit (issues, pages, Lighthouse performance). */
export async function GET(req: Request, ctx: RouteContext<"/p/[projectId]/seo/audit/[auditId]/export">) {
  const { projectId, auditId } = await ctx.params;
  const project = await getProjectContext(projectId);
  if (!project) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const url = new URL(req.url);
  const parsed = query.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  try {
    const file = await exportAudit(projectId, auditId, parsed.data.kind, parsed.data.format, { issueType: parsed.data.issueType });
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
