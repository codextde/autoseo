import "server-only";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/server/db/client";
import { scDaily, scPages, scQueries } from "@/server/db/schema";
import type { JobContext } from "@/server/jobs/types";
import { enqueueJob } from "@/server/jobs/queue";
import { PROVIDERS } from "@/lib/integrations-catalog";
import { getIntegration, markIntegrationSync, saveIntegration } from "@/server/integrations/store";
import {
  getGoogleAccessToken,
  GoogleNotConfiguredError,
  GoogleNotConnectedError,
  GoogleReconnectRequiredError,
  googleApiErrorMessage,
} from "@/server/integrations/google/oauth";
import { gscCountryToAlpha2, gscQueryAll, type GscRow } from "@/server/integrations/google/gsc";
import { IntegrationHttpError } from "@/server/integrations/http";
import {
  bingListSites,
  bingPageStats,
  bingQueryStats,
  bingTrafficStats,
  getBingCredentials,
  sameBingSite,
} from "@/server/integrations/bing";
import { addDays, isoDate } from "../period";
import { lockSyncTarget, SC_RETENTION_DAYS, SyncTargetChangedError } from "../scheduling";

export type SyncPayload = { projectId: string; source: "google" | "bing"; full?: boolean };

const MAX_ROWS_PER_DAY = 50_000;
const DAY_CONCURRENCY = 3;
/** Stop a run after this long; the remaining backfill continues in a follow-up job. */
const TIME_BUDGET_MS = 22 * 60_000;
const INSERT_BATCH = 4000;

type Progress = { done: number; total: number; phase: string };

export async function syncSearchConsole(payload: SyncPayload, ctx?: JobContext): Promise<unknown> {
  return payload.source === "bing" ? syncBing(payload, ctx) : syncGoogle(payload, ctx);
}

/* ───────────────────────────── helpers ───────────────────────────── */

function clampQuery(q: string): string {
  return q.length > 1000 ? q.slice(0, 1000) : q;
}

function positionOf(row: { position?: number | null; impressions: number }) {
  return row.position && Number.isFinite(row.position) && row.position > 0 ? row.position : null;
}

async function insertBatched<T>(rows: T[], insert: (batch: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += INSERT_BATCH) await insert(rows.slice(i, i + INSERT_BATCH));
}

async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++]!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/** Days from `to` down to `from` (inclusive, newest first). */
function daysDesc(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = to; d >= from; d = addDays(d, -1)) out.push(d);
  return out;
}

/* ───────────────────────────── Google ───────────────────────────── */

