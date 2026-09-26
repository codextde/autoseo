import { getProjectContext } from "@/server/auth/context";
import { getPromptRows } from "@/server/ai/metrics";
import { resolveRange } from "@/features/ai-tracking/period";
import { toCsv } from "@/features/ai-tracking/csv";
import { getEngine } from "@/lib/engines";
import { getCountry } from "@/lib/countries";

/** CSV export of the tracker prompt table (same filters as the table). Session-authenticated. */
export async function GET(req: Request, ctx: RouteContext<"/p/[projectId]/ai/tracker/export">) {
  const { projectId } = await ctx.params;
  const project = await getProjectContext(projectId);
  if (!project) return new Response("Not found", { status: 404 });
  if (!project.permissions.has("project.view")) return new Response("Forbidden", { status: 403 });

  const url = new URL(req.url);
  const p = (k: string) => url.searchParams.get(k) ?? "";
  const list = (k: string) => p(k).split(",").map((s) => s.trim()).filter(Boolean);
  const status = p("status") === "archived" ? "archived" : "active";
  const period = resolveRange(p("tperiod") || "7d");
  const country = getCountry(p("tloc")) ? p("tloc") : "";
  let rows = await getPromptRows(
    {
      projectId,
      status,
      countries: country ? [country] : undefined,
      engines: list("teng").filter((e) => getEngine(e)),
      tagIds: list("ttags").slice(0, 50),
    },
    period,
  );
  const q = p("q").trim().toLowerCase();
  if (q) rows = rows.filter((r) => r.text.toLowerCase().includes(q) || r.tags.some((t) => t.name.toLowerCase().includes(q)));

  const engines = [...new Set(rows.flatMap((r) => r.perEngine.map((e) => e.engine)))];
  const header = [
    "Prompt",
    "Country",
    "Status",
    "Tags",
    "Answers",
    "Visibility %",
    "Visibility Δ",
    "Mentions",
    "Mentions Δ",
    "Sentiment",
    "Sentiment Δ",
    "Citations",
    "Citations Δ",
    "Avg position",
    ...engines.map((e) => `${getEngine(e)?.name ?? e} visibility %`),
    "Brands",
    "Period",
  ];
  const body = rows.map((r) => [
    r.text,
    r.country,
    r.status,
    r.tags.map((t) => t.name).join(" | "),
    r.answers,
    r.visibility,
    r.visibilityDelta,
    r.mentions,
    r.mentionsDelta,
    r.sentiment,
    r.sentimentDelta,
    r.citations,
    r.citationsDelta,
    r.position,
    ...engines.map((e) => r.perEngine.find((x) => x.engine === e)?.visibility ?? null),
    r.brands.map((b) => `${b.name} (${b.count})`).join(" | "),
    `${period.from}..${period.to}`,
  ]);
  const csv = `﻿${toCsv([header, ...body])}`;
  const name = `${project.project.domain.replace(/[^a-z0-9.-]/gi, "")}-tracker-${period.to}.csv`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
