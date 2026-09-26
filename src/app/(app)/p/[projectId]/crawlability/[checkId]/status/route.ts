import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getProjectContext } from "@/server/auth/context";
import { db } from "@/server/db/client";
import { crawlabilityChecks } from "@/server/db/schema";

/** Polled by the crawlability page while a check or an AI llms.txt generation runs. */
export async function GET(_req: Request, ctx: RouteContext<"/p/[projectId]/crawlability/[checkId]/status">) {
  const { projectId, checkId } = await ctx.params;
  if (!(await getProjectContext(projectId))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const [row] = await db
    .select({
      status: crawlabilityChecks.status,
      progress: crawlabilityChecks.progress,
      score: crawlabilityChecks.score,
      error: crawlabilityChecks.error,
      llmsTxtStatus: crawlabilityChecks.llmsTxtStatus,
      llmsTxtError: crawlabilityChecks.llmsTxtError,
    })
    .from(crawlabilityChecks)
    .where(and(eq(crawlabilityChecks.id, checkId), eq(crawlabilityChecks.projectId, projectId)))
    .limit(1);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(row, { headers: { "Cache-Control": "no-store" } });
}
