// Schema for the "free-tools" module (open-seo's 8 free SEO tools, in-app + public /free-tools).
// Owned by the free-tools module; see docs/ARCHITECTURE.md and docs/research/open-seo-inventory.md §22.
import { bigint, boolean, index, integer, jsonb, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { createdAt, ts, updatedAt } from "./_helpers";

/**
 * Result cache shared by the public tools and the in-app hub (replaces open-seo's per-colo Cache API).
 * `key` = `{tool}|{cacheKey}`. Failure envelopes (`ok=false`) are cached briefly so a failing target isn't retried
 * in a loop — the DataForSEO money was already spent.
 */
export const freeToolCache = pgTable(
  "free_tool_cache",
  {
    key: text().primaryKey(),
    tool: text().notNull(),
    ok: boolean().notNull(),
    data: jsonb().$type<unknown>(),
    error: text(),
    expiresAt: ts().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("free_tool_cache_expires_idx").on(t.expiresAt)],
);

/**
 * Daily budget ledger for the public tools (replaces open-seo's `FreeToolBudget` Durable Object).
 * One row per UTC day and counter key: `all` (every paid tool), `tool:{slug}`, `visitor:{sha256(day:ip)}`.
 * Reservations lock the rows of one request (`SELECT … FOR UPDATE`) and apply every ceiling in one transaction.
 */
export const freeToolCounters = pgTable(
  "free_tool_counters",
  {
    /** UTC day, `YYYY-MM-DD`. */
    day: text().notNull(),
    key: text().notNull(),
    /** Reserved billable DataForSEO calls (never refunded, like open-seo). */
    calls: integer().notNull().default(0),
    /** Reserved estimated spend in millionths of a USD. */
    microUsd: bigint({ mode: "number" }).notNull().default(0),
    /** Requests answered (cache hits + provider runs, incl. free RDAP lookups). */
    runs: integer().notNull().default(0),
    cacheHits: integer().notNull().default(0),
    /** Requests refused by the protection pipeline (rate limit, verification, budget). */
    blocked: integer().notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.day, t.key] })],
);