async function syncGoogle(payload: SyncPayload, ctx?: JobContext) {
  const { projectId } = payload;
  const row = await getIntegration(projectId, PROVIDERS.gsc);
  if (!row) return { skipped: "not_connected" };
  const siteUrl = typeof row.config.siteUrl === "string" ? row.config.siteUrl : "";
  if (row.status === "pending" || !siteUrl) return { skipped: "no_property" };
  // Every write re-checks (under the sync lock) that the integration still points at this site.
  const target = siteUrl;

  let token: string;
  try {
    token = await getGoogleAccessToken(projectId, "gsc");
  } catch (err) {
    if (err instanceof GoogleReconnectRequiredError || err instanceof GoogleNotConnectedError || err instanceof GoogleNotConfiguredError) {
      await markIntegrationSync(projectId, PROVIDERS.gsc, { ok: false, error: err.message }, target);
      return { error: err.message };
    }
    throw err;
  }

  const started = Date.now();
  const today = isoDate(new Date());
  const end = addDays(today, -1);
  const floor = addDays(today, -SC_RETENTION_DAYS);
  const syncedThrough = typeof row.config.syncedThrough === "string" ? row.config.syncedThrough : null;
  const backfilledFrom = typeof row.config.backfilledFrom === "string" ? row.config.backfilledFrom : null;
  const full = !!payload.full || !syncedThrough || !backfilledFrom;

  // Recent window (re-imported every time because GSC finalizes data late) + remaining backfill.
  const recentFrom = full ? floor : maxDate(floor, addDays(syncedThrough!, -4));
  const recentDays = daysDesc(recentFrom, end);
  const backfillDays = !full && backfilledFrom! > floor ? daysDesc(floor, addDays(backfilledFrom!, -1)) : [];
  const days = [...recentDays, ...backfillDays];
  const rangeFrom = days.length ? days[days.length - 1]! : end;

  const progress: Progress = { done: 0, total: days.length + 1, phase: "totals" };
  await ctx?.progress({ ...progress });

  try {
    // 1) Daily totals for the whole range (date dimension includes anonymized queries).
    const totals = await gscQueryAll(token, siteUrl, { startDate: rangeFrom, endDate: end, dimensions: ["date"], rowLimit: 25_000 }, 25_000);
    await db.transaction(async (tx) => {
      await lockSyncTarget(tx, projectId, PROVIDERS.gsc, target);
      await tx
        .delete(scDaily)
        .where(and(eq(scDaily.projectId, projectId), eq(scDaily.source, "google"), gte(scDaily.date, rangeFrom), lte(scDaily.date, end)));
      await insertBatched(
        totals
          .filter((r) => r.keys?.[0])
          .map((r) => ({
            projectId,
            source: "google" as const,
            date: r.keys![0]!,
            clicks: Math.round(r.clicks),
            impressions: Math.round(r.impressions),
            position: positionOf(r),
          })),
        (batch) => tx.insert(scDaily).values(batch),
      );
    });
    progress.done = 1;
    progress.phase = "days";
    await ctx?.progress({ ...progress });

    // Days without any impressions don't need per-query requests.
    const activeDays = new Set(totals.filter((r) => r.impressions > 0).map((r) => r.keys?.[0]));

    let newestDone: string | null = null;
    let oldestContiguous: string | null = full ? null : backfilledFrom;
    let stoppedEarly = false;
    const completed = new Set<string>();

    await runPool(days, DAY_CONCURRENCY, async (day) => {
      if (stoppedEarly) return;
      if (Date.now() - started > TIME_BUDGET_MS) {
        stoppedEarly = true;
        return;
      }
      if (progress.done % 10 === 0 && (await ctx?.isCancelled())) {
        stoppedEarly = true;
        return;
      }
      let queryRows: GscRow[] = [];
      let pageRows: GscRow[] = [];
      if (activeDays.has(day)) {
        [queryRows, pageRows] = await Promise.all([
          gscQueryAll(token, siteUrl, { startDate: day, endDate: day, dimensions: ["query", "country"] }, MAX_ROWS_PER_DAY),
          gscQueryAll(token, siteUrl, { startDate: day, endDate: day, dimensions: ["page", "query"] }, MAX_ROWS_PER_DAY),
        ]);
      }
      await writeGoogleDay(projectId, target, day, queryRows, pageRows);
      completed.add(day);
      progress.done++;
      if (progress.done % 5 === 0 || progress.done === progress.total) await ctx?.progress({ ...progress });
    });

    // Contiguous coverage markers: newest day synced + oldest day reached without gaps.
    const recentComplete = recentDays.every((d) => completed.has(d));
    if (recentComplete) newestDone = end;
    if (full) {
      if (recentComplete) oldestContiguous = recentFrom;
      else {
        // newest-first processing: coverage is contiguous from `end` down to the first gap
        let cursor: string | null = null;
        for (const d of recentDays) {
          if (!completed.has(d)) break;
          cursor = d;
        }
        oldestContiguous = cursor;
        newestDone = cursor ? end : null;
      }
    } else if (backfillDays.length) {
      let cursor = backfilledFrom;
      for (const d of backfillDays) {
        if (!completed.has(d)) break;
        cursor = d;
      }
      oldestContiguous = cursor;
    }

    const config: Record<string, unknown> = {
      lastSyncStats: { days: completed.size, totalsDays: totals.length, at: new Date().toISOString() },
    };
    if (newestDone) config.syncedThrough = newestDone;
    if (oldestContiguous) config.backfilledFrom = oldestContiguous;
    await markIntegrationSync(projectId, PROVIDERS.gsc, { ok: true, config }, target);

    const remaining = oldestContiguous ? oldestContiguous > floor : true;
    if (stoppedEarly && remaining && !(await ctx?.isCancelled())) {
      // Continue the backfill shortly (separate dedupe key so the running job does not block it).
      await enqueueJob(
        "analytics.sc.sync",
        { projectId, source: "google" },
        { dedupeKey: `analytics.sc.sync:${projectId}:google:continue`, projectId, runAt: new Date(Date.now() + 60_000), priority: 120 },
      );
    }
    return { source: "google", siteUrl, days: completed.size, from: rangeFrom, to: end, stoppedEarly };
  } catch (err) {
    if (err instanceof SyncTargetChangedError) return { skipped: "target_changed" };
    const message = googleApiErrorMessage(err, "gsc");
    const fatal =
      err instanceof GoogleReconnectRequiredError ||
      (err instanceof IntegrationHttpError && (err.status === 401 || err.status === 403 || err.status === 404));
    await markIntegrationSync(projectId, PROVIDERS.gsc, { ok: false, error: message }, target);
    if (fatal) return { error: message };
    throw new Error(message);
  }
}

