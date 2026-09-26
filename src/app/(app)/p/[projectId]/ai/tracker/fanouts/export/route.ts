import { getProjectContext } from "@/server/auth/context";
import { getFanouts } from "@/server/ai/metrics";
import { resolveRange } from "@/features/ai-tracking/period";
import { toCsv } from "@/features/ai-tracking/csv";
import { getEngine } from "@/lib/engines";

/** CSV download of the fan-out queries (same period/search as the page). Session-authenticated. */
export async function GET(req: Request, ctx: RouteContext<"/p/[projectId]/ai/tracker/fanouts/export">) {
  const { projectId } = await ctx.params;
  const project = await getProjectContext(projectId);
  if (!project) return new Response("Not found", { status: 404 });
  if (!project.permissions.has("project.view")) return new Response("Forbidden", { status: 403 });
  const url = new URL(req.url);
  const period = resolveRange(url.searchParams.get("period") || "90d", url.searchParams.get("from"), url.searchParams.get("to"));
  const rows = await getFanouts(projectId, period, (url.searchParams.get("q") ?? "").slice(0, 200));
  const csv = toCsv([
    ["Query", "Frequency", "Models", "Prompts", "Prompt texts", "First seen", "Last seen"],
    ...rows.map((r) => [
      r.query,
      r.frequency,
      r.engines.map((e) => getEngine(e)?.name ?? e).join(" | "),
      r.prompts.length,
      r.prompts.map((p) => p.text).join(" | "),
      r.firstSeen,
      r.lastSeen,
    ]),
  ]);
  const name = `${project.project.domain.replace(/[^a-z0-9.-]/gi, "")}-fanouts-${period.to}.csv`;
  return new Response(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
