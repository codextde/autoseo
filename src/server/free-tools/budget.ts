import "server-only";
import { and, count, eq, inArray, like, lt, or, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { freeToolCounters } from "@/server/db/schema";
import { sha256 } from "@/server/crypto";
import { getSetting } from "@/server/settings";
import { FREE_TOOL_LIST, type FreeToolSlug } from "@/features/free-tools/lib/registry";
import { DATAFORSEO_CALLS_PER_DAY, RESERVED_MICRO_USD_PER_CALL, isPaidTool, type PaidToolSlug } from "./spend";
import { purgeExpiredToolCache } from "./cache";
import { utcDay } from "./domain";

/**
 * Atomic daily budget ledger for the PUBLIC free tools (port of open-seo's `FreeToolBudget` Durable Object).
 *
 * One Postgres row per UTC day and counter key (`all`, `tool:{slug}`, `visitor:{sha256(day:ip)}`). A reservation
 * locks the request's rows in a fixed order (`SELECT … FOR UPDATE`), checks every ceiling and increments all of them
 * in ONE transaction, before the first paid DataForSEO call. No refunds on failure (like open-seo).
 *
 * Ceilings: `all` ≤ freeTools.maxCallsPerDay calls and ≤ freeTools.dailyBudgetUsd estimated USD; `tool:{slug}` ≤ the
 * per-tool calls/day in `spend.ts`; `visitor:{hash}` ≤ freeTools.perVisitorCallsPerDay. A ceiling of 0 is a hard cap
 * (no paid public lookups), never "unlimited".
 */

export type BudgetDecision = "allowed" | "visitor" | "tool" | "daily";

export type BudgetLimits = {
  maxCallsPerDay: number;
  dailyBudgetUsd: number;
  perVisitorCallsPerDay: number;
  /** Override of the per-tool calls/day ceiling (defaults to `spend.ts`; used by tests). */
  toolCallsPerDay?: number;
};

/** Date-scoped hash avoids storing raw IPs; it is not an anonymity guarantee. */
export function visitorHash(day: string, ip: string): string {
  return sha256(`${day}:${ip}`);
}

const KEEP_DAYS = 3;
let lastCleanupDay: string | null = null;

/** Once per process and UTC day: drop counters older than 3 days and expired cache rows. */
function maybeCleanup(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || lastCleanupDay === day) return;
  lastCleanupDay = day;
  const cutoff = utcDay(new Date(Date.parse(`${day}T00:00:00Z`) - KEEP_DAYS * 86_400_000));
  void (async () => {
    try {
      await db.delete(freeToolCounters).where(lt(freeToolCounters.day, cutoff));
      await purgeExpiredToolCache();
    } catch (err) {
      console.error("[free-tools] cleanup failed", err);
    }
  })();
}

/** Reserve the entire uncached run before the first paid call. Never fails open (throws on DB errors). */
export async function reserveToolBudget(input: {
  tool: PaidToolSlug;
  calls: number;
  visitor: string;
  day: string;
  limits: BudgetLimits;
}): Promise<BudgetDecision> {
  const { tool, calls, visitor, day, limits } = input;
  if (!Number.isInteger(calls) || calls <= 0) return "allowed";
  if (calls > 6) throw new Error("Invalid free tool reservation");
  maybeCleanup(day);

  const cost = RESERVED_MICRO_USD_PER_CALL[tool] * calls;
  const budgetMicro = Math.floor(Math.max(0, limits.dailyBudgetUsd) * 1_000_000);
  const counters = [
    { key: "all", ceiling: limits.maxCallsPerDay, reason: "daily" as const },
    { key: `tool:${tool}`, ceiling: limits.toolCallsPerDay ?? DATAFORSEO_CALLS_PER_DAY[tool], reason: "tool" as const },
    { key: `visitor:${visitor}`, ceiling: limits.perVisitorCallsPerDay, reason: "visitor" as const },
  ];
  const keys = counters.map((c) => c.key); // already in lock order: all < tool:* < visitor:*

  return db.transaction(async (tx) => {
    await tx
      .insert(freeToolCounters)
      .values(keys.map((key) => ({ day, key })))
      .onConflictDoNothing();
    const rows = await tx
      .select({ key: freeToolCounters.key, calls: freeToolCounters.calls, microUsd: freeToolCounters.microUsd })
      .from(freeToolCounters)
      .where(and(eq(freeToolCounters.day, day), inArray(freeToolCounters.key, keys)))
      .orderBy(freeToolCounters.key)
      .for("update");
    const byKey = new Map(rows.map((r) => [r.key, r]));

    let decision: BudgetDecision = "allowed";
    for (const counter of counters) {
      const prev = byKey.get(counter.key);
      const used = prev?.calls ?? 0;
      if (used + calls > counter.ceiling) {
        console.warn(
          JSON.stringify({ event: "free_tool_limit_reached", limit: `${counter.reason}_calls`, tool, day, usedCalls: used, requestedCalls: calls, limitCalls: counter.ceiling }),
        );
        decision = counter.reason;
        break;
      }
      if (counter.key === "all" && (prev?.microUsd ?? 0) + cost > budgetMicro) {
        console.warn(
          JSON.stringify({
            event: "free_tool_limit_reached",
            limit: "daily_spend",
            tool,
            day,
            usedEstimatedUsd: (prev?.microUsd ?? 0) / 1_000_000,
            requestedEstimatedUsd: cost / 1_000_000,
            limitUsd: limits.dailyBudgetUsd,
          }),
        );
        decision = "daily";
        break;
      }
    }

    if (decision !== "allowed") {
      await tx
        .update(freeToolCounters)
        .set({ blocked: sql`${freeToolCounters.blocked} + 1` })
        .where(and(eq(freeToolCounters.day, day), inArray(freeToolCounters.key, ["all", `tool:${tool}`])));
      return decision;
    }

    await tx
      .update(freeToolCounters)
      .set({ calls: sql`${freeToolCounters.calls} + ${calls}`, microUsd: sql`${freeToolCounters.microUsd} + ${cost}` })
      .where(and(eq(freeToolCounters.day, day), inArray(freeToolCounters.key, keys)));
    return decision;
  });
}

