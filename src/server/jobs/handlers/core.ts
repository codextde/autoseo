import "server-only";
// Job handlers + schedules for the "core" module (instance maintenance).
import { z } from "zod";
import { defineJob, defineSchedule } from "../define";
import { enqueueJob } from "../queue";
import { DAILY_TASKS, HOURLY_TASKS, MAINTENANCE_TASKS, runMaintenance } from "@/server/admin/maintenance";

const payloadSchema = z.object({
  tasks: z.array(z.enum(MAINTENANCE_TASKS)).optional(),
  trigger: z.string().optional(),
});

defineJob<{ tasks?: string[]; trigger?: string }>({
  type: "core.maintenance",
  concurrency: 1,
  timeoutMs: 10 * 60_000,
  run: async (payload, ctx) => {
    const { tasks, trigger } = payloadSchema.parse(payload ?? {});
    const list = tasks?.length ? tasks : [...MAINTENANCE_TASKS];
    ctx.log(`running ${list.join(", ")} (${trigger ?? "manual"})`);
    const result = await runMaintenance(list);
    await ctx.progress({ done: list.length, total: list.length });
    return result;
  },
});

defineSchedule({
  name: "core.maintenance.hourly",
  cron: "17 * * * *",
  tick: async () => {
    await enqueueJob(
      "core.maintenance",
      { tasks: HOURLY_TASKS, trigger: "schedule:hourly" },
      { dedupeKey: "core.maintenance:hourly", priority: 200, maxAttempts: 2 },
    );
  },
});

defineSchedule({
  name: "core.maintenance.daily",
  cron: "40 3 * * *",
  tick: async () => {
    await enqueueJob(
      "core.maintenance",
      { tasks: DAILY_TASKS, trigger: "schedule:daily" },
      { dedupeKey: "core.maintenance:daily", priority: 200, maxAttempts: 2 },
    );
  },
});
