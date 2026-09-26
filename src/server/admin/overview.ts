import "server-only";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLogs, invitations, jobs, projects, usageEvents, users, workspaces } from "@/server/db/schema";
import { getSetting } from "@/server/settings";
import { spendSince } from "@/server/usage";
import { env } from "@/server/env";
import { verifySmtp } from "@/server/email";
import { availableLlmProviders } from "@/server/ai/llm";
import { hasOnlineAgent } from "@/server/agents/dispatch";
import { dfsUserData } from "@/server/dataforseo/client";

function startOfUtcDay(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function getOverviewStats() {
  const now = new Date();
  const dayAgo = new Date(Date.now() - 86_400_000);
  const monthAgo = new Date(Date.now() - 30 * 86_400_000);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [userStats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      disabled: sql<number>`count(*) filter (where ${users.status} = 'disabled')::int`,
      active30: sql<number>`count(*) filter (where ${users.lastLoginAt} > ${monthAgo.toISOString()}::timestamptz)::int`,
      admins: sql<number>`count(*) filter (where ${users.isInstanceAdmin})::int`,
    })
    .from(users);
  const [inviteStats] = await db
    .select({ pending: sql<number>`count(*)::int` })
    .from(invitations)
    .where(and(eq(invitations.status, "pending"), gte(invitations.expiresAt, now)));
  const [projectStats] = await db
    .select({
      active: sql<number>`count(*) filter (where not ${projects.archived})::int`,
      archived: sql<number>`count(*) filter (where ${projects.archived})::int`,
      pitch: sql<number>`count(*) filter (where ${projects.isPitch} and not ${projects.archived})::int`,
    })
    .from(projects);
  const [wsStats] = await db.select({ n: sql<number>`count(*)::int` }).from(workspaces);
  const [jobStats] = await db
    .select({
      queued: sql<number>`count(*) filter (where ${jobs.status} = 'queued')::int`,
      due: sql<number>`count(*) filter (where ${jobs.status} = 'queued' and ${jobs.runAt} <= now())::int`,
      running: sql<number>`count(*) filter (where ${jobs.status} = 'running')::int`,
      failed24: sql<number>`count(*) filter (where ${jobs.status} = 'failed' and ${jobs.finishedAt} > ${dayAgo.toISOString()}::timestamptz)::int`,
      succeeded24: sql<number>`count(*) filter (where ${jobs.status} = 'succeeded' and ${jobs.finishedAt} > ${dayAgo.toISOString()}::timestamptz)::int`,
      oldestDue: sql<string | null>`min(${jobs.runAt}) filter (where ${jobs.status} = 'queued' and ${jobs.runAt} <= now())`,
    })
    .from(jobs);
  const [usage24] = await db
    .select({ events: sql<number>`count(*)::int` })
    .from(usageEvents)
    .where(gte(usageEvents.createdAt, dayAgo));

  const [spentToday, spentMonth, limits] = await Promise.all([
    spendSince(startOfUtcDay()),
    spendSince(monthStart),
    getSetting("limits"),
  ]);

  // Daily cost + logins for the last 14 days
  const since = startOfUtcDay(new Date(Date.now() - 13 * 86_400_000));
  const costRows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${usageEvents.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
      cost: sql<number>`coalesce(sum(${usageEvents.costUsd}), 0)::float`,
    })
    .from(usageEvents)
    .where(gte(usageEvents.createdAt, since))
    .groupBy(sql`1`);
  const loginRows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${auditLogs.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
      n: sql<number>`count(*)::int`,
    })
    .from(auditLogs)
    .where(and(eq(auditLogs.action, "auth.login"), gte(auditLogs.createdAt, since)))
    .groupBy(sql`1`);
  const costByDay = new Map(costRows.map((r) => [r.day, Number(r.cost)]));
  const loginsByDay = new Map(loginRows.map((r) => [r.day, Number(r.n)]));
  const activity = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(since.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    return { date: d, cost: Math.round((costByDay.get(d) ?? 0) * 100) / 100, logins: loginsByDay.get(d) ?? 0 };
  });

  const recentAudit = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      actorEmail: auditLogs.actorEmail,
      targetType: auditLogs.targetType,
      targetId: auditLogs.targetId,
      ip: auditLogs.ip,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .orderBy(desc(auditLogs.createdAt))
    .limit(12);

  return {
    users: {
      total: Number(userStats?.total ?? 0),
      disabled: Number(userStats?.disabled ?? 0),
      active30: Number(userStats?.active30 ?? 0),
      admins: Number(userStats?.admins ?? 0),
      pendingInvites: Number(inviteStats?.pending ?? 0),
    },
    projects: {
      active: Number(projectStats?.active ?? 0),
      archived: Number(projectStats?.archived ?? 0),
      pitch: Number(projectStats?.pitch ?? 0),
      workspaces: Number(wsStats?.n ?? 0),
    },
    jobs: {
      queued: Number(jobStats?.queued ?? 0),
      due: Number(jobStats?.due ?? 0),
      running: Number(jobStats?.running ?? 0),
      failed24: Number(jobStats?.failed24 ?? 0),
      succeeded24: Number(jobStats?.succeeded24 ?? 0),
      oldestDue: jobStats?.oldestDue ? new Date(jobStats.oldestDue) : null,
    },
    usage: {
      spentToday,
      spentMonth,
      events24: Number(usage24?.events ?? 0),
      dailyBudget: limits.dailyBudgetUsd,
      monthlyBudget: limits.monthlyBudgetUsd,
    },
    activity,
    recentAudit,
    version: { commit: env.buildCommit, buildDate: env.buildDate, appUrl: env.appUrl },
  };
}

