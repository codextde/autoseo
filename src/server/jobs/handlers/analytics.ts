import "server-only";
// Job handlers + schedules for the "analytics" module (use defineJob / defineSchedule from ../define).
import { defineJob, defineSchedule } from "../define";
import { syncSearchConsole } from "@/server/analytics/search-console/sync";
import { refineQueryIntents } from "@/server/analytics/search-console/intents";
import { syncTraffic } from "@/server/analytics/traffic/sync";
import { processLogUpload } from "@/server/analytics/bots/process-upload";
import { refreshBotIpRanges } from "@/server/analytics/bots/ip-ranges";
import { enqueueDailyAnalyticsSyncs, pruneAnalyticsData } from "@/server/analytics/scheduling";
import type { TrafficProvider } from "@/server/db/schema";

/** Search Console (Google or Bing) → analytics_sc_* tables. */
defineJob<{ projectId: string; source: "google" | "bing"; full?: boolean }>({
  type: "analytics.sc.sync",
  concurrency: 2,
  timeoutMs: 30 * 60_000,
  run: (payload, ctx) => syncSearchConsole(payload, ctx),
});

/** Optional LLM refinement of search-query intents (Recommend / Information / Comparison / Action). */
defineJob<{ projectId: string; limit?: number }>({
  type: "analytics.sc.intents",
  concurrency: 1,
  timeoutMs: 15 * 60_000,
  retryable: false,
  run: (payload, ctx) => refineQueryIntents(payload, ctx),
});

/** GA4 / Matomo / Piwik PRO → normalized AI traffic tables. */
defineJob<{ projectId: string; provider: TrafficProvider; full?: boolean }>({
  type: "analytics.traffic.sync",
  concurrency: 2,
  timeoutMs: 30 * 60_000,
  run: (payload, ctx) => syncTraffic(payload, ctx),
});

/** Parses an uploaded log file (> 50 MB uploads are processed here in the background). */
defineJob<{ uploadId: string }>({
  type: "analytics.logs.process",
  concurrency: 1,
  timeoutMs: 60 * 60_000,
  retryable: false,
  run: (payload, ctx) => processLogUpload(payload, ctx),
});

/** Refreshes the cached IP range lists of crawler operators. */
defineJob({
  type: "analytics.bots.ip-ranges",
  concurrency: 1,
  run: () => refreshBotIpRanges(),
});

/** Retention: 16 months of search/traffic data, 13 months of bot visits, stale uploads. */
defineJob({
  type: "analytics.prune",
  concurrency: 1,
  run: () => pruneAnalyticsData(),
});

defineSchedule({
  name: "analytics.daily-sync",
  cron: "20 4 * * *",
  tick: () => enqueueDailyAnalyticsSyncs(),
});

defineSchedule({
  name: "analytics.ip-ranges",
  cron: "5 3 * * *",
  tick: async () => {
    const { enqueueJob } = await import("../queue");
    await enqueueJob("analytics.bots.ip-ranges", {}, { dedupeKey: "analytics.bots.ip-ranges" });
  },
});

defineSchedule({
  name: "analytics.prune",
  cron: "40 2 * * *",
  tick: async () => {
    const { enqueueJob } = await import("../queue");
    await enqueueJob("analytics.prune", {}, { dedupeKey: "analytics.prune" });
  },
});
