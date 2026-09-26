import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  botVisits,
  integrations,
  jobs,
  logUploads,
  scDaily,
  scPages,
  scQueries,
  trafficDaily,
  trafficRows,
  type TrafficProvider,
} from "@/server/db/schema";
import { enqueueJob } from "@/server/jobs/queue";
import { env } from "@/server/env";
import { PROVIDERS } from "@/lib/integrations-catalog";
import { integrationTarget } from "@/server/integrations/store";
import { addDays, isoDate } from "./period";

export const SC_RETENTION_DAYS = 486; // 16 months
export const TRAFFIC_RETENTION_DAYS = 486;
export const BOT_RETENTION_DAYS = 400;

/** Directory for in-flight / queued log uploads. */
export function uploadsDir(): string {
  return path.join(env.dataDir, "uploads", "logs");
}

const TRAFFIC_PROVIDERS: TrafficProvider[] = ["google_analytics", "matomo", "piwik_pro"];

/** Enqueues the sync job for a project's integration (deduplicated while queued/running). */
export async function enqueueAnalyticsSync(
  projectId: string,
  provider: string,
  opts: { full?: boolean; createdBy?: string | null; priority?: number } = {},
) {
  if (provider === PROVIDERS.gsc || provider === PROVIDERS.bing) {
    const source = provider === PROVIDERS.gsc ? "google" : "bing";
    return enqueueJob(
      "analytics.sc.sync",
      { projectId, source, full: !!opts.full },
      { dedupeKey: `analytics.sc.sync:${projectId}:${source}`, projectId, createdBy: opts.createdBy ?? null, priority: opts.priority ?? 50 },
    );
  }
  if ((TRAFFIC_PROVIDERS as string[]).includes(provider)) {
    return enqueueJob(
      "analytics.traffic.sync",
      { projectId, provider, full: !!opts.full },
      { dedupeKey: `analytics.traffic.sync:${projectId}:${provider}`, projectId, createdBy: opts.createdBy ?? null, priority: opts.priority ?? 50 },
    );
  }
  return null;
}

/** Daily cron: one sync job per connected search/analytics integration. */
export async function enqueueDailyAnalyticsSyncs() {
  const rows = await db
    .select({ projectId: integrations.projectId, provider: integrations.provider })
    .from(integrations)
    .where(
      and(
        inArray(integrations.provider, [PROVIDERS.gsc, PROVIDERS.bing, ...TRAFFIC_PROVIDERS]),
        inArray(integrations.status, ["connected", "error"]),
      ),
    );
  for (const r of rows) await enqueueAnalyticsSync(r.projectId, r.provider, { priority: 150 });
}

/** Deletes synced data older than the retention windows and stale upload files. */
export async function pruneAnalyticsData() {
  const today = isoDate(new Date());
  const scCutoff = addDays(today, -SC_RETENTION_DAYS);
  const trafficCutoff = addDays(today, -TRAFFIC_RETENTION_DAYS);
  const botCutoff = new Date(Date.now() - BOT_RETENTION_DAYS * 86_400_000);
  await db.delete(scDaily).where(lt(scDaily.date, scCutoff));
  await db.delete(scQueries).where(lt(scQueries.date, scCutoff));
  await db.delete(scPages).where(lt(scPages.date, scCutoff));
  await db.delete(trafficRows).where(lt(trafficRows.date, trafficCutoff));
  await db.delete(trafficDaily).where(lt(trafficDaily.date, trafficCutoff));
  await db.delete(botVisits).where(lt(botVisits.ts, botCutoff));
  // Uploads that never finished within a day are marked failed and their temp files removed.
  const stale = await db
    .update(logUploads)
    .set({ status: "failed", error: "Upload did not complete.", finishedAt: new Date() })
    .where(and(inArray(logUploads.status, ["uploading"]), lt(logUploads.createdAt, sql`now() - interval '1 day'`)))
    .returning({ id: logUploads.id });
  const dir = uploadsDir();
  for (const s of stale) await fs.rm(path.join(dir, `${s.id}.log`), { force: true }).catch(() => {});
  try {
    const files = await fs.readdir(dir);
    for (const f of files) {
      const stat = await fs.stat(path.join(dir, f)).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > 3 * 86_400_000) await fs.rm(path.join(dir, f), { force: true });
    }
  } catch {
    // directory does not exist yet
  }
  return { scCutoff, trafficCutoff, staleUploads: stale.length };
}

/* ───────────────────────────── Sync target guard ───────────────────────────── */

export type DbExecutor = Pick<typeof db, "execute" | "select" | "insert" | "update" | "delete">;

/** Thrown inside a sync write when the integration was disconnected or now points at another property/site. */
export class SyncTargetChangedError extends Error {
  constructor() {
    super("The integration was disconnected or its property changed during the sync.");
  }
}

export { integrationTarget };

/**
 * Serializes writers of one (project, provider) pair with a transaction-scoped advisory lock and
 * verifies the integration still points at `expectedTarget`. Call first inside every sync write
 * transaction; property changes / disconnects take the same lock before deleting data.
 */
export async function lockSyncTarget(tx: DbExecutor, projectId: string, provider: string, expectedTarget?: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`analytics-sync:${projectId}:${provider}`}))`);
  if (expectedTarget === undefined) return;
  const [row] = await tx
    .select({ config: integrations.config, status: integrations.status })
    .from(integrations)
    .where(and(eq(integrations.projectId, projectId), eq(integrations.provider, provider)))
    .limit(1);
  if (!row || row.status === "disconnected" || integrationTarget(provider, row.config) !== expectedTarget) throw new SyncTargetChangedError();
}

/** Cancels queued/running sync jobs of an integration (before its target changes or it is disconnected). */
export async function cancelAnalyticsSync(projectId: string, provider: string) {
  const keys =
    provider === PROVIDERS.gsc || provider === PROVIDERS.bing
      ? [`analytics.sc.sync:${projectId}:${provider === PROVIDERS.gsc ? "google" : "bing"}`, `analytics.sc.sync:${projectId}:${provider === PROVIDERS.gsc ? "google" : "bing"}:continue`]
      : [`analytics.traffic.sync:${projectId}:${provider}`];
  await db
    .update(jobs)
    .set({ status: "cancelled", finishedAt: new Date(), dedupeKey: null })
    .where(and(inArray(jobs.dedupeKey, keys), inArray(jobs.status, ["queued", "running"])));
}
