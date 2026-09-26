import "server-only";
import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { botVisits, logIngestStats, type BotVisitSource } from "@/server/db/schema";
import { isoDate } from "@/server/analytics/period";
import { identifyBot } from "./bot-classifier";
import { getBotVerifier } from "./ip-ranges";
import type { ParsedHit } from "./log-parser";

export type IngestResult = { received: number; botVisits: number; saved: number };

const INSERT_BATCH = 1000;

export function dedupeKey(bot: string, ts: Date, ip: string | null, path: string): string {
  return crypto.createHash("sha1").update(`${bot}|${ts.toISOString()}|${ip ?? ""}|${path}`).digest("hex");
}

/**
 * Identifies bot requests among parsed hits, verifies their IPs and stores them (deduplicated on
 * bot + timestamp + IP + path). Non-bot hits are discarded.
 */
export async function ingestHits(
  projectId: string,
  source: BotVisitSource,
  hits: ParsedHit[],
  opts: { uploadId?: string | null; received?: number; countRequest?: boolean } = {},
): Promise<IngestResult> {
  const received = opts.received ?? hits.length;
  const verify = await getBotVerifier();
  const rows: (typeof botVisits.$inferInsert)[] = [];
  const now = Date.now();
  for (const h of hits) {
    const bot = identifyBot(h.userAgent);
    if (!bot) continue;
    // Ignore clearly broken timestamps (far future / before 2000).
    const t = h.ts.getTime();
    if (!Number.isFinite(t) || t > now + 24 * 3600_000 || t < 946_684_800_000) continue;
    const ip = h.ip && h.ip.length <= 64 ? h.ip : null;
    const path = h.path.slice(0, 2048);
    rows.push({
      projectId,
      bot: bot.token,
      company: bot.company,
      ts: h.ts,
      ip,
      host: h.host?.slice(0, 255) ?? null,
      path,
      method: h.method?.slice(0, 16) ?? null,
      status: h.status != null && h.status >= 100 && h.status <= 599 ? h.status : null,
      userAgent: h.userAgent.slice(0, 1000),
      bytes: h.bytes != null && h.bytes >= 0 ? h.bytes : null,
      verified: verify(bot.token, ip),
      source,
      uploadId: opts.uploadId ?? null,
      dedupeKey: dedupeKey(bot.token, h.ts, ip, path),
    });
  }
  let saved = 0;
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const chunk = rows.slice(i, i + INSERT_BATCH);
    const inserted = await db
      .insert(botVisits)
      .values(chunk)
      .onConflictDoNothing({ target: [botVisits.projectId, botVisits.dedupeKey] })
      .returning({ id: botVisits.id });
    saved += inserted.length;
  }
  await db
    .insert(logIngestStats)
    .values({
      projectId,
      source,
      date: isoDate(new Date()),
      requests: opts.countRequest === false ? 0 : 1,
      lines: received,
      botVisits: rows.length,
      saved,
      lastReceivedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [logIngestStats.projectId, logIngestStats.source, logIngestStats.date],
      set: {
        requests: sql`${logIngestStats.requests} + ${opts.countRequest === false ? 0 : 1}`,
        lines: sql`${logIngestStats.lines} + ${received}`,
        botVisits: sql`${logIngestStats.botVisits} + ${rows.length}`,
        saved: sql`${logIngestStats.saved} + ${saved}`,
        lastReceivedAt: new Date(),
      },
    });
  return { received, botVisits: rows.length, saved };
}
