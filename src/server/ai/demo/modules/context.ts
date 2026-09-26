import "server-only";
import type { db } from "@/server/db/client";
import { Rng } from "../random";

/** Transaction handle passed to every demo module (all inserts run in one transaction). */
export type DemoTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Shared context for the per-module demo generators (analytics, SEO, audit, attribution…).
 * Modules must be deterministic: derive all randomness from `ctx.rng(<label>)` and all dates from
 * `ctx.now` / `ctx.days` — never from Math.random() or new Date() directly.
 */
export type DemoModuleCtx = {
  tx: DemoTx;
  projectId: string;
  workspaceId: string;
  userId: string | null;
  seed: string;
  /** Length of the generated history window (days, ending today UTC). */
  days: number;
  now: Date;
  /** Own (fictional) brand and site. */
  brandName: string;
  domain: string;
  country: string;
  language: string;
  competitors: { id: string; name: string; domain: string | null }[];
  /** Tracked AI prompts (so e.g. Search Console "AI prompt" queries can match them). */
  prompts: { id: string; text: string; topic: string | null; funnelStage: string | null }[];
  /** Deterministic sub-generator per label, e.g. ctx.rng("analytics.sc"). */
  rng: (label: string) => Rng;
};

/** A demo data generator for one module's own tables (insert-only, never calls providers). */
export type DemoModule = {
  name: string;
  /** Deletes the module's previous demo rows for ctx.projectId (in-place regeneration). */
  clear: (ctx: DemoModuleCtx) => Promise<void>;
  /** Inserts the module's demo rows; returns row counts for the stats. */
  insert: (ctx: DemoModuleCtx) => Promise<Record<string, number>>;
};

/** Steps that must go through a module's own service (which uses the global db) — run after commit. */
export type DemoPostStep = {
  name: string;
  run: (info: { projectId: string; workspaceId: string; userId: string | null; seed: string; now: Date }) => Promise<Record<string, number>>;
};

export function makeRng(seed: string) {
  return (label: string) => new Rng(`${seed}::${label}`);
}

/** Splits rows into insert-sized chunks (keep params per statement well below 65k). */
export function* chunks<T>(rows: T[], size = 1000): Generator<T[]> {
  for (let i = 0; i < rows.length; i += size) yield rows.slice(i, i + size);
}

/** UTC day string (YYYY-MM-DD) `offset` days before ctx.now (0 = today). */
export function dayOffset(now: Date, offset: number): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - offset * 86_400_000);
  return d.toISOString().slice(0, 10);
}
