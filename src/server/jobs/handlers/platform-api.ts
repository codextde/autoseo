import "server-only";
// Job handlers + schedules for the "platform-api" module (REST API, MCP, OAuth).
import { defineJob, defineSchedule } from "../define";
import { enqueueJob } from "../queue";
import { cleanupPlatformApi } from "@/server/api/cleanup";

/** Daily 03:17 UTC: purge expired OAuth codes/tokens, unused client registrations and old request logs. */
defineSchedule({
  name: "platform_api.cleanup",
  cron: "17 3 * * *",
  tick: async () => {
    await enqueueJob("platform_api.cleanup", {}, { dedupeKey: "platform_api.cleanup", maxAttempts: 1 });
  },
});

defineJob<Record<string, never>>({
  type: "platform_api.cleanup",
  concurrency: 1,
  retryable: false,
  run: async () => cleanupPlatformApi(),
});