async function writeGoogleDay(projectId: string, target: string, day: string, queryRows: GscRow[], pageRows: GscRow[]) {
  // Merge duplicates (e.g. unknown country codes mapped to "").
  const qMap = new Map<string, { query: string; country: string; clicks: number; impressions: number; posW: number }>();
  for (const r of queryRows) {
    const query = clampQuery(r.keys?.[0] ?? "");
    if (!query) continue;
    const country = gscCountryToAlpha2(r.keys?.[1] ?? "");
    const key = `${query}\u0000${country}`;
    const cur = qMap.get(key) ?? { query, country, clicks: 0, impressions: 0, posW: 0 };
    cur.clicks += r.clicks;
    cur.impressions += r.impressions;
    cur.posW += (r.position || 0) * r.impressions;
    qMap.set(key, cur);
  }
  const pRows = pageRows
    .filter((r) => r.keys?.[0])
    .map((r) => ({
      projectId,
      source: "google" as const,
      date: day,
      page: r.keys![0]!.slice(0, 2000),
      query: clampQuery(r.keys?.[1] ?? ""),
      clicks: Math.round(r.clicks),
      impressions: Math.round(r.impressions),
      position: positionOf(r),
    }));
  await db.transaction(async (tx) => {
    // Serializes concurrent syncs of this project/source and aborts if the site changed meanwhile.
    await lockSyncTarget(tx, projectId, PROVIDERS.gsc, target);
    await tx.delete(scQueries).where(and(eq(scQueries.projectId, projectId), eq(scQueries.source, "google"), eq(scQueries.date, day)));
    await tx.delete(scPages).where(and(eq(scPages.projectId, projectId), eq(scPages.source, "google"), eq(scPages.date, day)));
    await insertBatched(
      [...qMap.values()].map((v) => ({
        projectId,
        source: "google" as const,
        date: day,
        query: v.query,
        country: v.country,
        clicks: Math.round(v.clicks),
        impressions: Math.round(v.impressions),
        position: v.impressions > 0 && v.posW > 0 ? v.posW / v.impressions : null,
      })),
      (batch) => tx.insert(scQueries).values(batch),
    );
    await insertBatched(pRows, (batch) => tx.insert(scPages).values(batch));
  });
}

function maxDate(a: string, b: string) {
  return a > b ? a : b;
}

/* ───────────────────────────── Bing ───────────────────────────── */

