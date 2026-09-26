import "server-only";
import { and, count, eq, gte, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { invitations, projects, usageEvents, users, workspaceMembers, workspaces } from "@/server/db/schema";
import { getSetting } from "@/server/settings";
import { dfsUserData } from "@/server/dataforseo/client";
import { monthKeysBack } from "@/features/settings/billing/math";
import type { UserContext } from "@/server/auth/context";
import { reachableProjectIds, workspaceAccess } from "./access";
import { scopeCondition, type UsageScope } from "./usage";

/**
 * Billing & Costs (self-hosted): there is no subscription — this aggregates what the instance pays
 * providers directly, plus the live DataForSEO prepaid balance.
 */

export type DataForSeoBalance =
  | { status: "not_configured" }
  | { status: "ok"; balance: number; login: string; sandbox: boolean; checkedAt: string }
  | { status: "error"; message: string; checkedAt: string };

const BALANCE_TTL_MS = 10 * 60_000;
const BALANCE_ERROR_TTL_MS = 60_000;
let balanceCache: { at: number; ttl: number; key: string; value: DataForSeoBalance } | null = null;

/** Live DataForSEO account balance (`/v3/appendix/user_data`), cached for 10 minutes. */
export async function getDataForSeoBalance(opts: { force?: boolean } = {}): Promise<DataForSeoBalance> {
  const s = await getSetting("dataforseo");
  if (!s.login || !s.password) return { status: "not_configured" };
  // Cache per credential set, so switching accounts (or sandbox) never shows a stale balance.
  const key = `${s.login}|${s.sandbox ? "sandbox" : "live"}`;
  if (!opts.force && balanceCache && balanceCache.key === key && Date.now() - balanceCache.at < balanceCache.ttl) {
    return balanceCache.value;
  }
  let value: DataForSeoBalance;
  try {
    const data = await Promise.race([
      dfsUserData(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("DataForSEO did not answer within 10 seconds.")), 10_000)),
    ]);
    value = data
      ? { status: "ok", balance: data.balance, login: data.login, sandbox: s.sandbox, checkedAt: new Date().toISOString() }
      : { status: "error", message: "DataForSEO returned no account data.", checkedAt: new Date().toISOString() };
  } catch (err) {
    value = { status: "error", message: err instanceof Error ? err.message : String(err), checkedAt: new Date().toISOString() };
  }
  balanceCache = { at: Date.now(), ttl: value.status === "ok" ? BALANCE_TTL_MS : BALANCE_ERROR_TTL_MS, key, value };
  return value;
}

export type MonthRow = {
  /** YYYY-MM (UTC) */
  month: string;
  events: number;
  cost: number;
  providers: Record<string, number>;
};

/** Spend per UTC month (newest first) incl. per-provider breakdown, for the last `months` months. */
export async function getMonthlyHistory(scope: UsageScope, months = 12, now = new Date()): Promise<MonthRow[]> {
  const keys = monthKeysBack(now, months);
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
  const month = sql<string>`to_char(date_trunc('month', ${usageEvents.createdAt} at time zone 'UTC'), 'YYYY-MM')`;
  const rows = await db
    .select({
      month,
      provider: usageEvents.provider,
      cost: sql<number>`coalesce(sum(${usageEvents.costUsd}), 0)::float`,
      events: sql<number>`count(*)::int`,
    })
    .from(usageEvents)
    .where(and(gte(usageEvents.createdAt, since), scopeCondition(scope)))
    .groupBy(month, usageEvents.provider);
  const byMonth = new Map<string, MonthRow>(keys.map((k) => [k, { month: k, events: 0, cost: 0, providers: {} }]));
  for (const r of rows) {
    const m = byMonth.get(r.month);
    if (!m) continue;
    const cost = Number(r.cost ?? 0);
    m.events += Number(r.events ?? 0);
    m.cost += cost;
    m.providers[r.provider] = (m.providers[r.provider] ?? 0) + cost;
  }
  return keys.map((k) => byMonth.get(k)!);
}

export type PlanStats = {
  scope: "workspace" | "instance";
  name: string;
  projects: number;
  projectLimit: number;
  archivedProjects: number;
  members: number;
  pendingInvites: number;
  workspaces: number;
};

