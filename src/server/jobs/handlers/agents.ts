import "server-only";
import { and, gt, isNotNull, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { agents, type AgentCommand } from "@/server/db/schema";
import { newId } from "@/server/db/schema/_helpers";
import { getSetting } from "@/server/settings";
import { offlineAfterSeconds } from "@/server/agents/core";
import { pruneAgentData, sweepAgentJobs } from "@/server/agents/jobs";
import { defineJob, defineSchedule } from "../define";
import { enqueueJob } from "../queue";

// Job handlers + schedules for the "agents" module.

/** Offline detection, lost-job requeue, timeouts and queue expiry (cheap SQL, every 30s). */
defineSchedule({
  name: "agents.sweep",
  cron: "*/30 * * * * *",
  tick: async () => {
    const stats = await sweepAgentJobs();
    if (stats.offline || stats.requeued || stats.timedOut || stats.expired) console.info("[agents] sweep", stats);
  },
});

/** Hourly: ask online agents to delete finished job folders older than `autoCleanupHours`. */
defineJob<Record<string, never>>({
  type: "agents.auto_cleanup",
  concurrency: 1,
  retryable: false,
  run: async () => {
    const settings = await getSetting("agents");
    if (settings.autoCleanupHours <= 0) return { skipped: true };
    const since = new Date(Date.now() - offlineAfterSeconds(settings) * 1000);
    const online = await db
      .select({ id: agents.id, commands: agents.commands })
      .from(agents)
      .where(and(isNotNull(agents.lastSeenAt), gt(agents.lastSeenAt, since)));
    for (const a of online) {
      if ((a.commands ?? []).some((c) => c.type === "cleanup")) continue;
      const cmd: AgentCommand = {
        id: newId("cmd"),
        type: "cleanup",
        maxAgeHours: settings.autoCleanupHours,
        auto: true,
        requestedAt: new Date().toISOString(),
      };
      await db
        .update(agents)
        .set({ commands: sql`${agents.commands} || ${JSON.stringify([cmd])}::jsonb` })
        .where(sql`${agents.id} = ${a.id}`);
    }
    return { agents: online.length };
  },
});

/** Retention for logs, events, check-in history and old jobs. */
defineJob<Record<string, never>>({
  type: "agents.prune",
  concurrency: 1,
  run: async () => {
    await pruneAgentData();
    return { ok: true };
  },
});

defineSchedule({
  name: "agents.hourly",
  cron: "7 * * * *",
  tick: async () => {
    await enqueueJob("agents.auto_cleanup", {}, { dedupeKey: "agents.auto_cleanup", maxAttempts: 1 });
    await enqueueJob("agents.prune", {}, { dedupeKey: "agents.prune", maxAttempts: 2 });
  },
});
