import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  aiAdAppearances,
  aiAds,
  aiAnswers,
  aiCitations,
  aiFanouts,
  aiMentions,
  aiProductAppearances,
  aiProducts,
  aiRecommendations,
  aiRuns,
  aiSources,
  aiStatements,
  competitors,
  projects,
  promptResearchItems,
  promptResearchLists,
  prompts,
  promptTagLinks,
  promptTags,
  users,
} from "@/server/db/schema";
import { newId } from "@/server/db/schema/_helpers";
import { createProject } from "@/server/projects";
import { Rng, clamp, lerp } from "./random";
import { makeRng, type DemoModuleCtx, type DemoTx } from "./modules/context";
import { DEMO_MODULES, DEMO_POST_STEPS } from "./modules";
import {
  ADS,
  ATTRIBUTES,
  ATTRIBUTE_THEME,
  BRANDS,
  DEMO_ENGINES,
  ENGINE_CITATIONS,
  ENGINE_COST,
  ENGINE_MODELS,
  ENGINE_SOURCE_PREFS,
  FANOUT_TEMPLATES,
  GENERIC_CLOSINGS,
  H2H_CLAIMS,
  LIST_INTROS,
  PRODUCTS,
  PROMPTS,
  QUOTES,
  REASONS,
  RESEARCH_IDEAS,
  SITUATION_PHRASE,
  SOURCES,
  STORES,
  TAGS,
  type BrandDef,
  type DemoEngine,
  type Polarity,
  type ProductDef,
  type PromptDef,
  type Situation,
  type SourceDef,
} from "./catalog";

const DAY = 86_400_000;
export const DEMO_DEFAULT_SEED = "autoseo-demo-v1";

type AnswerRow = typeof aiAnswers.$inferInsert;
type MentionRow = typeof aiMentions.$inferInsert;
type CitationRow = typeof aiCitations.$inferInsert;
type FanoutRow = typeof aiFanouts.$inferInsert;
type StatementRow = typeof aiStatements.$inferInsert;
type RecommendationRow = typeof aiRecommendations.$inferInsert;
type ProductAppearanceRow = typeof aiProductAppearances.$inferInsert;
type AdAppearanceRow = typeof aiAdAppearances.$inferInsert;

export type DemoProjectResult = { projectId: string; stats: Record<string, number> };

/**
 * Creates a clearly labelled demo project ("Demo · Stridewell") with ~90 days of realistic,
 * deterministic (seeded) AI visibility data across 5 engines so every AI page can be explored.
 * All brands are fictional. Tracking is paused and `settings.demo = true` so jobs skip it.
 */
export async function createDemoProject(
  workspaceId: string,
  userId: string | null,
  opts: { seed?: string; days?: number } = {},
): Promise<DemoProjectResult> {
  const t0 = Date.now();
  const seed = opts.seed?.trim() || DEMO_DEFAULT_SEED;
  const days = Math.round(clamp(opts.days ?? 90, 7, 365));

  let createdBy: { id: string; email: string } | null = null;
  if (userId) {
    const [u] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    if (u) createdBy = u;
  }

  const own = BRANDS.find((b) => b.kind === "own")!;
  const project = await createProject({
    workspaceId,
    name: `Demo · ${own.name}`,
    domain: own.domain!,
    country: "US",
    language: "en",
    description:
      "Demo project with generated sample data (fictional sportswear brand and competitors). Tracking is paused — explore every AI visibility view without using any provider credits.",
    brand: {
      aliases: own.aliases,
      domains: [own.domain!],
      description: "Stridewell is a fictional running-shoe and apparel brand used for AutoSEO's demo data.",
      industry: "Sportswear",
    },
    engines: [...DEMO_ENGINES],
    trackingFrequency: "paused",
    bootstrap: false,
    createdBy,
  });

  try {
    await db
      .update(projects)
      .set({ settings: { demo: true, demoSeed: seed, demoDays: days, demoGeneratedAt: new Date().toISOString() } })
      .where(eq(projects.id, project.id));

    return { projectId: project.id, stats: await writeDemoData(project.id, createdBy?.id ?? null, seed, days, t0) };
  } catch (err) {
    await db
      .delete(projects)
      .where(eq(projects.id, project.id))
      .catch((e: unknown) => console.error("[demo] cleanup failed", e));
    throw err;
  }
}

/* ────────────────────────────────── Builder ────────────────────────────────── */

type Item = { brand: BrandDef; label: string; product: ProductDef | null; quotes: string[] };

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function joinBold(names: string[]): string {
  const b = names.map((n) => `**${n}**`);
  if (b.length <= 1) return b.join("");
  return `${b.slice(0, -1).join(", ")} and ${b[b.length - 1]}`;
}

