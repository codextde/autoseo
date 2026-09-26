import "server-only";
import { and, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { aiAnswers, fcAssets, fcDocuments, fcStatements, jobs, optimizeRuns, prompts } from "@/server/db/schema";
import { availableLlmProviders } from "@/server/ai/llm";
import { FC_JOBS } from "@/server/optimize/fact-check/enqueue";
import type {
  AccuracyData,
  AssetDetail,
  AssetRow,
  FindingRow,
  FindingsData,
  FindingsFilters,
  OverviewData,
  VerdictCounts,
} from "./types";

export const FINDING_VERDICTS = ["off_label", "contradicted", "unsupported", "outdated", "needs_review"] as const;
const DEVIATIONS = ["off_label", "contradicted", "unsupported", "outdated"];

const PERIOD_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90, "365d": 365 };

function emptyCounts(): VerdictCounts {
  return { collected: 0, pending: 0, checked: 0, matched: 0, needs_review: 0, off_label: 0, contradicted: 0, unsupported: 0, outdated: 0 };
}

function addCount(c: VerdictCounts, verdict: string, n: number) {
  c.collected += n;
  if (verdict === "pending") c.pending += n;
  else {
    c.checked += n;
    if (verdict in c) (c as Record<string, number>)[verdict] += n;
  }
}

export async function getRunState(projectId: string) {
  const [active] = await db
    .select({ id: jobs.id, status: jobs.status, type: jobs.type })
    .from(jobs)
    .where(and(eq(jobs.projectId, projectId), inArray(jobs.type, [FC_JOBS.run, FC_JOBS.document]), inArray(jobs.status, ["queued", "running"])))
    .limit(1);
  const [last] = await db
    .select()
    .from(optimizeRuns)
    .where(and(eq(optimizeRuns.projectId, projectId), eq(optimizeRuns.kind, "fact_check")))
    .orderBy(desc(optimizeRuns.startedAt))
    .limit(1);
  return {
    active: active ? { id: active.id, status: active.status, type: active.type } : null,
    lastRun: last
      ? {
          status: last.status,
          startedAt: last.startedAt.toISOString(),
          finishedAt: last.finishedAt?.toISOString() ?? null,
          stats: last.stats,
          error: last.error,
        }
      : null,
  };
}

export async function getOverview(projectId: string): Promise<OverviewData> {
  const [assets, verdictRows, docRows, openRows, answerCount, run, providers] = await Promise.all([
    db.select().from(fcAssets).where(eq(fcAssets.projectId, projectId)).orderBy(fcAssets.name),
    db
      .select({ assetId: fcStatements.assetId, verdict: fcStatements.verdict, n: count() })
      .from(fcStatements)
      .where(eq(fcStatements.projectId, projectId))
      .groupBy(fcStatements.assetId, fcStatements.verdict),
    db
      .select({ assetId: fcDocuments.assetId, status: fcDocuments.status, n: count() })
      .from(fcDocuments)
      .where(eq(fcDocuments.projectId, projectId))
      .groupBy(fcDocuments.assetId, fcDocuments.status),
    db
      .select({ assetId: fcStatements.assetId, severity: fcStatements.severity, n: count() })
      .from(fcStatements)
      .where(and(eq(fcStatements.projectId, projectId), eq(fcStatements.status, "open"), inArray(fcStatements.verdict, [...FINDING_VERDICTS])))
      .groupBy(fcStatements.assetId, fcStatements.severity),
    db.select({ n: count() }).from(aiAnswers).where(and(eq(aiAnswers.projectId, projectId), eq(aiAnswers.status, "ok"))),
    getRunState(projectId),
    availableLlmProviders().catch(() => []),
  ]);

  const totals = emptyCounts();
  const perAsset = new Map<string, VerdictCounts>();
  for (const r of verdictRows) {
    addCount(totals, r.verdict, r.n);
    const c = perAsset.get(r.assetId) ?? emptyCounts();
    addCount(c, r.verdict, r.n);
    perAsset.set(r.assetId, c);
  }
  const docs = new Map<string, { total: number; ready: number; failed: number }>();
  for (const r of docRows) {
    const d = docs.get(r.assetId) ?? { total: 0, ready: 0, failed: 0 };
    d.total += r.n;
    if (r.status === "ready") d.ready += r.n;
    if (r.status === "failed") d.failed += r.n;
    docs.set(r.assetId, d);
  }
  const open = new Map<string, { total: number; critical: number }>();
  for (const r of openRows) {
    const o = open.get(r.assetId) ?? { total: 0, critical: 0 };
    o.total += r.n;
    if (r.severity === "critical") o.critical += r.n;
    open.set(r.assetId, o);
  }

  const rows: AssetRow[] = assets.map((a) => ({
    id: a.id,
    name: a.name,
    aliases: a.aliases,
    activeIngredient: a.activeIngredient,
    markets: a.markets,
    status: a.status,
    docs: docs.get(a.id)?.total ?? 0,
    docsReady: docs.get(a.id)?.ready ?? 0,
    docsFailed: docs.get(a.id)?.failed ?? 0,
    openFindings: open.get(a.id)?.total ?? 0,
    criticalFindings: open.get(a.id)?.critical ?? 0,
    counts: perAsset.get(a.id) ?? emptyCounts(),
    lastCheckedAt: a.lastCheckedAt?.toISOString() ?? null,
  }));

  const lastCheckedAt =
    run.lastRun?.finishedAt ??
    rows
      .map((r) => r.lastCheckedAt)
      .filter(Boolean)
      .sort()
      .pop() ??
    null;

  return {
    totals,
    assets: rows,
    lastCheckedAt,
    answersTracked: answerCount[0]?.n ?? 0,
    aiReady: providers.length > 0,
    run,
  };
}

