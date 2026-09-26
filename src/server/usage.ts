import "server-only";
import { and, gte, sql, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { usageEvents } from "@/server/db/schema";
import { getSetting } from "@/server/settings";

export type UsageInput = {
  provider: string;
  feature: string;
  endpoint?: string;
  units?: number;
  costUsd?: number;
  projectId?: string | null;
  workspaceId?: string | null;
  userId?: string | null;
  meta?: Record<string, unknown>;
};

export async function recordUsage(input: UsageInput) {
  try {
    await db.insert(usageEvents).values({
      provider: input.provider,
      feature: input.feature,
      endpoint: input.endpoint ?? null,
      units: input.units ?? 1,
      costUsd: input.costUsd ?? 0,
      projectId: input.projectId ?? null,
      workspaceId: input.workspaceId ?? null,
      userId: input.userId ?? null,
      meta: input.meta ?? {},
    });
  } catch (err) {
    console.error("[usage] failed to record", err);
  }
}

export async function spendSince(since: Date, workspaceId?: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${usageEvents.costUsd}), 0)` })
    .from(usageEvents)
    .where(and(gte(usageEvents.createdAt, since), workspaceId ? eq(usageEvents.workspaceId, workspaceId) : sql`true`));
  return Number(row?.total ?? 0);
}

export class BudgetExceededError extends Error {}

/** Throws when the configured daily/monthly budget (Admin → Limits) is exhausted. */
export async function assertBudget(estimatedCostUsd = 0) {
  const limits = await getSetting("limits");
  const now = new Date();
  if (limits.dailyBudgetUsd > 0) {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const spent = await spendSince(day);
    if (spent + estimatedCostUsd > limits.dailyBudgetUsd)
      throw new BudgetExceededError(`Daily budget of $${limits.dailyBudgetUsd} reached ($${spent.toFixed(2)} spent).`);
  }
  if (limits.monthlyBudgetUsd > 0) {
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const spent = await spendSince(month);
    if (spent + estimatedCostUsd > limits.monthlyBudgetUsd)
      throw new BudgetExceededError(`Monthly budget of $${limits.monthlyBudgetUsd} reached ($${spent.toFixed(2)} spent).`);
  }
}