function round99(x: number): number {
  return Math.max(1, Math.round(x)) - 0.01;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildDemoData(projectId: string, userId: string | null, seed: string, days: number, now: Date) {
  const rng = new Rng(`${seed}:content`);
  const noiseRng = new Rng(`${seed}:noise`);
  const nowMs = now.getTime();
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const startMs = todayMs - (days - 1) * DAY;
  const dates = Array.from({ length: days }, (_, i) => isoDate(startMs + i * DAY));

  const brandByKey = new Map(BRANDS.map((b) => [b.key, b]));
  const own = brandByKey.get("own")!;

  /* ── Competitors ── */
  const competitorId = new Map<string, string>();
  const competitorRows: (typeof competitors.$inferInsert)[] = BRANDS.filter((b) => b.kind === "competitor").map((b) => {
    const id = newId("cmp");
    competitorId.set(b.key, id);
    return {
      id,
      projectId,
      name: b.name,
      domain: b.domain,
      aliases: b.aliases,
      color: b.color,
      tracked: b.tracked ?? true,
      source: b.source ?? "manual",
      createdAt: new Date(startMs - DAY),
    };
  });
  const cmpId = (b: BrandDef): string | null => (b.kind === "competitor" ? competitorId.get(b.key)! : null);

  /* ── Tags & prompts ── */
  const tagId = new Map<string, string>();
  const tagRows: (typeof promptTags.$inferInsert)[] = TAGS.map((t) => {
    const id = newId("tag");
    tagId.set(t.name, id);
    return { id, projectId, name: t.name, color: t.color, createdAt: new Date(startMs - DAY) };
  });

  const promptIds: string[] = [];
  const promptStart: number[] = [];
  const promptRows: (typeof prompts.$inferInsert)[] = [];
  const tagLinkRows: (typeof promptTagLinks.$inferInsert)[] = [];
  PROMPTS.forEach((p, i) => {
    const id = newId("prm");
    promptIds.push(id);
    const startIdx = p.startDaysAgo ? Math.max(0, days - p.startDaysAgo) : 0;
    promptStart.push(startIdx);
    const createdAt = new Date(startMs + startIdx * DAY - (startIdx === 0 ? DAY : 0) + 2 * 3600_000 + i * 60_000);
    promptRows.push({
      id,
      projectId,
      text: p.text,
      country: "US",
      language: "en",
      status: "active",
      topic: p.tags[0],
      funnelStage: p.funnel,
      intent: p.intent,
      persona: p.persona,
      branded: p.kind === "branded" || p.text.includes(own.name),
      volume: p.volume,
      source: "generated",
      engines: null,
      createdBy: userId,
      lastRunAt: null,
      createdAt,
      updatedAt: createdAt,
    });
    for (const t of p.tags) tagLinkRows.push({ promptId: id, tagId: tagId.get(t)! });
  });

  /* ── Noise & per-prompt drift ── */
  const brandNoise = new Map<string, number[]>();
  for (const b of BRANDS) {
    const phase = noiseRng.float(0, Math.PI * 2);
    brandNoise.set(
      b.key,
      dates.map((_, d) => 1 + 0.07 * Math.sin((2 * Math.PI * d) / 7 + phase) + noiseRng.gaussian(0, 0.05)),
    );
  }
  // Per prompt × brand trend (creates "biggest movers")
  const drift = new Map<string, number>();
  PROMPTS.forEach((_, pi) => {
    for (const b of BRANDS) drift.set(`${pi}:${b.key}`, noiseRng.gaussian(0, b.kind === "own" ? 0.45 : 0.25));
  });

  /* ── Lookup state for sources / products / ads ── */
  type Seen = { id: string; first: number; last: number };
  const sourceSeen = new Map<number, Seen>();
  const productSeen = new Map<number, Seen>();
  const adSeen = new Map<number, Seen>();
  const touch = (map: Map<number, Seen>, idx: number, prefix: string, at: number): string => {
    let s = map.get(idx);
    if (!s) {
      s = { id: newId(prefix), first: at, last: at };
      map.set(idx, s);
    } else {
      s.first = Math.min(s.first, at);
      s.last = Math.max(s.last, at);
    }
    return s.id;
  };

  const productsByBrand = new Map<string, number[]>();
  PRODUCTS.forEach((p, i) => {
    const arr = productsByBrand.get(p.brand) ?? [];
    arr.push(i);
    productsByBrand.set(p.brand, arr);
  });
  const indexedSources = SOURCES.map((s, i) => ({ s, i }));
  const thirdPartySources = indexedSources.filter((x) => !x.s.brand);
  const sourcesByBrand = new Map<string, { s: SourceDef; i: number }[]>();
  for (const x of indexedSources) if (x.s.brand) sourcesByBrand.set(x.s.brand, [...(sourcesByBrand.get(x.s.brand) ?? []), x]);
  const brandSources = (key: string) => sourcesByBrand.get(key) ?? [];

  const brandRegex = new Map(BRANDS.map((b) => [b.key, new RegExp(`(?<![A-Za-z0-9])${escapeRe(b.name)}(?![A-Za-z0-9])`, "g")]));

  /* ── Output arrays ── */
  const runs: (typeof aiRuns.$inferInsert)[] = [];
  const answers: AnswerRow[] = [];
  const mentions: MentionRow[] = [];
  const citations: CitationRow[] = [];
  const fanouts: FanoutRow[] = [];
  const statements: StatementRow[] = [];
  const recommendations: RecommendationRow[] = [];
  const productAppearances: ProductAppearanceRow[] = [];
  const adAppearances: AdAppearanceRow[] = [];

  const strength = (b: BrandDef, t: number) => lerp(b.strength[0], b.strength[1], t);
  const priceCap = (p: PromptDef) => {
    const m = /under \$(\d+)/.exec(p.text);
    return m ? Number(m[1]) : null;
  };
  const eligibleProducts = (brandKey: string, p: PromptDef): ProductDef[] => {
    const cap = priceCap(p);
    return (productsByBrand.get(brandKey) ?? [])
      .map((i) => PRODUCTS[i]!)
      .filter((x) => x.category === p.category && (cap == null || x.price <= cap));
  };
  const topicMult = (b: BrandDef, p: PromptDef) => {
    let m = b.topic[p.tags[0]!] ?? 1;
    for (const tag of p.tags.slice(1)) m *= Math.sqrt(b.topic[tag] ?? 1);
    return m;
  };
  const kindMult: Record<PromptDef["kind"], number> = {
    best: 1,
    deal: 1,
    brandlist: 1.05,
    info: 0.7,
    comparison: 0.15,
    branded: 0.8,
  };
  const ownCiteEngine: Record<DemoEngine, number> = { perplexity: 1.3, chatgpt: 1.1, gemini: 1, claude: 0.7, ai_overview: 0.8 };

  let lastRunAt = startMs;

  for (let di = 0; di < days; di++) {
    const date = dates[di]!;
    const t = days > 1 ? di / (days - 1) : 1;
    const dayMs = startMs + di * DAY;
    const runId = newId("run");
    const runStart = Math.min(dayMs + 4 * 3600_000 + rng.int(0, 20) * 60_000, nowMs - 45 * 60_000);
    let dayAnswers = 0;
    let dayCost = 0;
    let answerClock = runStart;

    PROMPTS.forEach((p, pi) => {
      if (di < promptStart[pi]!) return;
      const promptId = promptIds[pi]!;
      for (const engine of DEMO_ENGINES) {
        answerClock += rng.int(2, 9) * 1000;
        const at = answerClock;
        const answerId = newId("ans");

        /* 1 ─ brand selection */
        const probs = new Map<string, number>();
        const selected = new Set<string>();
        const forced: string[] = [];
        if (p.kind === "comparison" && p.compare) forced.push(...p.compare);
        if (p.kind === "branded" && rng.bool(0.97)) forced.push("own");
        for (const k of forced) selected.add(k);
        for (const b of BRANDS) {
          if (selected.has(b.key)) continue;
          let prob =
            lerp(b.vis[0], b.vis[1], t) *
            (b.engine[engine] ?? 1) *
            topicMult(b, p) *
            kindMult[p.kind] *
            brandNoise.get(b.key)![di]! *
            (1 + drift.get(`${pi}:${b.key}`)! * (t - 0.5));
          if (p.kind === "comparison" && b.kind === "untracked") prob *= 0.3;
          if (p.category && p.products && !eligibleProducts(b.key, p).length) prob *= 0.3;
          prob = clamp(prob, 0, 0.96);
          probs.set(b.key, prob);
          if (rng.bool(prob)) selected.add(b.key);
        }
        const listKind = p.kind === "best" || p.kind === "deal" || p.kind === "brandlist";
        if (listKind) {
          while (selected.size < 3) {
            const pool = BRANDS.filter((b) => !selected.has(b.key));
            const add = rng.weighted(pool, (b) => (probs.get(b.key) ?? 0.05) + 0.01);
            selected.add(add.key);
          }
        }

        /* 2 ─ ordering */
        const scores = new Map<string, number>();
        for (const k of selected) {
          const b = brandByKey.get(k)!;
          scores.set(k, strength(b, t) + rng.gaussian(0, 0.35) + (topicMult(b, p) > 1.5 ? 0.3 : 0));
        }
        let order = [...selected].sort((a, b) => scores.get(b)! - scores.get(a)!);
        if (p.kind === "comparison" && p.compare) {
          order = [...p.compare, ...order.filter((k) => !p.compare!.includes(k))];
        } else if (p.kind === "branded" && selected.has("own")) {
          const rest = order.filter((k) => k !== "own");
          order = rng.bool(0.8) ? ["own", ...rest] : [...rest.slice(0, 1), "own", ...rest.slice(1)];
        }
        if (listKind && order.length > 7) order = order.slice(0, 7);
        if (p.kind === "info" && order.length > 4) order = order.slice(0, 4);
        if (p.kind === "comparison" && order.length > 3) order = order.slice(0, 3);
        if (p.kind === "branded" && order.length > 4) order = order.slice(0, 4);
        const ordered = order.map((k) => brandByKey.get(k)!);

        /* 3 ─ statements */
        const quotesByBrand = new Map<string, string[]>();
        const sentimentAdj = new Map<string, number>();
        for (const b of ordered) {
          const chance = p.kind === "branded" && b.kind === "own" ? 0.92 : 0.5;
          if (!rng.bool(chance)) continue;
          const n = p.kind === "branded" && b.kind === "own" ? rng.int(1, 3) : rng.bool(0.7) ? 1 : 2;
          const usedAttrs = new Set<string>();
          for (let s = 0; s < n; s++) {
            const mix = b.kind === "own" ? [b.mix[0] + 0.02 * t, b.mix[1] - 0.01 * t, b.mix[2] - 0.01 * t] : b.mix;
            const r = rng.next() * (mix[0]! + mix[1]! + mix[2]!);
            const polarity: Polarity = r < mix[0]! ? "praise" : r < mix[0]! + mix[1]! ? "neutral" : "criticism";
            const attr = rng.weighted(
              ATTRIBUTES.filter((a) => !usedAttrs.has(a)),
              (a) => attributeWeight(a, polarity, b, p),
            );
            usedAttrs.add(attr);
            const quote = rng.pick(QUOTES[attr]![polarity]).replaceAll("{brand}", b.name);
            const severity =
              polarity === "praise" ? rng.float(55, 95) : polarity === "criticism" ? rng.float(40, 90) : rng.float(40, 60);
            statements.push({
              id: newId("stm"),
              answerId,
              projectId,
              promptId,
              engine,
              answerDate: date,
              competitorId: cmpId(b),
              isOwn: b.kind === "own",
              brandName: b.name,
              polarity,
              theme: ATTRIBUTE_THEME[attr] ?? null,
              attribute: attr,
              quote,
              severity: Math.round(severity * 10) / 10,
            });
            quotesByBrand.set(b.key, [...(quotesByBrand.get(b.key) ?? []), quote]);
            sentimentAdj.set(b.key, (sentimentAdj.get(b.key) ?? 0) + (polarity === "praise" ? 4 : polarity === "criticism" ? -9 : 0));
          }
        }

        /* 4 ─ recommendations */
        const recommended = new Set<string>();
        const bestFor: { label: Situation; winner: BrandDef }[] = [];
        if (listKind && p.situations?.length && ordered.length > 0 && rng.bool(0.6)) {
          const labels = rng.weightedSample(p.situations, rng.bool(0.6) ? 1 : 2, () => 1);
          for (const label of labels) {
            let best: BrandDef = ordered[0]!;
            let bestScore = -Infinity;
            for (const b of ordered) {
              const sc = strength(b, t) + (b.situations[label] ?? 0) + rng.gaussian(0, 0.4);
              if (sc > bestScore) {
                bestScore = sc;
                best = b;
              }
            }
            bestFor.push({ label, winner: best });
            recommended.add(best.key);
            recommendations.push({
              id: newId("rec"),
              answerId,
              projectId,
              promptId,
              engine,
              answerDate: date,
              kind: "best_for",
              label,
              competitorId: cmpId(best),
              isOwn: best.kind === "own",
              brandName: best.name,
            });
          }
        }
        const claims: { a: BrandDef; b: BrandDef; label: string; winner: "brand" | "opponent" | "tie" }[] = [];
        const addClaim = (a: BrandDef, b: BrandDef) => {
          const usedAttrs = new Set(claims.map((c) => c.label));
          const tmpl = rng.weighted(
            H2H_CLAIMS,
            (c) =>
              (a.praise.includes(c.attribute) || a.criticism.includes(c.attribute) || b.praise.includes(c.attribute) || b.criticism.includes(c.attribute) ? 2 : 1) *
              (p.tags.includes("Deals") && c.attribute === "Value for money" ? 3 : 1) *
              (p.tags.includes("Trail") && c.attribute === "Grip & traction" ? 3 : 1),
          );
          const duel = (x: BrandDef) =>
            strength(x, t) + (x.praise.includes(tmpl.attribute) ? 0.35 : 0) - (x.criticism.includes(tmpl.attribute) ? 0.35 : 0) + rng.gaussian(0, 0.45);
          const sa = duel(a);
          const sb = duel(b);
          const winner = Math.abs(sa - sb) < 0.08 ? "tie" : sa > sb ? "brand" : "opponent";
          const label =
            winner === "tie"
              ? `${a.name} and ${b.name} are evenly matched on ${tmpl.attribute.toLowerCase()}`
              : tmpl.win.replace("{W}", winner === "brand" ? a.name : b.name).replace("{L}", winner === "brand" ? b.name : a.name);
          if (usedAttrs.has(label)) return;
          claims.push({ a, b, label, winner });
          recommendations.push({
            id: newId("rec"),
            answerId,
            projectId,
            promptId,
            engine,
            answerDate: date,
            kind: "head_to_head",
            label,
            competitorId: cmpId(a),
            isOwn: a.kind === "own",
            brandName: a.name,
            opponentCompetitorId: cmpId(b),
            opponentIsOwn: b.kind === "own",
            opponentName: b.name,
            winner,
          });
        };
        if (p.kind === "comparison" && p.compare && rng.bool(0.9)) {
          const [a, b] = p.compare.map((k) => brandByKey.get(k)!) as [BrandDef, BrandDef];
          const n = rng.bool(0.55) ? 1 : 2;
          for (let i = 0; i < n; i++) addClaim(a, b);
        } else if (p.kind !== "comparison") {
          const trackedNamed = ordered.filter((b) => b.kind !== "untracked");
          if (trackedNamed.length >= 2 && rng.bool(0.15)) {
            if (trackedNamed.some((b) => b.kind === "own") && rng.bool(0.85)) {
              addClaim(own, rng.pick(trackedNamed.filter((b) => b.kind !== "own")));
            } else {
              const [a, b] = rng.weightedSample(trackedNamed, 2, () => 1) as [BrandDef, BrandDef];
              addClaim(a, b);
            }
          }
        }

        let verdictWinner: BrandDef | null = null;
        if (p.kind === "comparison" && claims.length) {
          const wins = { brand: 0, opponent: 0 };
          for (const c of claims) if (c.winner !== "tie") wins[c.winner]++;
          if (wins.brand !== wins.opponent) verdictWinner = wins.brand > wins.opponent ? claims[0]!.a : claims[0]!.b;
          if (verdictWinner) recommended.add(verdictWinner.key);
        }

        /* 5 ─ items / products named in text */
        const items: Item[] = ordered.map((b) => {
          let product: ProductDef | null = null;
          if (p.category && p.kind !== "brandlist") {
            const candidates = (productsByBrand.get(b.key) ?? []).map((i) => PRODUCTS[i]!).filter((x) => x.category === p.category);
            if (p.kind === "branded" && b.kind === "own" && p.products) product = candidates.find((x) => x.name.includes("Cloudline")) ?? candidates[0] ?? null;
            else {
              const pool = eligibleProducts(b.key, p);
              if (pool.length) product = rng.weighted(pool, (x) => (p.kind === "deal" ? 150 / x.price : 1));
            }
          }
          return { brand: b, label: product?.name ?? b.name, product, quotes: quotesByBrand.get(b.key) ?? [] };
        });

        /* 6 ─ text */
        const text = buildText(rng, p, items, bestFor, claims, verdictWinner, own);

        /* 7 ─ citations */
        const citedBrands = new Set<string>();
        let ownCitationCount = 0;
        const [cmin, cmax] = ENGINE_CITATIONS[engine];
        const nCit = rng.int(cmin, cmax);
        const chosen: number[] = [];
        if (nCit > 0) {
          let pOwn = (0.14 + 0.16 * t) * ownCiteEngine[engine];
          pOwn = selected.has("own") ? Math.min(0.9, pOwn * 1.6) : pOwn * 0.3;
          if (p.kind === "branded") pOwn = Math.min(0.95, pOwn * 1.4);
          if (rng.bool(pOwn)) {
            const pick = rng.weighted(brandSources("own"), (x) => x.s.pop * (x.s.topics.some((tp) => p.tags.includes(tp)) ? 3 : 0.5));
            chosen.push(pick.i);
            citedBrands.add("own");
            ownCitationCount++;
          }
          for (const b of ordered) {
            if (b.kind !== "competitor") continue;
            if (!rng.bool(b.citeRate)) continue;
            const pick = rng.weighted(brandSources(b.key), (x) => x.s.pop * (x.s.topics.some((tp) => p.tags.includes(tp)) ? 2 : 1));
            chosen.push(pick.i);
            citedBrands.add(b.key);
          }
          const fill = Math.max(0, nCit - chosen.length);
          const prefs = ENGINE_SOURCE_PREFS[engine];
          const tp = rng.weightedSample(
            thirdPartySources,
            fill,
            (x) => x.s.pop * (prefs[x.s.type] ?? 1) * (x.s.topics.some((tg) => p.tags.includes(tg)) ? 3 : 0.35),
          );
          for (const x of tp) chosen.push(x.i);
        }
        rng.shuffle(chosen).forEach((srcIdx, pos) => {
          const sourceId = touch(sourceSeen, srcIdx, "src", at);
          citations.push({ id: newId("cit"), answerId, sourceId, projectId, promptId, engine, answerDate: date, position: pos + 1 });
        });

        /* 8 ─ mentions from actual text */
        const found: { b: BrandDef; offset: number; occurrences: number }[] = [];
        for (const b of BRANDS) {
          const re = brandRegex.get(b.key)!;
          re.lastIndex = 0;
          let first = -1;
          let count = 0;
          for (let m = re.exec(text); m; m = re.exec(text)) {
            if (first < 0) first = m.index;
            count++;
          }
          if (count > 0) found.push({ b, offset: first, occurrences: count });
        }
        found.sort((x, y) => x.offset - y.offset);
        let ownMention: { position: number; depth: number; sentiment: number } | null = null;
        found.forEach((f, idx) => {
          const lineStart = text.lastIndexOf("\n", f.offset) + 1;
          const lineEndRaw = text.indexOf("\n", f.offset);
          const line = text.slice(lineStart, lineEndRaw < 0 ? text.length : lineEndRaw).trim();
          const sentiment = clamp(
            lerp(f.b.sentiment[0], f.b.sentiment[1], t) + rng.gaussian(0, 6) + (sentimentAdj.get(f.b.key) ?? 0),
            5,
            98,
          );
          const depth = (f.offset / Math.max(1, text.length)) * 100;
          const row: MentionRow = {
            id: newId("men"),
            answerId,
            projectId,
            promptId,
            engine,
            answerDate: date,
            competitorId: cmpId(f.b),
            isOwn: f.b.kind === "own",
            brandName: f.b.name,
            position: idx + 1,
            charOffset: f.offset,
            depthPct: Math.round(depth * 100) / 100,
            occurrences: f.occurrences,
            cited: citedBrands.has(f.b.key),
            sentiment: Math.round(sentiment * 10) / 10,
            recommended: recommended.has(f.b.key),
            snippet: line.length > 320 ? `${line.slice(0, 317)}…` : line,
          };
          mentions.push(row);
          if (f.b.kind === "own") ownMention = { position: idx + 1, depth: row.depthPct!, sentiment: row.sentiment! };
        });

        /* 9 ─ product appearances */
        if (p.products && p.category) {
          const named = items.filter((it) => it.product).map((it, i) => ({ prod: it.product!, pos: i + 1 }));
          const hasCards =
            engine === "ai_overview" ? true : engine === "chatgpt" ? rng.bool(0.75) : engine === "gemini" ? rng.bool(0.45) : false;
          const cards: ProductDef[] = [];
          if (hasCards) {
            const nCards = rng.int(3, 6);
            for (const nm of named.slice(0, 2)) if (rng.bool(0.8)) cards.push(nm.prod);
            const cap = priceCap(p);
            const pool = PRODUCTS.filter((x) => x.category === p.category && !cards.includes(x) && (cap == null || x.price <= cap));
            const extra = rng.weightedSample(pool, Math.max(0, nCards - cards.length), (x) => {
              const b = brandByKey.get(x.brand)!;
              return (0.3 + strength(b, t)) * (p.kind === "deal" ? 150 / x.price : 1) * (named.some((n) => n.prod === x) ? 1.5 : 1);
            });
            cards.push(...extra);
          }
          const seen = new Set<ProductDef>();
          const emit = (prod: ProductDef, source: "llm" | "shopping" | "both", position: number) => {
            if (seen.has(prod)) return;
            seen.add(prod);
            const idx = PRODUCTS.indexOf(prod);
            const productId = touch(productSeen, idx, "apr", at);
            const b = brandByKey.get(prod.brand)!;
            const withStore = source !== "llm" || rng.bool(0.35);
            let price: number | null = null;
            let oldPrice: number | null = null;
            if (withStore || rng.bool(0.5)) {
              const base = prod.price * rng.float(0.95, 1.04);
              if (rng.bool(0.3)) {
                price = round99(base * rng.float(0.7, 0.88));
                oldPrice = round99(base);
              } else price = round99(base);
            }
            let store: string | null = null;
            let storeDomain: string | null = null;
            let url: string | null = null;
            if (withStore) {
              const options = [
                ...STORES.map((s) => ({ name: s.name, domain: s.domain, w: s.weight * (prod.category === "Trail shoes" ? (s.trail ?? 1) : 1), brandStore: false })),
                ...(b.domain ? [{ name: `${b.name} Store`, domain: b.domain, w: 1.5, brandStore: true }] : []),
              ];
              const st = rng.weighted(options, (o) => o.w);
              store = st.name;
              storeDomain = st.domain;
              url = st.brandStore
                ? `https://${st.domain}/products/${slug(prod.name.replace(b.name, ""))}`
                : `https://www.${st.domain}/search?q=${encodeURIComponent(prod.name)}`;
            }
            productAppearances.push({
              id: newId("apa"),
              productId,
              answerId,
              projectId,
              promptId,
              engine,
              answerDate: date,
              source,
              position,
              price,
              oldPrice,
              currency: price != null ? "USD" : null,
              rating: withStore ? Math.round(clamp(prod.rating + rng.gaussian(0, 0.05), 3.8, 4.9) * 10) / 10 : null,
              reviews: withStore ? Math.round(prod.reviews * (0.85 + 0.3 * t) + rng.int(0, 40)) : null,
              store,
              storeDomain,
              url,
            });
          };
          cards.forEach((prod, i) => emit(prod, named.some((n) => n.prod === prod) ? "both" : "shopping", i + 1));
          for (const nm of named) emit(nm.prod, "llm", nm.pos);
        }

        /* 10 ─ ads */
        if ((engine === "ai_overview" || engine === "chatgpt") && p.funnel !== "tofu" && rng.bool(0.15)) {
          const picks = rng.weightedSample(
            ADS.map((a, i) => ({ a, i })),
            rng.bool(0.7) ? 1 : 2,
            (x) => x.a.weight * (x.a.topics.some((tg) => p.tags.includes(tg)) ? 3 : 0.5),
          );
          picks.forEach((x, k) => {
            const adId = touch(adSeen, x.i, "aad", at);
            adAppearances.push({
              id: newId("aap"),
              adId,
              answerId,
              projectId,
              promptId,
              engine,
              answerDate: date,
              position: Math.min(3, k + rng.int(1, 2)),
              rating: x.a.rating != null ? Math.round(clamp(x.a.rating + rng.gaussian(0, 0.05), 4.2, 4.8) * 10) / 10 : null,
            });
          });
        }

        /* 11 ─ fan-outs */
        if (engine !== "claude") {
          const templates = FANOUT_TEMPLATES[p.kind];
          const [ca, cb] = p.compare ? p.compare.map((k) => brandByKey.get(k)!.name.toLowerCase()) : ["", ""];
          for (const q of rng.weightedSample(templates, rng.int(1, 3), () => 1)) {
            fanouts.push({
              id: newId("fan"),
              answerId,
              projectId,
              promptId,
              engine,
              answerDate: date,
              query: q.replaceAll("{core}", p.core.toLowerCase()).replaceAll("{A}", ca ?? "").replaceAll("{B}", cb ?? ""),
            });
          }
        }

        /* 12 ─ answer row */
        const own_ = ownMention as { position: number; depth: number; sentiment: number } | null;
        const cost = ENGINE_COST[engine] * rng.float(0.8, 1.3);
        answers.push({
          id: answerId,
          projectId,
          promptId,
          runId,
          engine,
          provider: "dataforseo",
          model: ENGINE_MODELS[engine],
          country: "US",
          language: "en",
          answerDate: date,
          status: "ok",
          text,
          raw: null,
          durationMs: rng.int(3500, engine === "perplexity" ? 14000 : 24000),
          costUsd: Math.round(cost * 100000) / 100000,
          brandMentioned: own_ != null,
          brandCited: citedBrands.has("own"),
          brandPosition: own_?.position ?? null,
          mentionDepth: own_?.depth ?? null,
          sentiment: own_?.sentiment ?? null,
          brandCount: found.length,
          // Denormalised citation counts (read by the Tracker table / REST `ownDomainCitations`).
          citationCount: chosen.length,
          ownCitationCount,
          analysisStatus: "done",
          analyzedAt: new Date(at + 20_000),
          createdAt: new Date(at),
        });
        dayAnswers++;
        dayCost += cost;
      }
    });

    runs.push({
      id: runId,
      projectId,
      trigger: "schedule",
      status: "completed",
      totalTasks: dayAnswers,
      doneTasks: dayAnswers,
      failedTasks: 0,
      costUsd: Math.round(dayCost * 10000) / 10000,
      fullRun: true,
      meta: { engines: [...DEMO_ENGINES] },
      startedAt: new Date(runStart),
      finishedAt: new Date(Math.min(answerClock + 60_000, nowMs)),
      createdAt: new Date(runStart - 1000),
    });
    lastRunAt = runStart;
  }

  for (const row of promptRows) row.lastRunAt = new Date(lastRunAt);

  /* ── Sources / products / ads rows ── */
  const ownershipOf = (s: SourceDef) => (s.brand === "own" ? "own" : s.brand ? "competitor" : "third_party");
  const sourceRows: (typeof aiSources.$inferInsert)[] = [...sourceSeen.entries()].map(([idx, seen]) => {
    const s = SOURCES[idx]!;
    return {
      id: seen.id,
      projectId,
      url: s.url,
      domain: new URL(s.url).hostname.replace(/^www\./, ""),
      title: s.title,
      contentType: s.type,
      ownership: ownershipOf(s),
      competitorId: s.brand && s.brand !== "own" ? (competitorId.get(s.brand) ?? null) : null,
      firstSeenAt: new Date(seen.first),
      lastSeenAt: new Date(seen.last),
    };
  });
  const productRows: (typeof aiProducts.$inferInsert)[] = [...productSeen.entries()].map(([idx, seen]) => {
    const pr = PRODUCTS[idx]!;
    const b = brandByKey.get(pr.brand)!;
    return {
      id: seen.id,
      projectId,
      name: pr.name,
      normalizedName: pr.name.toLowerCase().replace(/\s+/g, " ").trim(),
      brandName: b.name,
      competitorId: cmpId(b),
      isOwn: b.kind === "own",
      category: pr.category,
      imageUrl: null,
      attributes: pr.attributes,
      firstSeenAt: new Date(seen.first),
      lastSeenAt: new Date(seen.last),
    };
  });
  const adRows: (typeof aiAds.$inferInsert)[] = [...adSeen.entries()].map(([idx, seen]) => {
    const a = ADS[idx]!;
    const b = a.brand ? brandByKey.get(a.brand) : undefined;
    return {
      id: seen.id,
      projectId,
      advertiser: a.advertiser,
      advertiserDomain: a.advertiserDomain,
      competitorId: b ? cmpId(b) : null,
      isOwn: b?.kind === "own",
      headline: a.headline,
      description: a.description,
      imageUrl: null,
      landingUrl: a.landingUrl,
      fingerprint: `${a.advertiserDomain}:${slug(a.headline)}`,
      firstSeenAt: new Date(seen.first),
      lastSeenAt: new Date(seen.last),
    };
  });

  /* ── Prompt research list ── */
  const listId = newId("prl");
  const researchLists: (typeof promptResearchLists.$inferInsert)[] = [
    { id: listId, projectId, name: "Default List", isDefault: true, source: "generated", createdAt: new Date(startMs - DAY) },
  ];
  const maxVol = Math.max(...PROMPTS.map((p) => p.volume), ...RESEARCH_IDEAS.map((r) => r.volume));
  const lengthOf = (text: string) => {
    const w = text.split(/\s+/).length;
    return w <= 5 ? "short" : w <= 9 ? "medium" : "long";
  };
  const volumeScore = (v: number) => Math.round(Math.sqrt(v / maxVol) * 1000) / 1000;
  const researchItems: (typeof promptResearchItems.$inferInsert)[] = [
    ...PROMPTS.map((p, i) => {
      const compNames = BRANDS.filter((b) => b.kind !== "own" && p.text.includes(b.name)).map((b) => b.name);
      return {
        id: newId("pri"),
        listId,
        projectId,
        text: p.text,
        topic: p.tags[0],
        funnelStage: p.funnel,
        persona: p.persona,
        intent: p.intent,
        branded: p.kind === "branded" || p.text.includes(own.name),
        competitorMentioned: compNames.length ? compNames.join(", ") : null,
        length: lengthOf(p.text) as "short" | "medium" | "long",
        volumeScore: volumeScore(p.volume),
        volume: p.volume,
        trackedPromptId: promptIds[i]!,
        addedAt: promptRows[i]!.createdAt as Date,
        createdAt: new Date(startMs - DAY),
      };
    }),
    ...RESEARCH_IDEAS.map((r) => ({
      id: newId("pri"),
      listId,
      projectId,
      text: r.text,
      topic: r.topic,
      funnelStage: r.funnel,
      persona: r.persona,
      intent: r.intent,
      branded: r.branded ?? false,
      competitorMentioned: r.competitor ?? null,
      length: lengthOf(r.text) as "short" | "medium" | "long",
      volumeScore: volumeScore(r.volume),
      volume: r.volume,
      trackedPromptId: null,
      addedAt: null,
      createdAt: new Date(startMs - DAY),
    })),
  ];

  return {
    competitors: competitorRows,
    tags: tagRows,
    prompts: promptRows,
    tagLinks: tagLinkRows,
    runs,
    answers,
    sources: sourceRows,
    products: productRows,
    ads: adRows,
    mentions,
    citations,
    fanouts,
    statements,
    recommendations,
    productAppearances,
    adAppearances,
    researchLists,
    researchItems,
  };
}

/** How relevant each attribute is for a prompt topic (unlisted attributes default to 0.4). */
const TOPIC_ATTRIBUTE_RELEVANCE: Record<string, Record<string, number>> = {
  Running: { Cushioning: 3, "Energy return": 2.5, Durability: 2, "Fit & sizing": 2, Weight: 1.8, Breathability: 1.2, "Value for money": 1.5, "Returns & service": 1, Style: 1, "Color options": 0.8, Availability: 1, "Recycled materials": 0.8, "Carbon footprint": 0.3, "Ethical production": 0.3, "Grip & traction": 0.2 },
  Trail: { "Grip & traction": 4, Durability: 3, Weight: 1.5, "Fit & sizing": 1.5, Cushioning: 1.5, Breathability: 1, "Carbon footprint": 0.3 },
  Sustainability: { "Recycled materials": 4, "Carbon footprint": 3.5, "Ethical production": 3, Durability: 1.5, "Value for money": 0.8, "Grip & traction": 0.2, "Energy return": 0.2 },
  Deals: { "Value for money": 4, Availability: 2.5, Durability: 1.5, Cushioning: 1.2, "Returns & service": 1.5, "Grip & traction": 0.2, "Carbon footprint": 0.2 },
  Gear: { Breathability: 3, "Fit & sizing": 2, Style: 2, Durability: 1.5, "Color options": 1.5, "Value for money": 1.2, Weight: 1.5, "Recycled materials": 1, "Energy return": 0.1, "Grip & traction": 0.2 },
  Brand: { "Fit & sizing": 2, "Returns & service": 2, Cushioning: 2, Durability: 2, "Value for money": 2, Availability: 1.5, "Recycled materials": 1.5, "Grip & traction": 0.2 },
  Comparisons: { Cushioning: 2, Durability: 2, "Energy return": 2, "Value for money": 2, "Fit & sizing": 1.5, Weight: 1.5, "Grip & traction": 0.4 },
};

function attributeWeight(attr: string, polarity: Polarity, b: BrandDef, p: PromptDef): number {
  let w = 0;
  for (const tag of p.tags) w = Math.max(w, TOPIC_ATTRIBUTE_RELEVANCE[tag]?.[attr] ?? 0.4);
  if (p.tags.includes("Comparisons") && p.tags.includes("Trail") && attr === "Grip & traction") w = 4;
  if ((p.category === "Apparel" || p.category === "Accessories") && ["Energy return", "Grip & traction", "Cushioning"].includes(attr))
    w *= attr === "Cushioning" && p.category === "Accessories" ? 1 : 0.1;
  if (p.text.includes("true to size") && attr === "Fit & sizing") w *= 8;
  if (polarity === "praise" && b.praise.includes(attr)) w *= 4;
  if (polarity === "criticism" && b.criticism.includes(attr)) w *= 6;
  if (polarity === "criticism" && b.praise.includes(attr)) w *= 0.2;
  if (polarity === "praise" && b.criticism.includes(attr)) w *= 0.3;
  return w;
}

/* ─────────────────────────────── Answer text ─────────────────────────────── */

function buildText(
  rng: Rng,
  p: PromptDef,
  items: Item[],
  bestFor: { label: Situation; winner: BrandDef }[],
  claims: { a: BrandDef; b: BrandDef; label: string; winner: "brand" | "opponent" | "tie" }[],
  verdictWinner: BrandDef | null,
  own: BrandDef,
): string {
  const lines: string[] = [];
  const category = p.category ?? "Running shoes";
  const reasonFor = (it: Item) => {
    if (it.quotes[0]) return it.quotes.join(" ");
    if (p.kind === "brandlist") return `${cap(it.brand.tagline)}.`;
    return `${cap(rng.pick(REASONS[category]))}.`;
  };

  if (p.kind === "best" || p.kind === "deal" || p.kind === "brandlist") {
    lines.push(rng.pick(LIST_INTROS[p.kind]).replace("{core}", p.core), "");
    items.forEach((it, i) => {
      const price = p.kind === "deal" && it.product ? ` (around $${Math.round(it.product.price)})` : "";
      lines.push(`${i + 1}. **${it.label}**${price} — ${reasonFor(it)}`);
    });
    lines.push("");
    if (bestFor.length) {
      lines.push(bestFor.map((r) => `**${r.winner.name}** is ${SITUATION_PHRASE[r.label]}.`).join(" "));
      if (rng.bool(0.5)) lines.push("", rng.pick(GENERIC_CLOSINGS));
    } else lines.push(rng.pick(GENERIC_CLOSINGS));
    return lines.join("\n");
  }

  if (p.kind === "comparison") {
    const [a, b, ...rest] = items;
    if (!a || !b) return `There is limited information comparing these brands for ${p.core}.`;
    lines.push(`Both **${a.brand.name}** and **${b.brand.name}** are popular choices for ${p.core}. Here's how they compare:`, "");
    for (const it of [a, b]) {
      lines.push(`### ${it.brand.name}`);
      if (it.product) lines.push(`- Key model: **${it.product.name}** (around $${Math.round(it.product.price)})`);
      else {
        const prod = PRODUCTS.find((x) => x.brand === it.brand.key && (x.category === "Running shoes" || x.category === "Trail shoes"));
        if (prod) lines.push(`- Key model: **${prod.name}** (around $${Math.round(prod.price)})`);
      }
      if (it.quotes.length) for (const q of it.quotes) lines.push(`- ${q}`);
      else lines.push(`- ${cap(it.brand.tagline)}.`);
      lines.push("");
    }
    if (claims.length) {
      lines.push(
        `**Verdict:** ${claims.map((c) => `${c.label}.`).join(" ")} ${
          verdictWinner ? `For most runners, **${verdictWinner.name}** has the edge.` : "It's a close call — try both if you can."
        }`,
      );
    } else lines.push(`**Verdict:** Both are solid options; the better choice depends on your fit and preferred ride.`);
    if (rest.length) lines.push("", `If neither feels right, ${joinBold(rest.map((r) => r.brand.name))} ${rest.length > 1 ? "are" : "is"} also worth a look.`);
    return lines.join("\n");
  }

  if (p.kind === "branded") {
    const ownIdx = items.findIndex((it) => it.brand.kind === "own");
    const ownItem = ownIdx >= 0 ? items[ownIdx]! : null;
    const others = items.filter((it) => it.brand.kind !== "own");
    if (!ownItem) {
      lines.push(
        `There isn't much independent information about that brand for ${p.core}. Well-reviewed alternatives include ${joinBold(others.map((o) => o.brand.name))}.`,
      );
      return lines.join("\n");
    }
    if (ownIdx === 0) {
      lines.push(
        rng.pick([
          `**${own.name}** is well regarded when it comes to ${p.core}.`,
          `Yes — **${own.name}** gets strong feedback from runners on ${p.core}.`,
          `**${own.name}** has built a solid reputation among runners, including for ${p.core}.`,
        ]),
      );
    } else {
      lines.push(
        `Compared with **${others[0]!.brand.name}**, **${own.name}** is a smaller brand, but it gets strong feedback on ${p.core}.`,
      );
    }
    if (ownItem.quotes.length) lines.push("", ownItem.quotes.join(" "));
    if (ownItem.product) lines.push("", `The **${ownItem.product.name}** (around $${Math.round(ownItem.product.price)}) is its best-known model — ${rng.pick(REASONS[ownItem.product.category])}.`);
    else if (rng.bool(0.7)) lines.push("", `Its **Stridewell Cloudline 4** is the model runners mention most often.`);
    const alts = others.filter((o) => ownIdx !== 0 ? o !== others[0] : true);
    if (alts.length) {
      lines.push("", `Alternatives worth comparing include ${joinBold(alts.map((o) => o.brand.name))}.`);
      for (const o of alts) if (o.quotes[0]) lines.push(o.quotes[0]);
    }
    lines.push("", rng.pick(GENERIC_CLOSINGS));
    return lines.join("\n");
  }

  // info
  lines.push(p.intro ?? `Here's what to know about ${p.core}.`, "");
  for (const tip of p.tips ?? []) lines.push(`- ${tip}`);
  if (items.length) {
    lines.push("", `Brands that are often recommended here include ${joinBold(items.map((i) => i.brand.name))}.`);
    const quoted = items.filter((i) => i.quotes[0]).slice(0, 2);
    if (quoted.length) lines.push(quoted.map((q) => q.quotes[0]).join(" "));
  }
  lines.push("", rng.pick(GENERIC_CLOSINGS));
  return lines.join("\n");
}

/** Builds the seeded dataset and bulk-inserts it (optionally replacing the project's previous demo data). */
async function writeDemoData(
  projectId: string,
  createdById: string | null,
  seed: string,
  days: number,
  t0: number,
  opts: { replace?: boolean } = {},
): Promise<Record<string, number>> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new Error("Project not found.");
  const now = new Date();
  const tBuild = Date.now();
  const data = buildDemoData(projectId, createdById, seed, days, now);
  const buildMs = Date.now() - tBuild;
  const moduleStats: Record<string, number> = {};
  const moduleCtx = (tx: DemoTx): DemoModuleCtx => ({
    tx,
    projectId,
    workspaceId: project.workspaceId,
    userId: createdById,
    seed,
    days,
    now,
    brandName: project.name.replace(/^Demo · /, ""),
    domain: project.domain,
    country: project.country,
    language: project.language,
    competitors: data.competitors.map((c) => ({ id: c.id!, name: c.name, domain: c.domain ?? null })),
    prompts: data.prompts.map((p) => ({ id: p.id!, text: p.text, topic: p.topic ?? null, funnelStage: p.funnelStage ?? null })),
    rng: makeRng(seed),
  });

  const tInsert = Date.now();
  await db.transaction(async (tx) => {
    if (opts.replace) {
      // Module data first (it may reference core rows), then the core AI data (children cascade).
      const clearCtx = moduleCtx(tx);
      for (const m of DEMO_MODULES) await m.clear(clearCtx);
      await tx.delete(promptResearchLists).where(eq(promptResearchLists.projectId, projectId));
      await tx.delete(aiAds).where(eq(aiAds.projectId, projectId));
      await tx.delete(aiProducts).where(eq(aiProducts.projectId, projectId));
      await tx.delete(aiSources).where(eq(aiSources.projectId, projectId));
      await tx.delete(prompts).where(eq(prompts.projectId, projectId));
      await tx.delete(promptTags).where(eq(promptTags.projectId, projectId));
      await tx.delete(aiRuns).where(eq(aiRuns.projectId, projectId));
      await tx.delete(competitors).where(eq(competitors.projectId, projectId));
    }
    const chunk = async <T>(rows: T[], size: number, insert: (part: T[]) => Promise<unknown>) => {
      for (let i = 0; i < rows.length; i += size) await insert(rows.slice(i, i + size));
    };
    await chunk(data.competitors, 1000, (r) => tx.insert(competitors).values(r));
    await chunk(data.tags, 1000, (r) => tx.insert(promptTags).values(r));
    await chunk(data.prompts, 1000, (r) => tx.insert(prompts).values(r));
    await chunk(data.tagLinks, 1000, (r) => tx.insert(promptTagLinks).values(r));
    await chunk(data.runs, 1000, (r) => tx.insert(aiRuns).values(r));
    await chunk(data.answers, 500, (r) => tx.insert(aiAnswers).values(r));
    await chunk(data.sources, 1000, (r) => tx.insert(aiSources).values(r));
    await chunk(data.products, 1000, (r) => tx.insert(aiProducts).values(r));
    await chunk(data.ads, 1000, (r) => tx.insert(aiAds).values(r));
    await chunk(data.mentions, 1000, (r) => tx.insert(aiMentions).values(r));
    await chunk(data.citations, 1000, (r) => tx.insert(aiCitations).values(r));
    await chunk(data.fanouts, 1000, (r) => tx.insert(aiFanouts).values(r));
    await chunk(data.statements, 1000, (r) => tx.insert(aiStatements).values(r));
    await chunk(data.recommendations, 1000, (r) => tx.insert(aiRecommendations).values(r));
    await chunk(data.productAppearances, 1000, (r) => tx.insert(aiProductAppearances).values(r));
    await chunk(data.adAppearances, 1000, (r) => tx.insert(aiAdAppearances).values(r));
    await chunk(data.researchLists, 1000, (r) => tx.insert(promptResearchLists).values(r));
    await chunk(data.researchItems, 1000, (r) => tx.insert(promptResearchItems).values(r));

    // Other modules (analytics, SEO, audit, attribution…) — same transaction, insert-only.
    const ctx = moduleCtx(tx);
    for (const m of DEMO_MODULES) {
      const t = Date.now();
      const counts = await m.insert(ctx);
      for (const [k, v] of Object.entries(counts)) moduleStats[`${m.name}.${k}`] = v;
      moduleStats[`${m.name}.ms`] = Date.now() - t;
    }
  });
  const insertMs = Date.now() - tInsert;

  // Service-based steps (reports, task generator) need committed data and the global db.
  for (const step of DEMO_POST_STEPS) {
    const t = Date.now();
    try {
      const counts = await step.run({ projectId, workspaceId: project.workspaceId, userId: createdById, seed, now });
      for (const [k, v] of Object.entries(counts)) moduleStats[`${step.name}.${k}`] = v;
    } catch (err) {
      console.error(`[demo] post step "${step.name}" failed`, err);
      moduleStats[`${step.name}.failed`] = 1;
    }
    moduleStats[`${step.name}.ms`] = Date.now() - t;
  }

  return {
      days,
      competitors: data.competitors.length,
      prompts: data.prompts.length,
      tags: data.tags.length,
      runs: data.runs.length,
      answers: data.answers.length,
      mentions: data.mentions.length,
      sources: data.sources.length,
      citations: data.citations.length,
      fanouts: data.fanouts.length,
      statements: data.statements.length,
      recommendations: data.recommendations.length,
      products: data.products.length,
      productAppearances: data.productAppearances.length,
      ads: data.ads.length,
      adAppearances: data.adAppearances.length,
      researchItems: data.researchItems.length,
      ...moduleStats,
      buildMs,
      insertMs,
      totalMs: Date.now() - t0,
  };
}

/**
 * Regenerates the data of an existing demo project in place (same project id), e.g. to move the
 * 90-day window up to today or after a schema change. Refuses projects not flagged as demo.
 */
export async function regenerateDemoProject(projectId: string, opts: { seed?: string; days?: number } = {}): Promise<DemoProjectResult> {
  const t0 = Date.now();
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new Error("Project not found.");
  const settings = (project.settings ?? {}) as Record<string, unknown>;
  if (settings.demo !== true) throw new Error("Only demo projects can be regenerated.");
  const seed = opts.seed?.trim() || (typeof settings.demoSeed === "string" ? settings.demoSeed : DEMO_DEFAULT_SEED);
  const days = Math.round(clamp(opts.days ?? (typeof settings.demoDays === "number" ? settings.demoDays : 90), 7, 365));
  const stats = await writeDemoData(projectId, project.createdBy, seed, days, t0, { replace: true });
  await db
    .update(projects)
    .set({ settings: { ...settings, demo: true, demoSeed: seed, demoDays: days, demoGeneratedAt: new Date().toISOString() } })
    .where(eq(projects.id, projectId));
  return { projectId, stats };
}