/* ───────────────────────────── Findings ───────────────────────────── */

export function parseFindingsFilters(sp: Record<string, string | string[] | undefined>): FindingsFilters {
  const list = (k: string) => {
    const v = sp[k];
    const raw = Array.isArray(v) ? v.join(",") : (v ?? "");
    return raw.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 50);
  };
  const one = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const status = one("status");
  const period = one("period");
  const tab = one("tab");
  return {
    markets: list("market").map((m) => m.toUpperCase()),
    engines: list("model"),
    types: list("type").filter((t) => (FINDING_VERDICTS as readonly string[]).includes(t)),
    severities: list("severity").filter((s) => ["critical", "major", "minor"].includes(s)),
    assets: list("asset"),
    status: status === "resolved" || status === "ignored" || status === "all" ? status : "open",
    period: period && PERIOD_DAYS[period] ? period : "90d",
    tab: tab === "off_label" ? "off_label" : "all",
  };
}

type RawFinding = FindingRow & { firstSeenAtDate: Date; resolvedAtDate: Date | null };

async function loadFindings(projectId: string): Promise<RawFinding[]> {
  const rows = await db
    .select({
      s: fcStatements,
      assetName: fcAssets.name,
      promptText: prompts.text,
    })
    .from(fcStatements)
    .innerJoin(fcAssets, eq(fcAssets.id, fcStatements.assetId))
    .leftJoin(prompts, eq(prompts.id, fcStatements.promptId))
    .where(and(eq(fcStatements.projectId, projectId), inArray(fcStatements.verdict, [...FINDING_VERDICTS])))
    .orderBy(desc(fcStatements.lastSeenAt))
    .limit(5000);
  return rows.map(({ s, assetName, promptText }) => ({
    id: s.id,
    assetId: s.assetId,
    assetName,
    claim: s.claim,
    verdict: s.verdict as FindingRow["verdict"],
    severity: s.severity,
    engine: s.engine,
    market: s.market,
    labelSection: s.labelSection,
    labelQuote: s.labelQuote,
    answerQuote: s.answerQuote,
    explanation: s.explanation,
    judgedBy: s.judgedBy,
    matchScore: s.matchScore,
    status: s.status,
    seenCount: s.seenCount,
    promptId: s.promptId,
    promptText: promptText ?? null,
    answerId: s.answerId,
    firstSeenAt: s.firstSeenAt.toISOString(),
    lastSeenAt: s.lastSeenAt.toISOString(),
    resolvedAt: s.resolvedAt?.toISOString() ?? null,
    firstSeenAtDate: s.firstSeenAt,
    resolvedAtDate: s.resolvedAt,
  }));
}

function stripDates(f: RawFinding): FindingRow {
  const row: Partial<RawFinding> = { ...f };
  delete row.firstSeenAtDate;
  delete row.resolvedAtDate;
  return row as FindingRow;
}

function matchesBase(f: RawFinding, filters: FindingsFilters, from: Date | null) {
  if (filters.markets.length && !filters.markets.includes(f.market)) return false;
  if (filters.engines.length && !filters.engines.includes(f.engine)) return false;
  if (filters.assets.length && !filters.assets.includes(f.assetId)) return false;
  if (filters.severities.length && !(f.severity && filters.severities.includes(f.severity))) return false;
  const types = filters.tab === "off_label" ? ["off_label"] : filters.types;
  if (types.length && !types.includes(f.verdict)) return false;
  if (from && new Date(f.lastSeenAt) < from) return false;
  return true;
}

