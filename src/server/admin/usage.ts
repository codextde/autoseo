import "server-only";
import { and, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db/client";
import { projects, usageEvents } from "@/server/db/schema";
import { getSetting } from "@/server/settings";
import { spendSince } from "@/server/usage";

/**
 * Self-hosted usage & cost reporting (replaces finseo "Billing"). Aggregates `usage_events`,
 * which every paid provider call records (DataForSEO, AI APIs, local agents).
 */
export type UsageScope = { kind: "instance" } | { kind: "workspace"; workspaceId: string };

export type UsageBreakdownRow = { key: string; cost: number; events: number; units: number };

export type UsageSummary = {
  from: string;
  to: string;
  totals: { cost: number; events: number; units: number };
  today: number;
  month: number;
  last30: number;
  byDay: { date: string; cost: number; events: number }[];
  byProvider: UsageBreakdownRow[];
  byFeature: UsageBreakdownRow[];
  byProject: (UsageBreakdownRow & { name: string | null; domain: string | null })[];
  /** Most expensive endpoints (e.g. DataForSEO paths, model names). */
  byEndpoint: (UsageBreakdownRow & { provider: string })[];
};

export function scopeCondition(scope: UsageScope): SQL | undefined {
  if (scope.kind === "instance") return undefined;
  const wsProjects = db.select({ id: projects.id }).from(projects).where(eq(projects.workspaceId, scope.workspaceId));
  return sql`(${usageEvents.workspaceId} = ${scope.workspaceId} OR ${inArray(usageEvents.projectId, wsProjects)})`;
}

function startOfUtcDay(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function startOfUtcMonth(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

async function sumSince(scope: UsageScope, since: Date): Promise<number> {
  const cond = scopeCondition(scope);
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${usageEvents.costUsd}), 0)` })
    .from(usageEvents)
    .where(and(gte(usageEvents.createdAt, since), cond));
  return Number(row?.total ?? 0);
}

const num = (v: unknown) => Number(v ?? 0);

export async function getUsageSummary(scope: UsageScope, from: Date, to: Date): Promise<UsageSummary> {
  const cond = and(gte(usageEvents.createdAt, from), lte(usageEvents.createdAt, to), scopeCondition(scope));
  const cost = sql<number>`coalesce(sum(${usageEvents.costUsd}), 0)`;
  const events = sql<number>`count(*)::int`;
  const units = sql<number>`coalesce(sum(${usageEvents.units}), 0)::bigint`;
  const day = sql<string>`to_char(date_trunc('day', ${usageEvents.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`;

  const [totalsRow, dayRows, providerRows, featureRows, projectRows, endpointRows, today, month, last30] = await Promise.all([
    db.select({ cost, events, units }).from(usageEvents).where(cond),
    db.select({ day, cost, events }).from(usageEvents).where(cond).groupBy(day).orderBy(day),
    db
      .select({ key: usageEvents.provider, cost, events, units })
      .from(usageEvents)
      .where(cond)
      .groupBy(usageEvents.provider)
      .orderBy(desc(cost)),
    db
      .select({ key: usageEvents.feature, cost, events, units })
      .from(usageEvents)
      .where(cond)
      .groupBy(usageEvents.feature)
      .orderBy(desc(cost))
      .limit(50),
    db
      .select({ key: usageEvents.projectId, name: projects.name, domain: projects.domain, cost, events, units })
      .from(usageEvents)
      .leftJoin(projects, eq(projects.id, usageEvents.projectId))
      .where(cond)
      .groupBy(usageEvents.projectId, projects.name, projects.domain)
      .orderBy(desc(cost))
      .limit(100),
    db
      .select({ key: usageEvents.endpoint, provider: usageEvents.provider, cost, events, units })
      .from(usageEvents)
      .where(cond)
      .groupBy(usageEvents.endpoint, usageEvents.provider)
      .orderBy(desc(cost))
      .limit(10),
    sumSince(scope, startOfUtcDay()),
    sumSince(scope, startOfUtcMonth()),
    sumSince(scope, new Date(Date.now() - 30 * 86_400_000)),
  ]);

  // Fill every day of the range so charts have a continuous axis.
  const byDate = new Map(dayRows.map((r) => [r.day, r]));
  const byDay: UsageSummary["byDay"] = [];
  const cursor = startOfUtcDay(from);
  const end = startOfUtcDay(to);
  let guard = 0;
  while (cursor <= end && guard++ < 400) {
    const key = cursor.toISOString().slice(0, 10);
    const r = byDate.get(key);
    byDay.push({ date: key, cost: Math.round(num(r?.cost) * 10000) / 10000, events: num(r?.events) });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const t = totalsRow[0];
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    totals: { cost: num(t?.cost), events: num(t?.events), units: num(t?.units) },
    today,
    month,
    last30,
    byDay,
    byProvider: providerRows.map((r) => ({ key: r.key, cost: num(r.cost), events: num(r.events), units: num(r.units) })),
    byFeature: featureRows.map((r) => ({ key: r.key, cost: num(r.cost), events: num(r.events), units: num(r.units) })),
    byProject: projectRows.map((r) => ({
      key: r.key ?? "",
      name: r.name,
      domain: r.domain,
      cost: num(r.cost),
      events: num(r.events),
      units: num(r.units),
    })),
    byEndpoint: endpointRows.map((r) => ({
      key: r.key ?? "—",
      provider: r.provider,
      cost: num(r.cost),
      events: num(r.events),
      units: num(r.units),
    })),
  };
}

export type BudgetStatus = {
  daily: { budget: number; spent: number };
  monthly: { budget: number; spent: number };
};

/** Instance-wide spend vs the budgets configured in Admin → Limits & Budgets (0 = no budget). */
export async function getBudgetStatus(): Promise<BudgetStatus> {
  const limits = await getSetting("limits");
  const [daySpent, monthSpent] = await Promise.all([spendSince(startOfUtcDay()), spendSince(startOfUtcMonth())]);
  return {
    daily: { budget: limits.dailyBudgetUsd, spent: daySpent },
    monthly: { budget: limits.monthlyBudgetUsd, spent: monthSpent },
  };
}
