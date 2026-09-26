import "server-only";
import crypto from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  botVisits,
  integrations,
  logIngestStats,
  logUploads,
  scDaily,
  scPages,
  scQueries,
  scQueryIntents,
  trafficDaily,
  trafficRows,
} from "@/server/db/schema";
import { AI_BOTS } from "@/lib/engines";
import { PROVIDERS } from "@/lib/integrations-catalog";
import { sha256 } from "@/server/crypto";
import { classifyIntent, isAiPrompt } from "@/server/analytics/search-console/classify";
import type { Rng } from "../random";
import { chunks, dayOffset, type DemoModule, type DemoModuleCtx } from "./context";
import {
  AI_REFERRERS,
  CLASSIC_QUERIES,
  DEMO_BOTS,
  NOT_FOUND_PATHS,
  PROMPT_QUERIES,
  REDIRECT_PATHS,
  SC_COUNTRIES,
  SITE_PAGES,
  type SearchQuery,
} from "./analytics-site";

/**
 * Analytics demo data: Search Console (Google + Bing), GA4 AI-referred traffic, bot/crawler visits
 * and the integration rows that make those pages render as "connected (demo)". Insert-only — the
 * integrations carry no secrets and `config.demo = true`; sync jobs for demo projects are dropped
 * centrally (enqueueJob guard), and request-time Google calls fail fast without a stored grant.
 */

const DEMO_PROVIDERS = [PROVIDERS.gsc, PROVIDERS.ga4, PROVIDERS.bing, PROVIDERS.serverLogs];
const SC_LAG = 2; // Search Console data trails by ~2–3 days
const DAY_MS = 86_400_000;

type Counts = Record<string, number>;