export type HealthStatus = "ok" | "warning" | "error" | "off";
export type HealthCheck = { key: string; label: string; status: HealthStatus; summary: string; detail?: string; href: string };

type Cached = { at: number; value: HealthCheck };
const healthCache = new Map<string, Cached>();

async function cached(key: string, ttlMs: number, fn: () => Promise<HealthCheck>, force: boolean) {
  const hit = healthCache.get(key);
  if (!force && hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await fn().catch(
    (err): HealthCheck => ({ key, label: key, status: "error", summary: "Check failed", detail: err instanceof Error ? err.message : String(err), href: "/admin" }),
  );
  healthCache.set(key, { at: Date.now(), value });
  return value;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms))]);
}

/** Live health checks (SMTP handshake, DataForSEO balance, AI providers, agents, DB, queue). */
export async function runHealthChecks(force = false): Promise<HealthCheck[]> {
  const checks = await Promise.all([
    cached(
      "db",
      0,
      async () => {
        const started = Date.now();
        const rows = (await db.execute(sql`select pg_database_size(current_database())::bigint as size`)) as unknown as Array<{ size: string }>;
        const ms = Date.now() - started;
        const mb = Number(rows[0]?.size ?? 0) / 1024 / 1024;
        return {
          key: "db",
          label: "Database",
          status: ms > 500 ? "warning" : "ok",
          summary: `${ms} ms · ${mb.toFixed(1)} MB`,
          detail: "PostgreSQL reachable",
          href: "/admin/system",
        };
      },
      force,
    ),
    cached(
      "smtp",
      5 * 60_000,
      async () => {
        const smtp = await getSetting("smtp");
        if (!smtp.enabled) {
          return { key: "smtp", label: "Email", status: "warning", summary: "Not configured", detail: "Sign-in links are written to the server log.", href: "/admin/email" };
        }
        const res = await withTimeout(verifySmtp(), 10_000, "SMTP check");
        return res.ok
          ? { key: "smtp", label: "Email", status: "ok", summary: smtp.preset === "ses" ? `Amazon SES · ${smtp.sesRegion}` : smtp.host, detail: smtp.fromEmail, href: "/admin/email" }
          : { key: "smtp", label: "Email", status: "error", summary: "Connection failed", detail: res.error, href: "/admin/email" };
      },
      force,
    ),
    cached(
      "ai",
      60_000,
      async () => {
        const providers = await availableLlmProviders();
        if (!providers.length) {
          return { key: "ai", label: "AI providers", status: "error", summary: "None available", detail: "Add an API key or connect a local agent.", href: "/admin/ai" };
        }
        const names = providers.map((p) => (p === "agent" ? "Local agent" : p[0]!.toUpperCase() + p.slice(1)));
        return { key: "ai", label: "AI providers", status: "ok", summary: names.join(", "), href: "/admin/ai" };
      },
      force,
    ),
    cached(
      "dataforseo",
      5 * 60_000,
      async () => {
        const s = await getSetting("dataforseo");
        if (!s.login || !s.password) {
          return { key: "dataforseo", label: "DataForSEO", status: "off", summary: "Not connected", detail: "Needed for SEO data and several AI engines.", href: "/admin/data" };
        }
        const data = await withTimeout(dfsUserData(), 10_000, "DataForSEO check");
        if (!data) return { key: "dataforseo", label: "DataForSEO", status: "error", summary: "No account data", href: "/admin/data" };
        return {
          key: "dataforseo",
          label: "DataForSEO",
          status: data.balance < 5 ? "warning" : "ok",
          summary: `$${data.balance.toFixed(2)} balance`,
          detail: `${data.login}${s.sandbox ? " · sandbox" : ""}`,
          href: "/admin/data",
        };
      },
      force,
    ),
    cached(
      "agents",
      30_000,
      async () => {
        const settings = await getSetting("agents");
        if (!settings.enabled) return { key: "agents", label: "Local agents", status: "off", summary: "Disabled", href: "/admin/agents" };
        const online = await hasOnlineAgent("any").catch(() => false);
        return online
          ? { key: "agents", label: "Local agents", status: "ok", summary: "Online", detail: "Claude Code / Codex agent connected", href: "/admin/agents" }
          : { key: "agents", label: "Local agents", status: "warning", summary: "None online", detail: "AI work falls back to API keys.", href: "/admin/agents" };
      },
      force,
    ),
    cached(
      "queue",
      0,
      async () => {
        const [row] = await db
          .select({
            due: sql<number>`count(*)::int`,
            oldest: sql<string | null>`min(${jobs.runAt})`,
          })
          .from(jobs)
          .where(and(eq(jobs.status, "queued"), lte(jobs.runAt, new Date())));
        const due = Number(row?.due ?? 0);
        const ageMin = row?.oldest ? (Date.now() - new Date(row.oldest).getTime()) / 60_000 : 0;
        const status: HealthStatus = due === 0 ? "ok" : ageMin > 30 ? "error" : ageMin > 5 ? "warning" : "ok";
        return {
          key: "queue",
          label: "Job queue",
          status,
          summary: due === 0 ? "No backlog" : `${due} waiting`,
          detail: due ? `Oldest waiting ${Math.round(ageMin)} min` : undefined,
          href: "/admin/jobs",
        };
      },
      force,
    ),
  ]);
  return checks;
}

