import "server-only";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
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
  aiSources,
  aiStatements,
  competitors,
  projects,
  prompts,
} from "@/server/db/schema";
import { sha256 } from "@/server/crypto";
import { AiNotConfiguredError } from "@/server/ai/llm";
import { BudgetExceededError } from "@/server/usage";
import { type BrandDef, type BrandHit, matchBrands, normalizeName, ownBrandTerms, resolveBrand } from "./brand-match";
import { classifySource, normalizeUrl, sourceOwnership, urlDomain } from "./sources";
import { runAnswerAnalysis, type AnswerAnalysis } from "./llm-pass";

/** Shape of `ai_answers.raw` written by the tracking pipeline. */
const storedRawSchema = z.object({
  citations: z.array(z.object({ url: z.string(), title: z.string().nullable().optional(), position: z.number().optional() })).default([]),
  fanouts: z.array(z.string()).default([]),
  shopping: z
    .array(
      z.object({
        name: z.string(),
        brand: z.string().nullish(),
        price: z.number().nullish(),
        oldPrice: z.number().nullish(),
        currency: z.string().nullish(),
        rating: z.number().nullish(),
        reviews: z.number().nullish(),
        store: z.string().nullish(),
        storeDomain: z.string().nullish(),
        url: z.string().nullish(),
        imageUrl: z.string().nullish(),
        position: z.number().nullish(),
      }),
    )
    .default([]),
  ads: z
    .array(
      z.object({
        advertiser: z.string(),
        advertiserDomain: z.string().nullish(),
        headline: z.string(),
        description: z.string().nullish(),
        imageUrl: z.string().nullish(),
        landingUrl: z.string().nullish(),
        position: z.number().nullish(),
        rating: z.number().nullish(),
      }),
    )
    .default([]),
});

export type StoredAnswerRaw = z.infer<typeof storedRawSchema> & { provider?: Record<string, unknown> };

export function parseStoredRaw(raw: unknown): z.infer<typeof storedRawSchema> {
  const res = storedRawSchema.safeParse(raw ?? {});
  return res.success ? res.data : { citations: [], fanouts: [], shopping: [], ads: [] };
}

export type AnalysisSummary = {
  answerId: string;
  status: "done" | "failed" | "skipped";
  mentions: number;
  citations: number;
  fanouts: number;
  products: number;
  ads: number;
  statements: number;
  llm: { provider: string; model: string } | null;
  error: string | null;
};

type Loaded = NonNullable<Awaited<ReturnType<typeof load>>>;

async function load(answerId: string) {
  const [answer] = await db.select().from(aiAnswers).where(eq(aiAnswers.id, answerId)).limit(1);
  if (!answer) return null;
  const [project] = await db.select().from(projects).where(eq(projects.id, answer.projectId)).limit(1);
  const [prompt] = await db.select().from(prompts).where(eq(prompts.id, answer.promptId)).limit(1);
  if (!project || !prompt) return null;
  const comps = await db.select().from(competitors).where(eq(competitors.projectId, project.id));
  return { answer, project, prompt, comps };
}

function brandDefs(l: Loaded): BrandDef[] {
  const own: BrandDef = {
    key: "own",
    name: l.project.name,
    terms: ownBrandTerms({ name: l.project.name, domain: l.project.domain, brand: l.project.brand }),
    domains: [l.project.domain, ...(l.project.brand?.domains ?? [])].filter(Boolean),
    isOwn: true,
    competitorId: null,
  };
  const comps: BrandDef[] = l.comps.map((c) => ({
    key: c.id,
    name: c.name,
    terms: [c.name, ...(c.aliases ?? []), ...(c.domain ? [c.domain] : [])],
    domains: c.domain ? [c.domain] : [],
    isOwn: false,
    competitorId: c.id,
  }));
  return [own, ...comps];
}

function brandRef(name: string, defs: BrandDef[]) {
  const def = resolveBrand(name, defs);
  if (def && (def.isOwn || def.competitorId)) return { isOwn: def.isOwn, competitorId: def.competitorId, brandName: def.name };
  return { isOwn: false, competitorId: null as string | null, brandName: def?.name ?? name.trim() };
}

function productKey(name: string): string {
  return normalizeName(name)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .slice(0, 200);
}