/** Counts for the "plan" card (no seat limits on self-hosted instances). */
export async function getPlanStats(scope: UsageScope): Promise<PlanStats> {
  const limits = await getSetting("limits");
  const now = new Date();
  if (scope.kind === "workspace") {
    const [[ws], [p], [a], [m], [i]] = await Promise.all([
      db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, scope.workspaceId)).limit(1),
      db
        .select({ n: count() })
        .from(projects)
        .where(and(eq(projects.workspaceId, scope.workspaceId), eq(projects.archived, false))),
      db
        .select({ n: count() })
        .from(projects)
        .where(and(eq(projects.workspaceId, scope.workspaceId), eq(projects.archived, true))),
      db.select({ n: count() }).from(workspaceMembers).where(eq(workspaceMembers.workspaceId, scope.workspaceId)),
      db
        .select({ n: count() })
        .from(invitations)
        .where(and(eq(invitations.workspaceId, scope.workspaceId), eq(invitations.status, "pending"), gte(invitations.expiresAt, now))),
    ]);
    return {
      scope: "workspace",
      name: ws?.name ?? "Workspace",
      projects: Number(p?.n ?? 0),
      projectLimit: limits.maxProjectsPerWorkspace,
      archivedProjects: Number(a?.n ?? 0),
      members: Number(m?.n ?? 0),
      pendingInvites: Number(i?.n ?? 0),
      workspaces: 1,
    };
  }
  const [[p], [a], [u], [i], [w]] = await Promise.all([
    db.select({ n: count() }).from(projects).where(eq(projects.archived, false)),
    db.select({ n: count() }).from(projects).where(eq(projects.archived, true)),
    db.select({ n: count() }).from(users).where(eq(users.status, "active")),
    db
      .select({ n: count() })
      .from(invitations)
      .where(and(eq(invitations.status, "pending"), gte(invitations.expiresAt, now))),
    db.select({ n: count() }).from(workspaces),
  ]);
  const general = await getSetting("general");
  return {
    scope: "instance",
    name: general.appName,
    projects: Number(p?.n ?? 0),
    projectLimit: limits.maxProjectsPerWorkspace,
    archivedProjects: Number(a?.n ?? 0),
    members: Number(u?.n ?? 0),
    pendingInvites: Number(i?.n ?? 0),
    workspaces: Number(w?.n ?? 0),
  };
}

export type BillingScope = {
  scope: UsageScope;
  scopeKind: "workspace" | "instance";
  /** Workspace the user looks at (null = instance scope without memberships). */
  workspaceId: string | null;
  viewable: { id: string; name: string; roleName: string }[];
  isAdmin: boolean;
  /** Project IDs visible to a project-restricted member (null = all). */
  reach: Set<string> | null;
};

/**
 * Resolves what a user may see on Billing & Costs: `usage.view` in the chosen workspace (or instance
 * admin). Instance scope (`?scope=instance`) is admin-only. Returns null when the user has no access.
 */
export async function resolveBillingScope(
  ctx: UserContext,
  params: { ws?: string | null; scope?: string | null },
): Promise<BillingScope | null> {
  const viewable = ctx.memberships.filter((m) => ctx.isInstanceAdmin || m.permissions.has("usage.view"));
  if (!viewable.length && !ctx.isInstanceAdmin) return null;
  if (params.ws && !viewable.some((m) => m.workspace.id === params.ws) && !ctx.isInstanceAdmin) return null;
  const membership = viewable.find((m) => m.workspace.id === params.ws) ?? viewable[0] ?? null;
  const instance = ctx.isInstanceAdmin && (params.scope === "instance" || !membership);
  let reach: Set<string> | null = null;
  if (!instance && membership) {
    const access = await workspaceAccess(ctx, membership.workspace.id);
    reach = access ? await reachableProjectIds(access) : new Set();
  }
  return {
    scope: instance || !membership ? { kind: "instance" } : { kind: "workspace", workspaceId: membership.workspace.id },
    scopeKind: instance || !membership ? "instance" : "workspace",
    workspaceId: membership?.workspace.id ?? null,
    viewable: viewable.map((m) => ({ id: m.workspace.id, name: m.workspace.name, roleName: m.roleName })),
    isAdmin: ctx.isInstanceAdmin,
    reach,
  };
}

/** Restricted members only see their projects by name; everything else is grouped. */
export function scopeProjectRows<T extends { key: string; name: string | null; domain: string | null; cost: number; events: number; units: number }>(
  rows: T[],
  reach: Set<string> | null,
): (T | { key: string; name: string; domain: null; cost: number; events: number; units: number })[] {
  if (!reach) return rows;
  const visible = rows.filter((r) => reach.has(r.key));
  const hidden = rows.filter((r) => !reach.has(r.key));
  if (!hidden.length) return visible;
  return [
    ...visible,
    {
      key: "__other",
      name: "Other projects",
      domain: null,
      cost: hidden.reduce((n, r) => n + r.cost, 0),
      events: hidden.reduce((n, r) => n + r.events, 0),
      units: hidden.reduce((n, r) => n + r.units, 0),
    },
  ];
}
