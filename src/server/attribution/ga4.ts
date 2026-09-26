import "server-only";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { trafficRows } from "@/server/db/schema";
import { getTrafficSources } from "@/server/analytics/traffic/queries";

export type AiTrafficRevenue =
  | { connected: false; status: "missing" | "pending" | "error"; message: string | null }
  | {
      connected: true;
      currency: string;
      total: number;
      previous: number;
      sessions: number;
      byDay: Record<string, number>;
      lastSyncAt: string | null;
    };

function day(d: Date) {
  return d.toISOString().slice(0, 10);
}

/**
 * GA4 revenue of AI-referred sessions (ChatGPT, Perplexity, Claude, Gemini, Copilot …) for a range,
 * read from the analytics module's synced traffic rows. Only available when a Google Analytics
 * integration is connected.
 */
export async function getAiTrafficRevenue(projectId: string, from: Date, to: Date): Promise<AiTrafficRevenue> {
  let sources: Awaited<ReturnType<typeof getTrafficSources>>;
  try {
    sources = await getTrafficSources(projectId);
  } catch {
    return { connected: false, status: "missing", message: null };
  }
  const ga = sources.find((s) => s.provider === "google_analytics");
  if (!ga) return { connected: false, status: "missing", message: null };
  if (ga.status !== "connected") return { connected: false, status: ga.status, message: ga.lastError };

  const span = Math.max(1, to.getTime() - from.getTime());
  const prevFrom = new Date(from.getTime() - span);
  const where = (a: Date, b: Date) =>
    and(eq(trafficRows.projectId, projectId), eq(trafficRows.provider, "google_analytics"), gte(trafficRows.date, day(a)), lte(trafficRows.date, day(b)));

  const [rows, [prev]] = await Promise.all([
    db
      .select({ date: trafficRows.date, revenue: sql<number>`coalesce(sum(${trafficRows.revenue}), 0)::float8`, sessions: sql<number>`coalesce(sum(${trafficRows.sessions}), 0)::int` })
      .from(trafficRows)
      .where(where(from, to))
      .groupBy(trafficRows.date),
    db
      .select({ revenue: sql<number>`coalesce(sum(${trafficRows.revenue}), 0)::float8` })
      .from(trafficRows)
      .where(where(prevFrom, new Date(from.getTime() - 86_400_000))),
  ]);
  const byDay: Record<string, number> = {};
  let total = 0;
  let sessions = 0;
  for (const r of rows) {
    byDay[r.date] = r.revenue;
    total += r.revenue;
    sessions += r.sessions;
  }
  return { connected: true, currency: ga.currency, total, previous: prev?.revenue ?? 0, sessions, byDay, lastSyncAt: ga.lastSyncAt };
}
