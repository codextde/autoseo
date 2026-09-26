import type { JobHandler, Schedule } from "./types";

const handlers = new Map<string, JobHandler<never>>();
const schedules = new Map<string, Schedule>();

/** Registers a job handler. Call at module top-level in `src/server/jobs/handlers/*.ts`. */
export function defineJob<P = Record<string, unknown>>(handler: JobHandler<P>): JobHandler<P> {
  handlers.set(handler.type, handler as unknown as JobHandler<never>);
  return handler;
}

/** Registers a cron schedule (UTC). */
export function defineSchedule(schedule: Schedule): Schedule {
  schedules.set(schedule.name, schedule);
  return schedule;
}

export function getHandlers() {
  return handlers;
}
export function getSchedules() {
  return schedules;
}
