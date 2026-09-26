/**
 * Per-audit politeness / 429 pacing (port of open-seo `crawl-throttle.ts`).
 * State is checkpointed to the audit row after every change and carried across chunks/restarts.
 */
import type { CrawlThrottleState } from "./throttle-state";

/** Retries per URL after its first 429. Every 429 still pauses new URLs. */
export const THROTTLE_MAX_RETRIES = 3;
const FIRST_DELAY_MS = 30_000;
const MAX_INTERVAL_MS = 30_000;
export const MAX_COOLDOWN_MS = 30 * 60_000;

export type { CrawlThrottleState };

/** `Retry-After` is delay-seconds or an HTTP-date. */
export function parseRetryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const value = header.trim();
  if (/^\d+$/.test(value)) return Math.min(Number(value) * 1_000, MAX_COOLDOWN_MS + 1);
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

export interface CrawlThrottle {
  /** False when this chunk can no longer start a request (deadline / stopped). */
  ready(): Promise<boolean>;
  /** Pause the origin on every 429; returns whether this URL may retry. */
  backoff(attempt: number, retryAfter: string | null): Promise<boolean>;
  /** A non-429 response breaks a run of consecutive refusals. */
  recovered(): Promise<void>;
  readonly checkpointFailed: boolean;
  readonly stopped: boolean;
  readonly state: CrawlThrottleState;
}

export function initialThrottleState(intervalMs: number): CrawlThrottleState {
  return { intervalMs, nextRequestAt: 0, pausedUntil: 0, consecutiveRateLimits: 0, cooldownMs: 0 };
}

export function createCrawlThrottle(
  deadlineAt: number,
  previous: CrawlThrottleState,
  persist?: (state: CrawlThrottleState) => Promise<void>,
  opts: { minIntervalMs?: number } = {},
): CrawlThrottle {
  const state: CrawlThrottleState = { ...previous };
  if (opts.minIntervalMs !== undefined) state.intervalMs = Math.max(state.intervalMs, opts.minIntervalMs);
  let checkpointFailed = false;
  let checkpoint = Promise.resolve();
  const save = () => {
    const snapshot = { ...state };
    checkpoint = checkpoint
      .then(() => persist?.(snapshot))
      .catch((error) => {
        checkpointFailed = true;
        throw error;
      });
    return checkpoint;
  };
  const stopped = () => checkpointFailed || state.consecutiveRateLimits > THROTTLE_MAX_RETRIES || state.cooldownMs > MAX_COOLDOWN_MS;
  return {
    async ready() {
      while (!stopped()) {
        await checkpoint.catch(() => {});
        const now = Date.now();
        const readyAt = Math.max(state.pausedUntil, state.nextRequestAt);
        if (now >= deadlineAt || readyAt >= deadlineAt) return false;
        if (readyAt <= now) {
          // Reserve synchronously: waiters waking together must take turns.
          state.nextRequestAt = now + state.intervalMs;
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, readyAt - now));
      }
      return false;
    },
    async backoff(attempt, retryAfter) {
      state.consecutiveRateLimits += 1;
      state.intervalMs = Math.min(MAX_INTERVAL_MS, state.intervalMs * 2);
      const delayMs = Math.max(
        state.intervalMs,
        parseRetryAfterMs(retryAfter) ?? FIRST_DELAY_MS * 2 ** (state.consecutiveRateLimits - 1),
      );
      const now = Date.now();
      const pausedUntil = Math.max(state.pausedUntil, now + delayMs);
      state.cooldownMs += pausedUntil - Math.max(now, state.pausedUntil);
      state.pausedUntil = pausedUntil;
      await save();
      return !stopped() && attempt <= THROTTLE_MAX_RETRIES;
    },
    async recovered() {
      if (state.consecutiveRateLimits === 0) return;
      state.consecutiveRateLimits = 0;
      await save();
    },
    get checkpointFailed() {
      return checkpointFailed;
    },
    get stopped() {
      return stopped();
    },
    get state() {
      return { ...state };
    },
  };
}
