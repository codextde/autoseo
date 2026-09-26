import type { NextRequest } from "next/server";
import { getProjectContext } from "@/server/auth/context";
import { exportAttributionsCsv } from "@/server/attribution/service";
import { resolveAttributionPeriod } from "@/server/attribution/period";

export const dynamic = "force-dynamic";

/** CSV export of attribution responses (session auth, project access). Emails stay hashed/masked. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/attribution/export/[projectId]">) {
  const { projectId } = await ctx.params;
  const project = await getProjectContext(projectId);
  if (!project) return Response.json({ error: "Not found" }, { status: 404 });
  const sp = req.nextUrl.searchParams;
  const period = resolveAttributionPeriod(sp.get("period") ?? undefined, sp.get("from") ?? undefined, sp.get("to") ?? undefined);
  const view = sp.get("view") === "all" ? "all" : "ai_search";
  const analytics = sp.get("analytics");
  const csv = await exportAttributionsCsv(projectId, {
    from: period.from,
    to: period.to,
    channel: view,
    search: sp.get("q")?.slice(0, 200) || undefined,
    source: sp.get("source")?.slice(0, 200) || undefined,
    status: analytics === "included" ? "active" : analytics === "dismissed" ? "dismissed" : "all",
  });
  const name = `attribution-${project.project.domain.replace(/[^a-z0-9.-]/gi, "")}-${period.from.toISOString().slice(0, 10)}_${period.to.toISOString().slice(0, 10)}.csv`;
  return new Response(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
