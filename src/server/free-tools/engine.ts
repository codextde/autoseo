import "server-only";
import { DataForSeoError, DataForSeoNotConfiguredError } from "@/server/dataforseo/client";
import { BudgetExceededError } from "@/server/usage";
import { readCached, writeCached, type CachedEnvelope } from "./cache";
import type { ProviderDeps, ServerTool } from "./tools";

export type Refusal = { status: number; error: string };

export type EngineDeps = {
  providers: ProviderDeps;
  /**
   * Called once with the billable calls of the uncached units, BEFORE any provider call (public budget ledger).
   * Returns a refusal to stop the run. Not called when everything is cached or the tool is free.
   */
  reserve?: (calls: number) => Promise<Refusal | null>;
};

export type EngineOutcome<R = unknown> =
  | { ok: true; data: R; calls: number; cacheHit: boolean; ttl: number }
  | { ok: false; status: number; error: string; cause?: unknown; cached?: boolean };

/**
 * Errors raised before any money was spent (config, admin budget, rejected credentials, empty balance) — never
 * cached as a failure envelope, so the real cause surfaces and a fixed config works immediately.
 */
export function isUnspentError(err: unknown): boolean {
  if (err instanceof BudgetExceededError || err instanceof DataForSeoNotConfiguredError) return true;
  return err instanceof DataForSeoError && (err.statusCode === 401 || err.statusCode === 402);
}

/**
 * Runs a tool plan with the shared result cache (open-seo order): cached failure → 502; cache hits are served
 * without reserving budget or contacting a provider; misses reserve their calls first, then fetch in parallel.
 * Successful units are cached with their TTL, failed ones get a short failure envelope (the money was spent).
 */
export async function executeTool<P, R>(tool: ServerTool<P, R>, params: P, deps: EngineDeps): Promise<EngineOutcome<R>> {
  const plan = tool.plan(params);
  const cached = await Promise.all(plan.units.map((u) => readCached<unknown>(tool.slug, u.key)));

  const failed = cached.find((e): e is Extract<CachedEnvelope<unknown>, { ok: false }> => !!e && !e.ok);
  if (failed) return { ok: false, status: 502, error: failed.error, cached: true };

  const missIdx = plan.units.map((_, i) => i).filter((i) => !cached[i]);
  const calls = missIdx.reduce((sum, i) => sum + plan.units[i]!.calls, 0);

  if (calls > 0 && deps.reserve) {
    const refusal = await deps.reserve(calls);
    if (refusal) return { ok: false, ...refusal };
  }

  const settled = await Promise.allSettled(missIdx.map((i) => plan.units[i]!.fetch(deps.providers)));
  const values: unknown[] = plan.units.map((_, i) => {
    const hit = cached[i];
    return hit && hit.ok ? hit.data : undefined;
  });
  let firstError: unknown = null;
  await Promise.all(
    settled.map(async (res, j) => {
      const unit = plan.units[missIdx[j]!]!;
      if (res.status === "fulfilled") {
        values[missIdx[j]!] = res.value;
        await writeCached(tool.slug, unit.key, { ok: true, data: res.value }, unit.ttl(res.value));
      } else {
        firstError ??= res.reason;
        if (!isUnspentError(res.reason)) {
          await writeCached(tool.slug, unit.key, { ok: false, error: plan.failureMessage }, unit.failureTtl);
        }
      }
    }),
  );

  if (firstError) {
    console.error(`[free-tools] ${tool.slug} failed:`, firstError instanceof Error ? firstError.message : firstError);
    return { ok: false, status: 502, error: plan.failureMessage, cause: firstError };
  }

  const ttl = Math.min(...plan.units.map((u, i) => u.ttl(values[i])));
  return { ok: true, data: plan.combine(values), calls, cacheHit: missIdx.length === 0, ttl };
}