/** Counts answered requests / cache hits / pipeline refusals on the `all` + `tool:{slug}` rows (best effort). */
export async function recordToolEvent(tool: FreeToolSlug, day: string, event: { runs?: number; cacheHits?: number; blocked?: number }) {
  const runs = event.runs ?? 0;
  const cacheHits = event.cacheHits ?? 0;
  const blocked = event.blocked ?? 0;
  if (!runs && !cacheHits && !blocked) return;
  maybeCleanup(day);
  try {
    await db
      .insert(freeToolCounters)
      .values(["all", `tool:${tool}`].map((key) => ({ day, key, runs, cacheHits, blocked })))
      .onConflictDoUpdate({
        target: [freeToolCounters.day, freeToolCounters.key],
        set: {
          runs: sql`${freeToolCounters.runs} + excluded.runs`,
          cacheHits: sql`${freeToolCounters.cacheHits} + excluded.cache_hits`,
          blocked: sql`${freeToolCounters.blocked} + excluded.blocked`,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    console.error("[free-tools] could not record tool event", tool, err);
  }
}

export type FreeToolUsageRow = {
  tool: FreeToolSlug;
  name: string;
  /** false for the RDAP / client-side tools (no DataForSEO spend). */
  paid: boolean;
  /** Reserved billable DataForSEO calls today. */
  calls: number;
  /** Per-tool daily call ceiling (null = no paid calls). */
  callsLimit: number | null;
  estimatedUsd: number;
  /** Requests answered today (cache hits included). */
  runs: number;
  cacheHits: number;
  /** Requests refused (rate limit, verification, cross-site, budget). */
  blocked: number;
};

export type FreeToolsUsageToday = {
  /** UTC day, `YYYY-MM-DD`. */
  day: string;
  calls: number;
  estimatedUsd: number;
  runs: number;
  cacheHits: number;
  blocked: number;
  /** Distinct visitors (hashed IPs) that spent at least one paid call today. */
  visitors: number;
  limits: { maxCallsPerDay: number; dailyBudgetUsd: number; perVisitorCallsPerDay: number; perIpPerMinute: number };
  tools: FreeToolUsageRow[];
};

/** Today's public free-tool usage for Admin → Free SEO tools. */
export async function getFreeToolsUsageToday(day = utcDay()): Promise<FreeToolsUsageToday> {
  const settings = await getSetting("freeTools");
  const rows = await db
    .select()
    .from(freeToolCounters)
    .where(and(eq(freeToolCounters.day, day), or(eq(freeToolCounters.key, "all"), like(freeToolCounters.key, "tool:%"))));
  const [visitorRow] = await db
    .select({ n: count() })
    .from(freeToolCounters)
    .where(and(eq(freeToolCounters.day, day), like(freeToolCounters.key, "visitor:%"), sql`${freeToolCounters.calls} > 0`));
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const all = byKey.get("all");
  return {
    day,
    calls: all?.calls ?? 0,
    estimatedUsd: (all?.microUsd ?? 0) / 1_000_000,
    runs: all?.runs ?? 0,
    cacheHits: all?.cacheHits ?? 0,
    blocked: all?.blocked ?? 0,
    visitors: Number(visitorRow?.n ?? 0),
    limits: {
      maxCallsPerDay: settings.maxCallsPerDay,
      dailyBudgetUsd: settings.dailyBudgetUsd,
      perVisitorCallsPerDay: settings.perVisitorCallsPerDay,
      perIpPerMinute: settings.perIpPerMinute,
    },
    tools: FREE_TOOL_LIST.map((t) => {
      const r = byKey.get(`tool:${t.slug}`);
      return {
        tool: t.slug,
        name: t.name,
        paid: isPaidTool(t.slug),
        calls: r?.calls ?? 0,
        callsLimit: DATAFORSEO_CALLS_PER_DAY[t.slug],
        estimatedUsd: (r?.microUsd ?? 0) / 1_000_000,
        runs: r?.runs ?? 0,
        cacheHits: r?.cacheHits ?? 0,
        blocked: r?.blocked ?? 0,
      };
    }),
  };
}
