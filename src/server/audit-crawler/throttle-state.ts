export type CrawlThrottleState = {
  intervalMs: number;
  nextRequestAt: number;
  pausedUntil: number;
  consecutiveRateLimits: number;
  cooldownMs: number;
};
