import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { env } from "@/server/env";

export const dynamic = "force-dynamic";

/** Liveness/readiness probe for Docker / Coolify. */
export async function GET() {
  const started = Date.now();
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, version: env.buildCommit, buildDate: env.buildDate, dbLatencyMs: Date.now() - started });
  } catch (err) {
    console.error("[health] database check failed", err);
    return Response.json({ ok: false, error: "database unavailable" }, { status: 503 });
  }
}