async function syncBing(payload: SyncPayload, ctx?: JobContext) {
  const { projectId } = payload;
  const row = await getIntegration(projectId, PROVIDERS.bing);
  if (!row) return { skipped: "not_connected" };
  const target = typeof row.config.siteUrl === "string" ? row.config.siteUrl : "";
  let creds: Awaited<ReturnType<typeof getBingCredentials>>;
  try {
    creds = await getBingCredentials(projectId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markIntegrationSync(projectId, PROVIDERS.bing, { ok: false, error: message }, target);
    return { error: message };
  }
  if (!creds) {
    const message = "No Bing Webmaster API key — add one in Integrations or ask an admin to set the instance key.";
    await markIntegrationSync(projectId, PROVIDERS.bing, { ok: false, error: message });
    return { error: message };
  }
  if (!creds.siteUrl) {
    await markIntegrationSync(projectId, PROVIDERS.bing, { ok: false, error: "No site URL configured." });
    return { error: "no_site" };
  }
  const floor = addDays(isoDate(new Date()), -SC_RETENTION_DAYS);
  try {
    await ctx?.progress({ done: 0, total: 4, phase: "sites" });
    const sites = await bingListSites(creds.apiKey);
    const match = sites.find((s) => sameBingSite(s.url, creds.siteUrl));
    if (!match) {
      const message = `The site ${creds.siteUrl} is not in this Bing Webmaster account.`;
      await markIntegrationSync(projectId, PROVIDERS.bing, { ok: false, error: message });
      return { error: message };
    }
    const siteUrl = match.url;

    await ctx?.progress({ done: 1, total: 4, phase: "traffic" });
    const traffic = (await bingTrafficStats(creds.apiKey, siteUrl)).filter((r) => r.date >= floor);
    const dailyMap = new Map<string, { clicks: number; impressions: number }>();
    for (const r of traffic) {
      const cur = dailyMap.get(r.date) ?? { clicks: 0, impressions: 0 };
      cur.clicks += r.clicks;
      cur.impressions += r.impressions;
      dailyMap.set(r.date, cur);
    }

    await ctx?.progress({ done: 2, total: 4, phase: "queries" });
    const queries = (await bingQueryStats(creds.apiKey, siteUrl)).filter((r) => r.date >= floor);
    await ctx?.progress({ done: 3, total: 4, phase: "pages" });
    const pages = (await bingPageStats(creds.apiKey, siteUrl)).filter((r) => r.date >= floor);

    // Impression-weighted daily position from query rows (Bing's traffic stats carry no position).
    const posByDate = new Map<string, { w: number; imp: number }>();
    for (const q of queries) {
      if (q.position == null) continue;
      const cur = posByDate.get(q.date) ?? { w: 0, imp: 0 };
      cur.w += q.position * q.impressions;
      cur.imp += q.impressions;
      posByDate.set(q.date, cur);
    }

    const aggregate = <T extends { date: string; key: string; clicks: number; impressions: number; position: number | null }>(rows: T[]) => {
      const m = new Map<string, { date: string; key: string; clicks: number; impressions: number; posW: number; posImp: number }>();
      for (const r of rows) {
        const k = `${r.date}\u0000${r.key}`;
        const cur = m.get(k) ?? { date: r.date, key: r.key, clicks: 0, impressions: 0, posW: 0, posImp: 0 };
        cur.clicks += r.clicks;
        cur.impressions += r.impressions;
        if (r.position != null) {
          cur.posW += r.position * Math.max(1, r.impressions);
          cur.posImp += Math.max(1, r.impressions);
        }
        m.set(k, cur);
      }
      return [...m.values()];
    };
    const qAgg = aggregate(queries);
    const pAgg = aggregate(pages);

    const trafficDates = [...dailyMap.keys()];
    const queryDates = [...new Set(qAgg.map((r) => r.date))];
    const pageDates = [...new Set(pAgg.map((r) => r.date))];

    await db.transaction(async (tx) => {
      await lockSyncTarget(tx, projectId, PROVIDERS.bing, target);
      if (trafficDates.length) {
        await tx.delete(scDaily).where(and(eq(scDaily.projectId, projectId), eq(scDaily.source, "bing"), inArray(scDaily.date, trafficDates)));
        await insertBatched(
          trafficDates.map((date) => {
            const t = dailyMap.get(date)!;
            const p = posByDate.get(date);
            return {
              projectId,
              source: "bing" as const,
              date,
              clicks: t.clicks,
              impressions: t.impressions,
              position: p && p.imp > 0 ? p.w / p.imp : null,
            };
          }),
          (batch) => tx.insert(scDaily).values(batch),
        );
      }
      if (queryDates.length) {
        await tx.delete(scQueries).where(and(eq(scQueries.projectId, projectId), eq(scQueries.source, "bing"), inArray(scQueries.date, queryDates)));
        await insertBatched(
          qAgg.map((r) => ({
            projectId,
            source: "bing" as const,
            date: r.date,
            query: clampQuery(r.key),
            country: "",
            clicks: r.clicks,
            impressions: r.impressions,
            position: r.posImp > 0 ? r.posW / r.posImp : null,
          })),
          (batch) => tx.insert(scQueries).values(batch),
        );
      }
      if (pageDates.length) {
        await tx.delete(scPages).where(and(eq(scPages.projectId, projectId), eq(scPages.source, "bing"), inArray(scPages.date, pageDates)));
        await insertBatched(
          pAgg.map((r) => ({
            projectId,
            source: "bing" as const,
            date: r.date,
            page: r.key.slice(0, 2000),
            query: "",
            clicks: r.clicks,
            impressions: r.impressions,
            position: r.posImp > 0 ? r.posW / r.posImp : null,
          })),
          (batch) => tx.insert(scPages).values(batch),
        );
      }
    });

    const newest = [...trafficDates, ...queryDates].sort().pop() ?? null;
    await markIntegrationSync(projectId, PROVIDERS.bing, {
      ok: true,
      config: {
        resolvedSiteUrl: siteUrl,
        syncedThrough: newest,
        keySource: creds.keySource,
        lastSyncStats: { days: trafficDates.length, queries: qAgg.length, pages: pAgg.length, at: new Date().toISOString() },
      },
    }, target);
    await ctx?.progress({ done: 4, total: 4, phase: "done" });
    return { source: "bing", siteUrl, days: trafficDates.length, queries: qAgg.length, pages: pAgg.length };
  } catch (err) {
    if (err instanceof SyncTargetChangedError) return { skipped: "target_changed" };
    const message = err instanceof Error ? err.message : String(err);
    await markIntegrationSync(projectId, PROVIDERS.bing, { ok: false, error: message }, target);
    if (/rejected the API key|not in this Bing/i.test(message)) return { error: message };
    throw err;
  }
}

/** Resets sync markers so the next run re-imports the full 16 months (used after property changes). */
export async function resetSearchConsoleSync(projectId: string, source: "google" | "bing") {
  await saveIntegration({
    projectId,
    provider: source === "google" ? PROVIDERS.gsc : PROVIDERS.bing,
    mergeConfig: { syncedThrough: null, backfilledFrom: null },
  });
}
