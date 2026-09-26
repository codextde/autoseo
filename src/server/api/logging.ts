import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { apiKeys, apiRequestLogs } from "@/server/db/schema";

/** Records one API / MCP request (usage chart) and bumps the credential's counters. */
export async function logApiRequest(entry: {
  credentialId: string | null;
  workspaceId: string | null;
  path: string;
  method: string;
  status: number;
  durationMs: number;
}) {
  try {
    await db.insert(apiRequestLogs).values({
      apiKeyId: entry.credentialId,
      workspaceId: entry.workspaceId,
      path: entry.path.slice(0, 500),
      method: entry.method.slice(0, 16),
      status: entry.status,
      durationMs: Math.max(0, Math.round(entry.durationMs)),
    });
    if (entry.credentialId) {
      await db
        .update(apiKeys)
        .set({ requestCount: sql`${apiKeys.requestCount} + 1`, lastUsedAt: new Date() })
        .where(eq(apiKeys.id, entry.credentialId));
    }
  } catch (err) {
    console.error("[api] failed to log request", err);
  }
}