function matchesStatus(f: RawFinding, status: FindingsFilters["status"]) {
  return status === "all" || f.status === status;
}

export async function getFindings(projectId: string, filters: FindingsFilters): Promise<FindingsData> {
  const all = await loadFindings(projectId);
  const days = PERIOD_DAYS[filters.period] ?? 90;
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (days - 1) * 86400000);

  const base = all.filter((f) => matchesBase(f, filters, from));
  const rows = base.filter((f) => matchesStatus(f, filters.status));
  const openBase = base.filter((f) => f.status === "open");
  const kpis = {
    open: openBase.length,
    critical: openBase.filter((f) => f.severity === "critical").length,
    major: openBase.filter((f) => f.severity === "major").length,
    minor: openBase.filter((f) => f.severity === "minor").length,
    needsReview: openBase.filter((f) => f.verdict === "needs_review").length,
  };

  // Backlog curve: open findings per day (seen before end of day, not yet resolved/ignored at that time).
  const backlogSource = all.filter((f) => matchesBase(f, filters, null));
  const backlog: FindingsData["backlog"] = [];
  for (let d = 0; d < days; d++) {
    const dayStart = new Date(from.getTime() + d * 86400000);
    const dayEnd = new Date(dayStart.getTime() + 86400000);
    let open = 0;
    let critical = 0;
    for (const f of backlogSource) {
      if (f.firstSeenAtDate >= dayEnd) continue;
      if (f.resolvedAtDate && f.resolvedAtDate <= dayEnd) continue;
      if (f.status !== "open" && !f.resolvedAtDate) continue;
      open++;
      if (f.severity === "critical") critical++;
    }
    backlog.push({ date: dayStart.toISOString().slice(0, 10), open, critical });
  }

  const offLabelCount = all.filter((f) => f.verdict === "off_label" && matchesStatus(f, filters.status)).length;
  const assets = await db
    .select({ id: fcAssets.id, name: fcAssets.name })
    .from(fcAssets)
    .where(eq(fcAssets.projectId, projectId))
    .orderBy(fcAssets.name);
  return {
    rows: rows.map(stripDates),
    kpis,
    backlog,
    offLabelCount,
    options: {
      markets: [...new Set(all.map((f) => f.market))].sort(),
      engines: [...new Set(all.map((f) => f.engine))].sort(),
      assets,
    },
    total: all.length,
  };
}

/* ───────────────────────────── Accuracy ───────────────────────────── */

export async function getAccuracy(projectId: string, period: string): Promise<AccuracyData> {
  const days = PERIOD_DAYS[period] ?? 90;
  const from = new Date(Date.now() - days * 86400000);
  const [rows, assets, openRows] = await Promise.all([
    db
      .select({
        engine: fcStatements.engine,
        market: fcStatements.market,
        assetId: fcStatements.assetId,
        week: sql<string>`to_char(date_trunc('week', ${fcStatements.lastSeenAt}), 'YYYY-MM-DD')`,
        verdict: fcStatements.verdict,
        n: count(),
      })
      .from(fcStatements)
      .where(and(eq(fcStatements.projectId, projectId), sql`${fcStatements.verdict} <> 'pending'`, gte(fcStatements.lastSeenAt, from)))
      .groupBy(fcStatements.engine, fcStatements.market, fcStatements.assetId, sql`4`, fcStatements.verdict),
    db.select({ id: fcAssets.id, name: fcAssets.name }).from(fcAssets).where(eq(fcAssets.projectId, projectId)),
    db
      .select({ assetId: fcStatements.assetId, n: count() })
      .from(fcStatements)
      .where(and(eq(fcStatements.projectId, projectId), eq(fcStatements.status, "open"), inArray(fcStatements.verdict, [...FINDING_VERDICTS])))
      .groupBy(fcStatements.assetId),
  ]);

  const group = (key: (r: (typeof rows)[number]) => string) => {
    const m = new Map<string, VerdictCounts>();
    for (const r of rows) {
      const k = key(r);
      const c = m.get(k) ?? emptyCounts();
      addCount(c, r.verdict, r.n);
      m.set(k, c);
    }
    return m;
  };
  const rate = (c: VerdictCounts) => (c.checked ? (c.matched / c.checked) * 100 : null);
  const total = emptyCounts();
  for (const r of rows) addCount(total, r.verdict, r.n);

  const weeks = [...group((r) => r.week).entries()].sort(([a], [b]) => a.localeCompare(b));
  const byEngine = [...group((r) => r.engine).entries()].sort((a, b) => b[1].checked - a[1].checked);
  const byMarket = [...group((r) => r.market).entries()].sort((a, b) => b[1].checked - a[1].checked);
  const byAsset = group((r) => r.assetId);
  const openMap = new Map(openRows.map((r) => [r.assetId, r.n]));

  return {
    period,
    total,
    matchRate: rate(total),
    trend: weeks.map(([week, c]) => ({
      date: week,
      matchRate: rate(c) ?? 0,
      deviationRate: c.checked ? ((c.off_label + c.contradicted + c.unsupported + c.outdated) / c.checked) * 100 : 0,
      checked: c.checked,
    })),
    byEngine: byEngine.map(([engine, c]) => ({ key: engine, counts: c, matchRate: rate(c) })),
    byMarket: byMarket.map(([market, c]) => ({ key: market, counts: c, matchRate: rate(c) })),
    byAsset: assets
      .map((a) => {
        const c = byAsset.get(a.id) ?? emptyCounts();
        return { id: a.id, name: a.name, counts: c, matchRate: rate(c), openFindings: openMap.get(a.id) ?? 0 };
      })
      .sort((a, b) => b.counts.checked - a.counts.checked),
  };
}