function dayStart(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

/** Weekly seasonality (running searches peak at the weekend). */
function weekday(day: string): number {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6 ? 1.12 : dow === 5 ? 1.02 : 0.96;
}

/** Stochastic rounding keeps small expected values realistic (mostly 0, sometimes 1). */
function sround(rng: Rng, x: number): number {
  const f = Math.floor(x);
  return f + (rng.next() < x - f ? 1 : 0);
}

/** Google organic CTR by position (rough industry curve). */
function ctrAt(pos: number): number {
  if (pos <= 1.5) return 0.31;
  if (pos <= 2.5) return 0.17;
  if (pos <= 3.5) return 0.11;
  if (pos <= 5) return 0.07;
  if (pos <= 7) return 0.045;
  if (pos <= 10) return 0.027;
  if (pos <= 15) return 0.012;
  if (pos <= 20) return 0.006;
  return 0.002;
}

/* ───────────────────────────── Search Console ───────────────────────────── */

type ScRow = typeof scQueries.$inferInsert;
type ScPageRow = typeof scPages.$inferInsert;
type ScDailyRow = typeof scDaily.$inferInsert;

function buildSearchConsole(ctx: DemoModuleCtx) {
  const rng = ctx.rng("analytics.sc");
  const origin = `https://${ctx.domain}`;
  // Tracked AI prompts show up as long-tail search queries too (lower-cased, without "?").
  const trackedAsQueries: SearchQuery[] = ctx.prompts
    .filter((p) => isAiPrompt(p.text))
    .slice(0, 14)
    .map((p, i) => ({
      q: p.text.toLowerCase().replace(/[?!.]+$/g, "").trim(),
      imp: 3 + (i % 5) * 1.5,
      pos: 4 + (i % 7) * 1.6,
      pages: [SITE_PAGES[(i * 3) % SITE_PAGES.length]!.path],
    }));
  const queries = [...CLASSIC_QUERIES, ...PROMPT_QUERIES, ...trackedAsQueries].filter(
    (q, i, all) => all.findIndex((x) => x.q === q.q) === i,
  );
  const firstOffset = ctx.days - 1 + SC_LAG;
  const queryRows: ScRow[] = [];
  const pageRows: ScPageRow[] = [];
  const daily: ScDailyRow[] = [];

  for (let off = firstOffset; off >= SC_LAG; off--) {
    const day = dayOffset(ctx.now, off);
    const t = (firstOffset - off) / Math.max(1, ctx.days - 1);
    const growth = 0.82 + 0.5 * t;
    let dayClicks = 0;
    let dayImp = 0;
    let dayPosW = 0;
    for (const q of queries) {
      const prompt = isAiPrompt(q.q);
      // AI-style queries grow faster (people type prompts into search too).
      const g = prompt ? 0.7 + 1.1 * t : growth;
      const expected = q.imp * g * weekday(day) * rng.float(0.75, 1.25);
      const impressions = sround(rng, expected);
      if (impressions <= 0) continue;
      // Positions improve slowly over the window.
      const pos = Math.max(1, q.pos * (1.08 - 0.16 * t) + rng.gaussian(0, q.pos > 10 ? 1.4 : 0.35));
      // Split across 1–3 countries.
      const nCountries = impressions < 4 ? 1 : impressions < 30 ? rng.int(1, 2) : rng.int(2, 3);
      const countries = rng.weightedSample(SC_COUNTRIES, nCountries, (c) => c.w);
      const weights = countries.map((c, i) => (i === 0 ? c.w * 3 : c.w));
      const wSum = weights.reduce((a, b) => a + b, 0);
      let left = impressions;
      countries.forEach((c, i) => {
        const imp = i === countries.length - 1 ? left : Math.max(1, Math.round((impressions * weights[i]!) / wSum));
        if (imp <= 0 || left <= 0) return;
        left -= imp;
        const cpos = Math.max(1, pos + rng.gaussian(0, 0.6));
        const clicks = Math.min(imp, sround(rng, imp * ctrAt(cpos) * rng.float(0.7, 1.3)));
        queryRows.push({ projectId: ctx.projectId, source: "google", date: day, query: q.q, country: c.code, clicks, impressions: imp, position: Math.round(cpos * 10) / 10 });
        dayClicks += clicks;
        dayImp += imp;
        dayPosW += cpos * imp;
      });
      // Page × query row (one landing page per query and day).
      const page = q.pages.length > 1 && rng.bool(0.35) ? q.pages[1]! : q.pages[0]!;
      const pClicks = Math.min(impressions, sround(rng, impressions * ctrAt(pos)));
      pageRows.push({ projectId: ctx.projectId, source: "google", date: day, page: `${origin}${page}`, query: q.q, clicks: pClicks, impressions, position: Math.round(pos * 10) / 10 });
    }
    // Daily totals include anonymized queries (≈ 30–40 % of clicks, more impressions).
    const anonClicks = Math.round(dayClicks * rng.float(0.32, 0.42));
    const anonImp = Math.round(dayImp * rng.float(0.45, 0.6));
    daily.push({
      projectId: ctx.projectId,
      source: "google",
      date: day,
      clicks: dayClicks + anonClicks,
      impressions: dayImp + anonImp,
      position: dayImp ? Math.round(((dayPosW / dayImp) * 1.08) * 10) / 10 : null,
    });
  }

  /* Bing (Webmaster Tools): daily traffic, weekly query/page statistics without countries. */
  const brng = ctx.rng("analytics.bing");
  const bingDaily: ScDailyRow[] = daily.map((d) => ({
    projectId: ctx.projectId,
    source: "bing",
    date: d.date,
    clicks: Math.round((d.clicks ?? 0) * brng.float(0.07, 0.1)),
    impressions: Math.round((d.impressions ?? 0) * brng.float(0.09, 0.13)),
    position: d.position != null ? Math.round((d.position * brng.float(0.85, 1.05)) * 10) / 10 : null,
  }));
  const bingQueries: ScRow[] = [];
  const bingPages: ScPageRow[] = [];
  const weeks = Math.floor(ctx.days / 7);
  for (let w = weeks - 1; w >= 0; w--) {
    const day = dayOffset(ctx.now, SC_LAG + 1 + w * 7);
    const t = 1 - w / Math.max(1, weeks - 1);
    for (const q of brng.weightedSample(queries, Math.min(queries.length, 28), (x) => x.imp)) {
      const impressions = Math.max(1, Math.round(q.imp * 7 * 0.1 * (0.8 + 0.5 * t) * brng.float(0.6, 1.4)));
      const pos = Math.max(1, q.pos * brng.float(0.8, 1.1));
      bingQueries.push({ projectId: ctx.projectId, source: "bing", date: day, query: q.q, country: "", clicks: Math.min(impressions, sround(brng, impressions * ctrAt(pos))), impressions, position: Math.round(pos * 10) / 10 });
    }
    for (const p of brng.weightedSample(SITE_PAGES, 14, (x) => x.sc)) {
      const impressions = Math.max(1, Math.round(p.sc * 60 * (0.8 + 0.5 * t) * brng.float(0.6, 1.4)));
      const pos = brng.float(3, 18);
      bingPages.push({ projectId: ctx.projectId, source: "bing", date: day, page: `${origin}${p.path}`, query: "", clicks: sround(brng, impressions * ctrAt(pos)), impressions, position: Math.round(pos * 10) / 10 });
    }
  }

  // "Refined" intents for the conversational queries (as if the LLM refinement had run once).
  const intents = queries
    .filter((q) => isAiPrompt(q.q))
    .map((q) => ({ projectId: ctx.projectId, query: q.q, intent: classifyIntent(q.q), isPrompt: true, source: "llm" as const }));

  return { daily: [...daily, ...bingDaily], queryRows: [...queryRows, ...bingQueries], pageRows: [...pageRows, ...bingPages], intents, firstDay: daily[0]?.date ?? null, lastDay: daily.at(-1)?.date ?? null };
}

/* ───────────────────────────── GA4 AI traffic ───────────────────────────── */

type TrafficRow = typeof trafficRows.$inferInsert;
type TrafficDailyRow = typeof trafficDaily.$inferInsert;

const AI_COUNTRIES: { code: string; w: number }[] = [
  { code: "US", w: 60 },
  { code: "GB", w: 10 },
  { code: "CA", w: 8 },
  { code: "AU", w: 6 },
  { code: "DE", w: 5 },
  { code: "NL", w: 3 },
  { code: "IE", w: 2 },
  { code: "SE", w: 2 },
  { code: "FR", w: 2 },
  { code: "", w: 2 },
];

function buildTraffic(ctx: DemoModuleCtx) {
  const rng = ctx.rng("analytics.traffic");
  const rows: TrafficRow[] = [];
  const totals: TrafficDailyRow[] = [];
  const aov = 118;
  // GA4: last complete day is yesterday.
  for (let off = ctx.days; off >= 1; off--) {
    const day = dayOffset(ctx.now, off);
    const t = (ctx.days - off) / Math.max(1, ctx.days - 1);
    const allSessions = Math.round((3100 + 1100 * t) * weekday(day) * rng.float(0.9, 1.1));
    const aiShare = (1.7 + 2.6 * t) / 100;
    const aiSessions = Math.max(1, Math.round(allSessions * aiShare * rng.float(0.85, 1.15)));
    let aiConv = 0;
    let aiRev = 0;
    for (const ref of AI_REFERRERS) {
      const n = sround(rng, (aiSessions * ref.share) / 100);
      if (n <= 0) continue;
      const cells = Math.max(1, Math.min(14, Math.round(n / 4)));
      const pages = rng.weightedSample(SITE_PAGES, Math.min(cells, SITE_PAGES.length), (p) => p.ai);
      const weights = pages.map((p) => p.ai * rng.float(0.5, 1.5));
      const wSum = weights.reduce((a, b) => a + b, 0);
      let left = n;
      pages.forEach((p, i) => {
        if (left <= 0) return;
        const s = i === pages.length - 1 ? left : Math.min(left, Math.max(1, Math.round((n * weights[i]!) / wSum)));
        left -= s;
        const country = rng.weighted(AI_COUNTRIES, (c) => c.w).code;
        const conversions = sround(rng, s * p.conv * ref.conv);
        const revenue = conversions ? Math.round(conversions * aov * rng.float(0.7, 1.45) * 100) / 100 : 0;
        const engaged = Math.min(s, sround(rng, s * ref.engagement));
        aiConv += conversions;
        aiRev += revenue;
        rows.push({
          projectId: ctx.projectId,
          provider: "google_analytics",
          date: day,
          platform: ref.id,
          page: p.path,
          country,
          sessions: s,
          engagedSessions: engaged,
          convertedSessions: Math.min(s, conversions ? Math.max(1, conversions - (conversions > 2 ? 1 : 0)) : 0),
          conversions,
          revenue,
          engagementSeconds: Math.round(s * ref.avgTime * rng.float(0.7, 1.3)),
          users: Math.max(1, Math.round(s * rng.float(0.86, 0.97))),
        });
      });
    }
    const allConv = Math.round(allSessions * 0.018 * rng.float(0.85, 1.15)) + aiConv;
    totals.push({
      projectId: ctx.projectId,
      provider: "google_analytics",
      date: day,
      sessions: allSessions,
      conversions: allConv,
      revenue: Math.round((allConv - aiConv) * aov * rng.float(0.92, 1.08) * 100) / 100 + aiRev,
    });
  }
  return { rows, totals, firstDay: totals[0]?.date ?? null, lastDay: totals.at(-1)?.date ?? null };
}

/* ───────────────────────────── Bot traffic ───────────────────────────── */

type BotRow = typeof botVisits.$inferInsert;
type IngestRow = typeof logIngestStats.$inferInsert;

function buildBots(ctx: DemoModuleCtx, uploadId: string) {
  const rng = ctx.rng("analytics.bots");
  const companyOf = new Map<string, string>(AI_BOTS.map((b) => [b.token, b.company]));
  const rows: BotRow[] = [];
  const stats: IngestRow[] = [];
  const seen = new Set<string>();
  const nowMs = ctx.now.getTime();
  // The oldest part of the window arrived as a one-off log upload; later visits via the live API.
  const uploadCutoff = Math.floor(ctx.days * 0.8);
  let uploadVisits = 0;
  let uploadFirst: Date | null = null;
  let uploadLast: Date | null = null;

  for (let off = ctx.days - 1; off >= 0; off--) {
    const day = dayOffset(ctx.now, off);
    const t = (ctx.days - 1 - off) / Math.max(1, ctx.days - 1);
    const start = dayStart(day);
    const end = off === 0 ? nowMs - 5 * 60_000 : start + DAY_MS;
    const span = Math.max(60_000, end - start);
    const visits = Math.round((170 + 170 * t) * rng.float(0.85, 1.15) * (off === 0 ? span / DAY_MS : 1));
    const source = off >= uploadCutoff ? ("upload" as const) : ("api" as const);
    let saved = 0;
    for (let i = 0; i < visits; i++) {
      const bot = rng.weighted(DEMO_BOTS, (b) => b.w0 + (b.w1 - b.w0) * t);
      const r = rng.next();
      let path: string;
      let status = 200;
      if (bot.robots && r < 0.06) path = "/robots.txt";
      else if (bot.robots && r < 0.09) path = "/sitemap.xml";
      else if (bot.llms && r < 0.13) path = "/llms.txt";
      else if (r < 0.16) {
        path = rng.pick(REDIRECT_PATHS);
        status = 301;
      } else if (r < 0.2) {
        path = rng.pick(NOT_FOUND_PATHS);
        status = 404;
      } else {
        path = rng.weighted(SITE_PAGES, (p) => (bot.token.endsWith("-User") ? p.ai : p.bot)).path;
        if (rng.bool(0.003)) status = 500;
      }
      const ts = new Date(start + Math.floor(rng.next() * span));
      const spoofed = bot.verifiable && rng.bool(0.03);
      const ip = spoofed ? `185.${rng.int(100, 250)}.${rng.int(1, 254)}.${rng.int(1, 254)}` : `${rng.pick(bot.ips)}${rng.int(1, 254)}`;
      const key = crypto.createHash("sha1").update(`${bot.token}|${ts.toISOString()}|${ip}|${path}`).digest("hex");
      if (seen.has(key)) continue;
      seen.add(key);
      const bytes =
        status === 301 ? 0 : status === 404 ? rng.int(1200, 1800) : path === "/robots.txt" ? 412 : path === "/sitemap.xml" ? 14_380 : path === "/llms.txt" ? 3_960 : rng.int(28_000, 86_000);
      rows.push({
        projectId: ctx.projectId,
        bot: bot.token,
        company: companyOf.get(bot.token) ?? bot.company,
        ts,
        ip,
        host: ctx.domain,
        path,
        method: bot.token === "OAI-SearchBot" && rng.bool(0.15) ? "HEAD" : "GET",
        status,
        userAgent: bot.ua,
        bytes,
        verified: bot.verifiable ? !spoofed : null,
        source,
        uploadId: source === "upload" ? uploadId : null,
        dedupeKey: key,
      });
      saved++;
      if (source === "upload") {
        uploadVisits++;
        if (!uploadFirst || ts < uploadFirst) uploadFirst = ts;
        if (!uploadLast || ts > uploadLast) uploadLast = ts;
      }
    }
    if (source === "api") {
      // Log forwarder: all access-log lines are streamed, bots are filtered server-side.
      stats.push({
        projectId: ctx.projectId,
        source: "api",
        date: day,
        requests: off === 0 ? Math.max(1, Math.round(96 * (span / DAY_MS))) : 96,
        lines: Math.round(saved * rng.float(16, 22)),
        botVisits: saved,
        saved,
        lastReceivedAt: new Date(end - rng.int(30, 600) * 1000),
      });
    }
  }
  const uploadDay = dayOffset(ctx.now, uploadCutoff - 1);
  const upload = {
    id: uploadId,
    projectId: ctx.projectId,
    filename: `access.log-${dayOffset(ctx.now, ctx.days - 1)}_${dayOffset(ctx.now, uploadCutoff)}.gz`,
    sizeBytes: Math.round(uploadVisits * 19 * 310),
    receivedBytes: Math.round(uploadVisits * 19 * 310),
    format: "auto",
    detectedFormat: "nginx",
    status: "completed" as const,
    totalLines: uploadVisits * 19,
    parsedLines: uploadVisits * 19 - 42,
    invalidLines: 42,
    botVisits: uploadVisits,
    saved: uploadVisits,
    createdBy: ctx.userId,
    createdAt: new Date(dayStart(uploadDay) + 9.5 * 3600_000),
    updatedAt: new Date(dayStart(uploadDay) + 9.6 * 3600_000),
    finishedAt: new Date(dayStart(uploadDay) + 9.6 * 3600_000),
  };
  const uploadStat: IngestRow = {
    projectId: ctx.projectId,
    source: "upload",
    date: uploadDay,
    requests: 1,
    lines: upload.totalLines,
    botVisits: uploadVisits,
    saved: uploadVisits,
    lastReceivedAt: upload.finishedAt,
  };
  return { rows, stats: [...stats, uploadStat], upload, range: { first: uploadFirst, last: uploadLast } };
}

/* ───────────────────────────── Module ───────────────────────────── */

async function clear(ctx: DemoModuleCtx) {
  const pid = ctx.projectId;
  const { tx } = ctx;
  await tx.delete(scQueries).where(eq(scQueries.projectId, pid));
  await tx.delete(scPages).where(eq(scPages.projectId, pid));
  await tx.delete(scDaily).where(eq(scDaily.projectId, pid));
  await tx.delete(scQueryIntents).where(eq(scQueryIntents.projectId, pid));
  await tx.delete(trafficRows).where(eq(trafficRows.projectId, pid));
  await tx.delete(trafficDaily).where(eq(trafficDaily.projectId, pid));
  await tx.delete(botVisits).where(eq(botVisits.projectId, pid));
  await tx.delete(logIngestStats).where(eq(logIngestStats.projectId, pid));
  await tx.delete(logUploads).where(eq(logUploads.projectId, pid));
  await tx.delete(integrations).where(and(eq(integrations.projectId, pid), inArray(integrations.provider, DEMO_PROVIDERS)));
}

async function insert(ctx: DemoModuleCtx): Promise<Counts> {
  const { tx } = ctx;
  const sc = buildSearchConsole(ctx);
  const traffic = buildTraffic(ctx);
  const uploadId = `lup_demo${sha256(`${ctx.projectId}:upload`).slice(0, 12)}`;
  const bots = buildBots(ctx, uploadId);

  for (const part of chunks(sc.daily)) await tx.insert(scDaily).values(part);
  for (const part of chunks(sc.queryRows)) await tx.insert(scQueries).values(part);
  for (const part of chunks(sc.pageRows)) await tx.insert(scPages).values(part);
  for (const part of chunks(sc.intents)) await tx.insert(scQueryIntents).values(part).onConflictDoNothing();
  for (const part of chunks(traffic.rows)) await tx.insert(trafficRows).values(part);
  for (const part of chunks(traffic.totals)) await tx.insert(trafficDaily).values(part);
  await tx.insert(logUploads).values(bots.upload);
  for (const part of chunks(bots.rows)) await tx.insert(botVisits).values(part).onConflictDoNothing();
  for (const part of chunks(bots.stats)) await tx.insert(logIngestStats).values(part);

  /* Integrations: connected, demo-flagged, no secrets (they can never sync or call a provider). */
  const irng = ctx.rng("analytics.integrations");
  const syncedAt = new Date(ctx.now.getTime() - irng.int(2, 6) * 3600_000);
  const connectedAt = new Date(dayStart(dayOffset(ctx.now, ctx.days + 2)) + 10 * 3600_000).toISOString();
  const email = `analytics@${ctx.domain}`;
  const token = `fslg_${crypto.randomBytes(24).toString("base64url")}`; // discarded: nobody can push logs to the demo
  await tx.insert(integrations).values([
    {
      projectId: ctx.projectId,
      provider: PROVIDERS.gsc,
      status: "connected",
      config: { demo: true, siteUrl: `sc-domain:${ctx.domain}`, email, connectedAt, syncedThrough: sc.lastDay, backfilledFrom: sc.firstDay },
      connectedBy: ctx.userId,
      lastSyncAt: syncedAt,
    },
    {
      projectId: ctx.projectId,
      provider: PROVIDERS.ga4,
      status: "connected",
      config: {
        demo: true,
        propertyId: `properties/${irng.int(310_000_000, 499_999_999)}`,
        propertyName: `${ctx.brandName} – GA4`,
        timeZone: "America/New_York",
        currency: "USD",
        email,
        connectedAt,
        syncedThrough: traffic.lastDay,
      },
      connectedBy: ctx.userId,
      lastSyncAt: syncedAt,
    },
    {
      projectId: ctx.projectId,
      provider: PROVIDERS.bing,
      status: "connected",
      config: { demo: true, siteUrl: `https://${ctx.domain}/`, resolvedSiteUrl: `https://${ctx.domain}/`, syncedThrough: sc.lastDay },
      connectedBy: ctx.userId,
      lastSyncAt: syncedAt,
    },
    {
      projectId: ctx.projectId,
      provider: PROVIDERS.serverLogs,
      status: "connected",
      config: { demo: true, tokenCreatedAt: new Date(dayStart(dayOffset(ctx.now, Math.floor(ctx.days * 0.8))) + 11 * 3600_000).toISOString() },
      tokenHash: sha256(token),
      tokenPrefix: token.slice(0, 11),
      connectedBy: ctx.userId,
    },
  ]);

  return {
    scDaily: sc.daily.length,
    scQueries: sc.queryRows.length,
    scPages: sc.pageRows.length,
    scIntents: sc.intents.length,
    trafficRows: traffic.rows.length,
    trafficDaily: traffic.totals.length,
    botVisits: bots.rows.length,
    ingestStats: bots.stats.length,
    integrations: 4,
  };
}

const analyticsDemo = { name: "analytics", clear, insert } satisfies DemoModule;
export default analyticsDemo;
