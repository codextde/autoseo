import "server-only";
import { and, count, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { aiRuns, apiKeys, competitors, integrations, invitations, projects, prompts, seoSearchHistory, workspaceMembers } from "@/server/db/schema";
import { isDataForSeoConfigured } from "@/server/dataforseo/client";
import { availableLlmProviders } from "@/server/ai/llm";
import { hasOnlineAgent } from "@/server/agents/dispatch";
import { getSetting } from "@/server/settings";
import type { ProjectContext } from "@/server/auth/context";
import type { MetricKey } from "@/features/ai-insights/lib/metrics";
import type { BrandDTO } from "@/features/ai-insights/types";
import { getBrands, OWN_KEY } from "./brands";
import { loadBrandMetrics, metricsByBrand, metricsByDim, sumsOf, toMetrics } from "./brand-metrics";
import { toBrandDTO } from "./competitors";
import { dayRange, delta, rows, scope, type InsightFilter } from "./filters";
import { getPromptMap } from "./prompts";

type ProjectRow = typeof projects.$inferSelect;

export const CHECKLIST_STEPS = [
  "domain",
  "prompts",
  "competitors",
  "engines",
  "providers",
  "analytics",
  "research",
  "projects",
  "mcp",
  "agent",
  "team",
] as const;
export type ChecklistStep = (typeof CHECKLIST_STEPS)[number];

export type ChecklistItem = {
  key: ChecklistStep;
  title: string;
  description: string;
  done: boolean;
  /** "Skip for now" by the current user. */
  skipped: boolean;
  /** The user has the permission to complete this step. */
  allowed: boolean;
  href: string;
  cta: string;
  adminOnly?: boolean;
  startHere?: boolean;
};

export type DashboardData = {
  hasData: boolean;
  isDemo: boolean;
  latestRun: { status: string; done: number; total: number; failed: number; createdAt: string; finishedAt: string | null } | null;
  counts: { prompts: number; competitors: number; engines: number };
  kpis: { key: MetricKey; value: number | null; delta: number | null; spark: number[] }[];
  trend: { dates: string[]; series: { key: string; brand: BrandDTO; values: (number | null)[] }[] };
  ranking: { brand: BrandDTO; visibility: number | null; delta: number | null }[];
  sources: { domain: string; citations: number; delta: number | null; ownership: string }[];
  movers: { promptId: string; text: string; country: string; visibility: number; delta: number }[];
  engines: { engine: string; enabled: boolean; answers: number; visibility: number | null }[];
  checklist: ChecklistItem[];
  totals: { answers: number };
};

export async function getDashboard(ctx: ProjectContext, f: InsightFilter): Promise<DashboardData> {
  const project = ctx.project;
  const [anyAnswer, runRows, counts, checklist] = await Promise.all([
    rows<{ n: number }>(sql`select count(*)::int as n from (select 1 from ai_answers where project_id = ${project.id} limit 1) x`),
    db.select().from(aiRuns).where(eq(aiRuns.projectId, project.id)).orderBy(desc(aiRuns.createdAt)).limit(1),
    getCounts(project),
    getChecklist(ctx),
  ]);
  const run = runRows[0];
  const latestRun = run
    ? {
        status: run.status,
        done: run.doneTasks,
        total: run.totalTasks,
        failed: run.failedTasks,
        createdAt: run.createdAt.toISOString(),
        finishedAt: run.finishedAt?.toISOString() ?? null,
      }
    : null;
  const isDemo = Boolean((project.settings as { demo?: unknown } | null)?.demo);
  const base = { isDemo, latestRun, counts, checklist };

  if (!anyAnswer[0]?.n) {
    return {
      ...base,
      hasData: false,
      kpis: [],
      trend: { dates: [], series: [] },
      ranking: [],
      sources: [],
      movers: [],
      engines: (project.engines ?? []).map((e) => ({ engine: e, enabled: true, answers: 0, visibility: null })),
      totals: { answers: 0 },
    };
  }

  const brands = await getBrands(project);
  const keys = brands.map((b) => b.key);
  const [cur, prev, srcRows, promptMap] = await Promise.all([
    loadBrandMetrics(f, "cur", ["date", "engine", "prompt"]),
    loadBrandMetrics(f, "prev", ["prompt"]),
    rows<{ domain: string; n: number; prev_n: number; ownership: string }>(sql`
      select s.domain, (count(*) filter (where c.answer_date >= ${f.from}::date))::int as n,
             (count(*) filter (where c.answer_date < ${f.from}::date))::int as prev_n,
             case when bool_or(s.ownership = 'own') then 'own' when bool_or(s.ownership = 'competitor') then 'competitor' else 'third_party' end as ownership
      from ai_citations c join ai_sources s on s.id = c.source_id
      where ${scope(f, "c", "both")}
      group by 1 order by 2 desc limit 6`),
    getPromptMap(project.id),
  ]);
  const curM = metricsByBrand(cur, keys);
  const prevM = metricsByBrand(prev, keys);
  const byDate = metricsByDim(cur, "date", keys);
  const dates = dayRange(f.from, f.to);
  const own = brands.find((b) => b.isOwn)!;

  const kpiKeys: MetricKey[] = ["visibility", "mentionRate", "citationRate", "sov", "sentiment"];
  const kpis = kpiKeys.map((k) => ({
    key: k,
    value: curM.get(OWN_KEY)?.[k] ?? null,
    delta: delta(curM.get(OWN_KEY)?.[k], prevM.get(OWN_KEY)?.[k]),
    spark: dates.map((d) => byDate.get(d)?.get(OWN_KEY)?.[k] ?? null).filter((v): v is number => v != null),
  }));

  const ranked = brands
    .map((b) => ({ brand: toBrandDTO(b), visibility: curM.get(b.key)?.visibility ?? null, delta: delta(curM.get(b.key)?.visibility, prevM.get(b.key)?.visibility) }))
    .filter((r) => r.brand.isOwn || r.brand.tracked)
    .sort((a, b) => (b.visibility ?? 0) - (a.visibility ?? 0));
  const topCompetitors = ranked.filter((r) => !r.brand.isOwn).slice(0, 3);

  const movers: DashboardData["movers"] = [];
  for (const [promptId, total] of cur.totals.prompt) {
    const prevTotal = prev.totals.prompt.get(promptId);
    const p = promptMap.get(promptId);
    if (!prevTotal || !p) continue;
    const c = toMetrics(cur.by.prompt.get(OWN_KEY)?.get(promptId), total, sumsOf([]));
    const pv = toMetrics(prev.by.prompt.get(OWN_KEY)?.get(promptId), prevTotal, sumsOf([]));
    const d = (c.visibility ?? 0) - (pv.visibility ?? 0);
    if (Math.abs(d) < 0.5) continue;
    movers.push({ promptId, text: p.text, country: p.country, visibility: c.visibility ?? 0, delta: d });
  }
  movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const engineIds = [...new Set([...(project.engines ?? []), ...cur.totals.engine.keys()])];
  const engines = engineIds.map((e) => {
    const answers = cur.totals.engine.get(e) ?? 0;
    const visible = cur.by.engine.get(OWN_KEY)?.get(e)?.visible ?? 0;
    return { engine: e, enabled: (project.engines ?? []).includes(e), answers, visibility: answers ? (visible / answers) * 100 : null };
  });

  return {
    ...base,
    hasData: true,
    kpis,
    trend: {
      dates,
      series: [own, ...topCompetitors.map((r) => brands.find((b) => b.key === r.brand.key)!)].map((b) => ({
        key: b.key,
        brand: toBrandDTO(b),
        values: dates.map((d) => byDate.get(d)?.get(b.key)?.visibility ?? null),
      })),
    },
    ranking: ranked.slice(0, 6),
    sources: srcRows.map((s) => ({ domain: s.domain, citations: s.n, delta: delta(s.n, s.prev_n), ownership: s.ownership })),
    movers: movers.slice(0, 6),
    engines,
    totals: { answers: cur.total },
  };
}

async function getCounts(project: ProjectRow) {
  const [[p], [c]] = await Promise.all([
    db
      .select({ n: count() })
      .from(prompts)
      .where(and(eq(prompts.projectId, project.id), eq(prompts.status, "active"))),
    db.select({ n: count() }).from(competitors).where(eq(competitors.projectId, project.id)),
  ]);
  return { prompts: p?.n ?? 0, competitors: c?.n ?? 0, engines: (project.engines ?? []).length };
}

/** Skipped checklist steps of a user for a project (stored in users.preferences). */
export function skippedSteps(preferences: unknown, projectId: string): Set<string> {
  const d = (preferences as { dashboard?: { skipped?: Record<string, unknown> } } | null)?.dashboard?.skipped?.[projectId];
  return new Set(Array.isArray(d) ? d.filter((x): x is string => typeof x === "string") : []);
}

/**
 * One merged setup checklist (AI visibility + open-seo workspace steps), computed from real state.
 * Steps the user can't complete show a hint instead of a CTA; each open step can be skipped.
 */
async function getChecklist(ctx: ProjectContext): Promise<ChecklistItem[]> {
  const project = ctx.project;
  const pid = project.id;
  const isAdmin = ctx.isInstanceAdmin;
  const can = (p: string) => isAdmin || ctx.permissions.has(p as never);
  const [counts, integ, members, invites, agentOnline, providersOk, projectCount, mcp, research] = await Promise.all([
    getCounts(project),
    db
      .select({ provider: integrations.provider })
      .from(integrations)
      .where(
        and(
          eq(integrations.projectId, pid),
          eq(integrations.status, "connected"),
          inArray(integrations.provider, ["google_search_console", "google_analytics", "bing_webmaster", "matomo", "piwik_pro"]),
        ),
      ),
    db.select({ n: count() }).from(workspaceMembers).where(eq(workspaceMembers.workspaceId, project.workspaceId)),
    db
      .select({ n: count() })
      .from(invitations)
      .where(and(eq(invitations.workspaceId, project.workspaceId), eq(invitations.status, "pending"), gt(invitations.expiresAt, new Date()))),
    hasOnlineAgent("any").catch(() => false),
    isAdmin ? providersConfigured() : Promise.resolve(false),
    db
      .select({ n: count() })
      .from(projects)
      .where(and(eq(projects.workspaceId, project.workspaceId), eq(projects.archived, false), sql`coalesce(${projects.settings}->>'demo', 'false') <> 'true'`)),
    db
      .select({ n: count() })
      .from(apiKeys)
      .where(and(eq(apiKeys.workspaceId, project.workspaceId), isNull(apiKeys.revokedAt), or(eq(apiKeys.kind, "oauth"), gt(apiKeys.requestCount, 0)))),
    db
      .select({ n: count() })
      .from(seoSearchHistory)
      .where(and(eq(seoSearchHistory.projectId, pid), eq(seoSearchHistory.feature, "domain"))),
  ]);
  const skipped = skippedSteps(ctx.user.preferences, pid);
  const base = `/p/${pid}`;
  const hasTeam = (members[0]?.n ?? 0) > 1 || (invites[0]?.n ?? 0) > 0;
  const item = (i: Omit<ChecklistItem, "skipped">): ChecklistItem => ({ ...i, skipped: !i.done && skipped.has(i.key) });

  const items: ChecklistItem[] = [
    item({
      key: "domain",
      title: "Add your website",
      description: project.domain ? `Tracking ${project.domain} in ${project.country}.` : "Set the website and country for this project.",
      done: !!project.domain,
      allowed: can("projects.manage"),
      href: `${base}/settings`,
      cta: "Project settings",
      startHere: true,
    }),
    item({
      key: "prompts",
      title: "Add prompts to track",
      description: counts.prompts ? `${counts.prompts} active prompts are tracked.` : "Choose the questions your customers ask AI engines.",
      done: counts.prompts > 0,
      allowed: can("prompts.manage"),
      href: `${base}/ai/tracker`,
      cta: "Add prompts",
    }),
    item({
      key: "competitors",
      title: "Add competitors",
      description: counts.competitors ? `${counts.competitors} competitors are compared with you.` : "Benchmark your AI visibility against the brands you compete with.",
      done: counts.competitors > 0,
      allowed: can("prompts.manage"),
      href: `${base}/ai/competitors`,
      cta: "Add competitors",
    }),
    item({
      key: "engines",
      title: "Enable AI engines",
      description: counts.engines ? `${counts.engines} engines enabled for this project.` : "Pick which AI engines answer your prompts.",
      done: counts.engines > 0,
      allowed: can("prompts.manage"),
      href: `${base}/ai/models`,
      cta: "Model settings",
    }),
  ];
  if (isAdmin)
    items.push(
      item({
        key: "providers",
        title: "Configure data & AI providers",
        description: providersOk ? "A data or AI provider is configured." : "Connect DataForSEO or an AI provider key so engines can answer prompts.",
        done: providersOk,
        allowed: true,
        href: "/admin/ai",
        cta: "Admin → AI providers",
        adminOnly: true,
      }),
    );
  items.push(
    item({
      key: "analytics",
      title: "Connect Search Console / GA4",
      description: integ.length
        ? `${integ.length} analytics integration${integ.length > 1 ? "s" : ""} connected.`
        : "Bring your real clicks, queries and AI-referred traffic into view.",
      done: integ.length > 0,
      allowed: can("settings.manage"),
      href: `${base}/integrations`,
      cta: "Integrations",
    }),
    item({
      key: "research",
      title: "Explore a competitor",
      description: (research[0]?.n ?? 0) > 0 ? "You've looked up a competitor domain." : "Find topics and links worth learning from.",
      done: (research[0]?.n ?? 0) > 0,
      allowed: true,
      href: `${base}/seo/domain`,
      cta: "Open domain lookup",
    }),
    item({
      key: "projects",
      title: "Working on multiple websites?",
      description: (projectCount[0]?.n ?? 0) > 1 ? `${projectCount[0]!.n} projects in this workspace.` : "Create another project, or let your AI agent set up a list of sites.",
      done: (projectCount[0]?.n ?? 0) > 1,
      allowed: can("projects.manage"),
      href: "/settings/projects",
      cta: "Create project",
    }),
    item({
      key: "mcp",
      title: "Connect your AI agent (MCP)",
      description: (mcp[0]?.n ?? 0) > 0 ? "An AI agent is connected via MCP / API." : "Use this workspace inside Claude, ChatGPT, Cursor or your favorite agent.",
      done: (mcp[0]?.n ?? 0) > 0,
      allowed: true,
      href: "/settings/api",
      cta: "API & MCP",
    }),
    item({
      key: "agent",
      title: "Install a local agent",
      description: agentOnline ? "A local agent is online and powers AI features." : "Run Claude Code or Codex locally to power AI analysis without API keys.",
      done: agentOnline,
      allowed: can("agents.manage"),
      href: "/agents",
      cta: "Local agents",
    }),
    item({
      key: "team",
      title: "Invite your team",
      description: hasTeam ? "Your team has access to this workspace." : "Share the work — or keep things solo for now.",
      done: hasTeam,
      allowed: can("members.manage"),
      href: "/settings/workspace",
      cta: "Invite team",
    }),
  );
  return items;
}

async function providersConfigured(): Promise<boolean> {
  try {
    if (await isDataForSeoConfigured()) return true;
    if ((await availableLlmProviders()).length > 0) return true;
    const ai = await getSetting("ai");
    return Boolean(ai.perplexityApiKey || ai.geminiApiKey || ai.xaiApiKey || ai.mistralApiKey || ai.deepseekApiKey);
  } catch {
    return false;
  }
}
