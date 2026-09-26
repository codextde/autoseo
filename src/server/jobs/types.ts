import type { JobRow } from "./queue";

export type JobContext = {
  job: JobRow;
  /** Update the job's progress JSON (shown in UIs). */
  progress: (p: Record<string, unknown>) => Promise<void>;
  /** True when the job was cancelled from the UI; long handlers should check periodically. */
  isCancelled: () => Promise<boolean>;
  log: (...args: unknown[]) => void;
};

export type JobHandler<P = Record<string, unknown>> = {
  type: string;
  /** Max jobs of this type running at once in this process. */
  concurrency?: number;
  /** Per-attempt timeout in ms (default 15 min). */
  timeoutMs?: number;
  /** When false, failures are never retried (e.g. billed external calls). */
  retryable?: boolean;
  run: (payload: P, ctx: JobContext) => Promise<unknown>;
};

export type Schedule = {
  /** Unique name, also used as dedupe key prefix. */
  name: string;
  /** Cron expression (UTC). */
  cron: string;
  /** Called on each tick; usually enqueues jobs. */
  tick: () => Promise<void>;
};