/** Setup checklist for new instances. */
export async function getSetupChecklist() {
  const [smtp, auth, ai, dfs] = await Promise.all([getSetting("smtp"), getSetting("auth"), getSetting("ai"), getSetting("dataforseo")]);
  const [{ n: userCount } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  const [{ n: inviteCount } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(invitations);
  const [{ n: projectCount } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(projects);
  const agentOnline = await hasOnlineAgent("any").catch(() => false);
  return [
    { key: "email", label: "Configure email delivery", description: "SMTP or Amazon SES for magic links and invitations.", done: smtp.enabled && !!smtp.fromEmail, href: "/admin/email" },
    { key: "domains", label: "Restrict sign-in to your domains", description: "Only invited people from allowed domains can sign in.", done: auth.allowedDomains.length > 0, href: "/admin/auth" },
    {
      key: "ai",
      label: "Connect an AI provider",
      description: "A local agent (Claude Code / Codex) or an API key powers all AI features.",
      done: agentOnline || !!(ai.anthropicApiKey || ai.openaiApiKey || ai.openrouterApiKey),
      href: "/admin/ai",
    },
    { key: "dataforseo", label: "Connect DataForSEO", description: "Keyword, SERP, backlink and AI engine data.", done: !!(dfs.login && dfs.password), href: "/admin/data" },
    { key: "team", label: "Invite your team", description: "Invite colleagues with a role and project access.", done: Number(userCount) > 1 || Number(inviteCount) > 0, href: "/admin/invitations" },
    { key: "project", label: "Create the first project", description: "The onboarding wizard sets up prompts and competitors.", done: Number(projectCount) > 0, href: "/onboarding" },
  ];
}