/* ───────────────────────────── Asset detail ───────────────────────────── */

export async function getAssetDetail(projectId: string, assetId: string): Promise<AssetDetail | null> {
  const [asset] = await db
    .select()
    .from(fcAssets)
    .where(and(eq(fcAssets.projectId, projectId), eq(fcAssets.id, assetId)))
    .limit(1);
  if (!asset) return null;
  const [docs, statements, verdictRows] = await Promise.all([
    db
      .select({
        id: fcDocuments.id,
        title: fcDocuments.title,
        kind: fcDocuments.kind,
        sourceUrl: fcDocuments.sourceUrl,
        fileName: fcDocuments.fileName,
        market: fcDocuments.market,
        version: fcDocuments.version,
        effectiveDate: fcDocuments.effectiveDate,
        superseded: fcDocuments.superseded,
        charCount: fcDocuments.charCount,
        sections: sql<Array<{ id: string; heading: string }>>`coalesce((SELECT jsonb_agg(jsonb_build_object('id', e->>'id', 'heading', e->>'heading')) FROM jsonb_array_elements(${fcDocuments.sections}) e), '[]'::jsonb)`,
        status: fcDocuments.status,
        error: fcDocuments.error,
        createdAt: fcDocuments.createdAt,
      })
      .from(fcDocuments)
      .where(and(eq(fcDocuments.projectId, projectId), eq(fcDocuments.assetId, assetId)))
      .orderBy(desc(fcDocuments.createdAt)),
    db
      .select()
      .from(fcStatements)
      .where(and(eq(fcStatements.projectId, projectId), eq(fcStatements.assetId, assetId)))
      .orderBy(desc(fcStatements.lastSeenAt))
      .limit(100),
    db
      .select({ verdict: fcStatements.verdict, n: count() })
      .from(fcStatements)
      .where(and(eq(fcStatements.projectId, projectId), eq(fcStatements.assetId, assetId)))
      .groupBy(fcStatements.verdict),
  ]);
  const counts = emptyCounts();
  for (const r of verdictRows) addCount(counts, r.verdict, r.n);
  return {
    asset: {
      id: asset.id,
      name: asset.name,
      aliases: asset.aliases,
      activeIngredient: asset.activeIngredient,
      description: asset.description,
      markets: asset.markets,
      status: asset.status,
      sourceUrl: asset.sourceUrl,
      lastCheckedAt: asset.lastCheckedAt?.toISOString() ?? null,
      createdAt: asset.createdAt.toISOString(),
    },
    documents: docs.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() })),
    statements: statements.map((s) => ({
      id: s.id,
      claim: s.claim,
      verdict: s.verdict,
      severity: s.severity,
      engine: s.engine,
      market: s.market,
      labelSection: s.labelSection,
      labelQuote: s.labelQuote,
      answerQuote: s.answerQuote,
      explanation: s.explanation,
      status: s.status,
      seenCount: s.seenCount,
      lastSeenAt: s.lastSeenAt.toISOString(),
      judgedBy: s.judgedBy,
    })),
    counts,
    deviations: DEVIATIONS.reduce((a, k) => a + ((counts as Record<string, number>)[k] ?? 0), 0),
  };
}

/** Rows for the CSV export (same filters as the findings page). */
export async function exportFindings(projectId: string, filters: FindingsFilters) {
  const data = await getFindings(projectId, filters);
  return data.rows;
}