/**
 * Analyzes one stored answer: deterministic brand matching + citations/sources + fan-outs +
 * shopping/ads, then (optionally) an LLM pass for sentiment, statements, picks, products and
 * untracked brands. Idempotent — previous analysis rows of the answer are replaced.
 */
export async function analyzeAnswer(answerId: string, opts: { llm?: boolean } = {}): Promise<AnalysisSummary> {
  const l = await load(answerId);
  if (!l) throw new Error(`Answer ${answerId} not found`);
  const { answer, project, prompt } = l;
  const summary: AnalysisSummary = {
    answerId,
    status: "done",
    mentions: 0,
    citations: 0,
    fanouts: 0,
    products: 0,
    ads: 0,
    statements: 0,
    llm: null,
    error: null,
  };

  if (answer.status !== "ok") {
    await db.transaction(async (tx) => {
      await clearAnalysis(tx, answerId);
      await tx
        .update(aiAnswers)
        .set({ analysisStatus: "skipped", analysisError: "Answer failed — nothing to analyze.", analyzedAt: new Date() })
        .where(eq(aiAnswers.id, answerId));
    });
    return { ...summary, status: "skipped", error: "answer_error" };
  }

  const raw = parseStoredRaw(answer.raw);
  const defs = brandDefs(l);
  const ownDomains = defs[0]!.domains;
  const compDomains = l.comps.filter((c) => c.domain).map((c) => ({ id: c.id, domains: [c.domain!] }));

  // ── Citations → normalized sources ──
  const seen = new Set<string>();
  const cites: { url: string; domain: string; title: string | null; position: number }[] = [];
  for (const c of raw.citations) {
    const url = normalizeUrl(c.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    cites.push({ url, domain: urlDomain(url), title: c.title?.trim() || null, position: cites.length + 1 });
  }
  const citedDomains = [...new Set(cites.map((c) => c.domain))];

  // ── LLM pass (optional) ──
  let analysis: AnswerAnalysis | null = null;
  let llmStatus: "done" | "failed" | "skipped" = "skipped";
  let llmError: string | null = null;
  if (opts.llm !== false && answer.text.trim()) {
    try {
      const res = await runAnswerAnalysis({
        projectId: project.id,
        workspaceId: project.workspaceId,
        prompt: prompt.text,
        engine: answer.engine,
        country: answer.country,
        language: answer.language,
        text: answer.text,
        own: { name: project.name, aliases: project.brand?.aliases ?? [] },
        competitors: l.comps.map((c) => ({ name: c.name, aliases: c.aliases ?? [] })),
      });
      analysis = res.data;
      summary.llm = { provider: res.provider, model: res.model };
      llmStatus = "done";
    } catch (err) {
      if (err instanceof AiNotConfiguredError || err instanceof BudgetExceededError) {
        llmStatus = "skipped";
        llmError = err.message;
      } else {
        llmStatus = "failed";
        llmError = err instanceof Error ? err.message.slice(0, 500) : String(err);
        console.error(`[ai-analysis] LLM pass failed for ${answerId}:`, llmError);
      }
    }
  } else if (!answer.text.trim()) {
    llmError = "Empty answer (the engine showed no AI answer for this query).";
  } else {
    llmError = "LLM pass disabled.";
  }

  // ── Brands: tracked + untracked (discovered by the LLM, located in the text) ──
  const untracked: BrandDef[] = [];
  const untrackedMeta = new Map<string, { sentiment: number; recommended: boolean }>();
  for (const b of analysis?.otherBrands ?? []) {
    if (resolveBrand(b.name, defs)) continue;
    const key = `x:${normalizeName(b.name)}`;
    if (untracked.some((u) => u.key === key)) continue;
    const domain = b.domain ? (urlDomain(b.domain.includes("://") ? b.domain : `https://${b.domain}`) || null) : null;
    untracked.push({ key, name: b.name.trim(), terms: [b.name], domains: domain ? [domain] : [], isOwn: false, competitorId: null });
    untrackedMeta.set(key, { sentiment: b.sentiment, recommended: b.recommended });
  }
  const allDefs = [...defs, ...untracked];
  const hits: BrandHit[] = matchBrands(answer.text, allDefs, citedDomains);

  const llmBrand = new Map<string, { sentiment: number; recommended: boolean }>();
  for (const b of analysis?.brands ?? []) {
    const def = resolveBrand(b.name, defs);
    if (def) llmBrand.set(def.key, { sentiment: b.sentiment, recommended: b.recommended });
  }
  const bestForKeys = new Set((analysis?.bestFor ?? []).map((p) => resolveBrand(p.brand, allDefs)?.key).filter(Boolean) as string[]);

  const ownHit = hits.find((h) => h.isOwn) ?? null;
  const ownCited = citedDomains.some((d) => sourceOwnership(d, ownDomains, []).ownership === "own");
  const ownSentiment = ownHit ? (llmBrand.get("own")?.sentiment ?? null) : null;

  // ── Products: shopping cards + LLM-named products ──
  type ProductIn = {
    key: string;
    name: string;
    brand: string | null;
    category: string | null;
    imageUrl: string | null;
    attributes: Record<string, string>;
    source: "llm" | "shopping" | "both";
    shop?: z.infer<typeof storedRawSchema>["shopping"][number];
  };
  const products = new Map<string, ProductIn>();
  for (const s of raw.shopping) {
    const key = productKey(s.name);
    if (!key || products.has(key)) continue;
    products.set(key, { key, name: s.name.trim(), brand: s.brand ?? null, category: null, imageUrl: s.imageUrl ?? null, attributes: {}, source: "shopping", shop: s });
  }
  for (const p of analysis?.products ?? []) {
    const key = productKey(p.name);
    if (!key) continue;
    const attrs = Object.fromEntries(p.attributes.slice(0, 12).map((a) => [a.key.slice(0, 40), a.value.slice(0, 120)]));
    const cur = products.get(key);
    if (cur) {
      cur.source = cur.source === "shopping" ? "both" : cur.source;
      cur.brand = cur.brand ?? p.brand;
      cur.category = cur.category ?? p.category;
      cur.attributes = { ...attrs, ...cur.attributes };
    } else {
      products.set(key, { key, name: p.name.trim(), brand: p.brand, category: p.category, imageUrl: null, attributes: attrs, source: "llm" });
    }
  }

  const seenAt = answer.createdAt;
  await db.transaction(async (tx) => {
    await clearAnalysis(tx, answerId);
    const base = { answerId, projectId: project.id, promptId: prompt.id, engine: answer.engine, answerDate: answer.answerDate };

    // Mentions
    if (hits.length) {
      await tx.insert(aiMentions).values(
        hits.map((h) => {
          const meta = h.competitorId || h.isOwn ? llmBrand.get(h.key) : untrackedMeta.get(h.key);
          return {
            ...base,
            competitorId: h.competitorId,
            isOwn: h.isOwn,
            brandName: h.name,
            position: h.position,
            charOffset: h.charOffset,
            depthPct: h.depthPct,
            occurrences: h.occurrences,
            cited: h.cited,
            sentiment: meta?.sentiment ?? null,
            recommended: Boolean(meta?.recommended) || bestForKeys.has(h.key),
            snippet: h.snippet || null,
          };
        }),
      );
    }

    // Sources + citations
    let ownCitationCount = 0;
    if (cites.length) {
      const rows = cites.map((c) => {
        const own = sourceOwnership(c.domain, ownDomains, compDomains);
        if (own.ownership === "own") ownCitationCount++;
        return {
          projectId: project.id,
          url: c.url,
          domain: c.domain,
          title: c.title,
          contentType: classifySource({ url: c.url, domain: c.domain, title: c.title, ownership: own.ownership }),
          ownership: own.ownership,
          competitorId: own.competitorId,
          firstSeenAt: seenAt,
          lastSeenAt: seenAt,
        };
      });
      const sources = await tx
        .insert(aiSources)
        .values(rows)
        .onConflictDoUpdate({
          target: [aiSources.projectId, aiSources.url],
          set: {
            title: sql`coalesce(${aiSources.title}, excluded.title)`,
            ownership: sql`excluded.ownership`,
            competitorId: sql`excluded.competitor_id`,
            contentType: sql`case when ${aiSources.title} is null and excluded.title is not null then excluded.content_type else ${aiSources.contentType} end`,
            firstSeenAt: sql`least(${aiSources.firstSeenAt}, excluded.first_seen_at)`,
            lastSeenAt: sql`greatest(${aiSources.lastSeenAt}, excluded.last_seen_at)`,
          },
        })
        .returning({ id: aiSources.id, url: aiSources.url });
      const idByUrl = new Map(sources.map((s) => [s.url, s.id]));
      await tx.insert(aiCitations).values(
        cites.filter((c) => idByUrl.has(c.url)).map((c) => ({ ...base, sourceId: idByUrl.get(c.url)!, position: c.position })),
      );
    }

    // Fan-outs
    const fanouts = [...new Set(raw.fanouts.map((f) => f.trim()).filter(Boolean))].slice(0, 40);
    if (fanouts.length) await tx.insert(aiFanouts).values(fanouts.map((query) => ({ ...base, query: query.slice(0, 500) })));

    // Statements
    const statements = analysis?.statements ?? [];
    if (statements.length) {
      await tx.insert(aiStatements).values(
        statements.map((s) => ({
          ...base,
          ...brandRef(s.brand, allDefs),
          polarity: s.polarity,
          theme: s.theme || null,
          attribute: s.attribute || null,
          quote: s.quote,
          severity: s.severity,
        })),
      );
    }

    // Recommendations
    const recs = [
      ...(analysis?.bestFor ?? []).map((p) => ({ ...base, kind: "best_for" as const, label: p.label.slice(0, 200), ...brandRef(p.brand, allDefs) })),
      ...(analysis?.headToHead ?? []).map((h) => {
        const opp = brandRef(h.opponent, allDefs);
        return {
          ...base,
          kind: "head_to_head" as const,
          label: h.claim.slice(0, 300),
          ...brandRef(h.brand, allDefs),
          opponentCompetitorId: opp.competitorId,
          opponentIsOwn: opp.isOwn,
          opponentName: opp.brandName,
          winner: h.winner,
        };
      }),
    ];
    if (recs.length) await tx.insert(aiRecommendations).values(recs);

    // Products
    let productCount = 0;
    for (const p of products.values()) {
      const byBrand = p.brand ? resolveBrand(p.brand, defs) : null;
      const byName = byBrand ?? matchBrands(p.name, defs)[0] ?? null;
      const ref = byBrand
        ? { isOwn: byBrand.isOwn, competitorId: byBrand.competitorId, brandName: byBrand.name }
        : byName
          ? { isOwn: byName.isOwn, competitorId: byName.competitorId, brandName: byName.name }
          : { isOwn: false, competitorId: null, brandName: p.brand };
      const [row] = await tx
        .insert(aiProducts)
        .values({
          projectId: project.id,
          name: p.name.slice(0, 300),
          normalizedName: p.key,
          brandName: ref.brandName ?? null,
          competitorId: ref.competitorId,
          isOwn: ref.isOwn,
          category: p.category,
          imageUrl: p.imageUrl,
          attributes: p.attributes,
          firstSeenAt: seenAt,
          lastSeenAt: seenAt,
        })
        .onConflictDoUpdate({
          target: [aiProducts.projectId, aiProducts.normalizedName],
          set: {
            brandName: sql`coalesce(${aiProducts.brandName}, excluded.brand_name)`,
            competitorId: sql`coalesce(${aiProducts.competitorId}, excluded.competitor_id)`,
            isOwn: sql`${aiProducts.isOwn} or excluded.is_own`,
            category: sql`coalesce(${aiProducts.category}, excluded.category)`,
            imageUrl: sql`coalesce(${aiProducts.imageUrl}, excluded.image_url)`,
            attributes: sql`excluded.attributes || ${aiProducts.attributes}`,
            firstSeenAt: sql`least(${aiProducts.firstSeenAt}, excluded.first_seen_at)`,
            lastSeenAt: sql`greatest(${aiProducts.lastSeenAt}, excluded.last_seen_at)`,
          },
        })
        .returning({ id: aiProducts.id });
      if (!row) continue;
      const shop = p.shop;
      await tx.insert(aiProductAppearances).values({
        ...base,
        productId: row.id,
        source: p.source,
        position: shop?.position ?? null,
        price: shop?.price ?? null,
        oldPrice: shop?.oldPrice ?? null,
        currency: shop?.currency ?? null,
        rating: shop?.rating ?? null,
        reviews: shop?.reviews != null ? Math.round(shop.reviews) : null,
        store: shop?.store ?? null,
        storeDomain: shop?.storeDomain ?? null,
        url: shop?.url ?? null,
      });
      productCount++;
    }

    // Ads
    let adCount = 0;
    for (const a of raw.ads) {
      const landing = normalizeUrl(a.landingUrl ?? null);
      const advDomain = a.advertiserDomain?.toLowerCase().replace(/^www\./, "") ?? (landing ? urlDomain(landing) : null);
      const fingerprint = sha256(`${(advDomain ?? a.advertiser).toLowerCase()}|${a.headline.trim().toLowerCase()}|${landing ?? ""}`);
      const owner = advDomain ? sourceOwnership(advDomain, ownDomains, compDomains) : { ownership: "third_party" as const, competitorId: null };
      const byName = owner.ownership === "third_party" ? resolveBrand(a.advertiser, defs) : null;
      const [row] = await tx
        .insert(aiAds)
        .values({
          projectId: project.id,
          advertiser: a.advertiser.slice(0, 200),
          advertiserDomain: advDomain,
          competitorId: owner.competitorId ?? byName?.competitorId ?? null,
          isOwn: owner.ownership === "own" || Boolean(byName?.isOwn),
          headline: a.headline.slice(0, 300),
          description: a.description?.slice(0, 1000) ?? null,
          imageUrl: a.imageUrl ?? null,
          landingUrl: landing ?? a.landingUrl ?? null,
          fingerprint,
          firstSeenAt: seenAt,
          lastSeenAt: seenAt,
        })
        .onConflictDoUpdate({
          target: [aiAds.projectId, aiAds.fingerprint],
          set: {
            firstSeenAt: sql`least(${aiAds.firstSeenAt}, excluded.first_seen_at)`,
            lastSeenAt: sql`greatest(${aiAds.lastSeenAt}, excluded.last_seen_at)`,
            imageUrl: sql`coalesce(${aiAds.imageUrl}, excluded.image_url)`,
            description: sql`coalesce(${aiAds.description}, excluded.description)`,
          },
        })
        .returning({ id: aiAds.id });
      if (!row) continue;
      await tx.insert(aiAdAppearances).values({ ...base, adId: row.id, position: a.position ?? null, rating: a.rating ?? null });
      adCount++;
    }

    const trackedHits = hits.filter((h) => h.isOwn || h.competitorId);
    await tx
      .update(aiAnswers)
      .set({
        brandMentioned: Boolean(ownHit),
        brandCited: ownCited,
        brandPosition: ownHit?.position ?? null,
        mentionDepth: ownHit?.depthPct ?? null,
        sentiment: ownSentiment,
        brandCount: trackedHits.length,
        citationCount: cites.length,
        ownCitationCount,
        analysisStatus: llmStatus === "done" ? "done" : llmStatus,
        analysisError: llmError,
        analyzedAt: new Date(),
      })
      .where(eq(aiAnswers.id, answerId));

    summary.mentions = hits.length;
    summary.citations = cites.length;
    summary.fanouts = fanouts.length;
    summary.products = productCount;
    summary.ads = adCount;
    summary.statements = statements.length;
  });

  summary.status = llmStatus;
  summary.error = llmError;
  return summary;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function clearAnalysis(tx: Tx, answerId: string) {
  await tx.delete(aiMentions).where(eq(aiMentions.answerId, answerId));
  await tx.delete(aiCitations).where(eq(aiCitations.answerId, answerId));
  await tx.delete(aiFanouts).where(eq(aiFanouts.answerId, answerId));
  await tx.delete(aiStatements).where(eq(aiStatements.answerId, answerId));
  await tx.delete(aiRecommendations).where(eq(aiRecommendations.answerId, answerId));
  await tx.delete(aiProductAppearances).where(eq(aiProductAppearances.answerId, answerId));
  await tx.delete(aiAdAppearances).where(eq(aiAdAppearances.answerId, answerId));
}
