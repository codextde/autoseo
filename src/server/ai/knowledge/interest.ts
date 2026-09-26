import "server-only";
import { z } from "zod";
import { nanoid } from "nanoid";
import { availableLlmProviders, runLlm } from "@/server/ai/llm";
import { isDataForSeoConfigured } from "@/server/dataforseo/client";
import { fetchKeywordIdeas, fetchKeywordSuggestions, normalizeKeyword, type KeywordMetric } from "@/server/ai/research/keywords";
import { getCountry } from "@/lib/countries";
import { brandBriefing, getBrandProfile, getProjectRow, languageName } from "./profile";
import { getKnowledge } from "./store";
import type { InterestCluster, InterestData, SearchIntent, SitemapData } from "@/features/ai-research/types";

type Progress = (p: { step: string; message: string }) => Promise<void>;

const STOPWORDS = new Set(
  "the a an and or for of to in on with at by from is are was be how what which best vs versus near me my your de der die das und oder für mit von zu im in am an auf ist sind wie was welche beste bester günstig kaufen test ein eine einen einem einer den dem des bei aus nach über unter vs. le la les et ou pour avec en du des un une el la los las y o para con en".split(
    " ",
  ),
);

function slugToWords(seg: string) {
  return seg.replace(/[-_]+/g, " ").replace(/\d+/g, " ").replace(/\s+/g, " ").trim();
}

/** Seed terms: brand, profile categories, industry and top sitemap category sections. */
async function seedTerms(projectId: string, useLlm: boolean): Promise<string[]> {
  const profile = await getBrandProfile(projectId);
  const seeds = new Set<string>();
  seeds.add(profile.name.toLowerCase());
  for (const c of profile.categories) seeds.add(c.toLowerCase());
  if (profile.industry) seeds.add(profile.industry.toLowerCase());
  const sitemap = await getKnowledge<SitemapData>(projectId, "sitemap");
  if (sitemap.data) {
    const walk = (n: SitemapData["tree"], depth: number) => {
      for (const c of n.children) {
        if ((c.type === "category" || c.type === "product") && depth >= 1) {
          const words = slugToWords(c.name);
          if (words.length >= 3 && words.length <= 40) seeds.add(words.toLowerCase());
        }
        if (depth < 2) walk(c, depth + 1);
      }
    };
    walk(sitemap.data.tree, 0);
  }
  if (seeds.size < 4 && useLlm) {
    const p = await getProjectRow(projectId);
    const res = await runLlm({
      purpose: "brand_knowledge_interest_seeds",
      timeoutMs: 15 * 60_000,
      projectId,
      workspaceId: p.workspaceId,
      webSearch: true,
      prompt: `${await brandBriefing(projectId)}\n\nList 6–10 short generic search terms (1–3 words, in ${languageName(p.language)}) that describe the product categories and needs this brand serves. No brand names.`,
      schema: z.object({ terms: z.array(z.string()) }),
      maxTokens: 1500,
    });
    for (const t of res.data.terms) if (t.trim()) seeds.add(t.trim().toLowerCase());
  }
  return [...seeds].filter((s) => s.length >= 2).slice(0, 20);
}

function trendOf(monthly: { month: string; volume: number }[]) {
  if (monthly.length < 6) return { dir: null as InterestCluster["trendDirection"], pct: null as number | null };
  const last = monthly.slice(-3).reduce((a, m) => a + m.volume, 0);
  const prev = monthly.slice(-6, -3).reduce((a, m) => a + m.volume, 0);
  if (prev <= 0) return { dir: last > 0 ? ("up" as const) : null, pct: null };
  const pct = ((last - prev) / prev) * 100;
  return { dir: pct > 10 ? ("up" as const) : pct < -10 ? ("down" as const) : ("flat" as const), pct: Math.round(pct * 10) / 10 };
}

function majorityIntent(rows: KeywordMetric[]): SearchIntent {
  const weights = new Map<SearchIntent, number>();
  for (const r of rows) if (r.intent) weights.set(r.intent, (weights.get(r.intent) ?? 0) + (r.volume ?? 1));
  const sorted = [...weights.entries()].sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return "mixed";
  const total = sorted.reduce((a, [, w]) => a + w, 0);
  return sorted[0]![1] / total >= 0.55 ? sorted[0]![0] : "mixed";
}

function buildCluster(name: string, description: string | undefined, rows: KeywordMetric[], brandTerms: string[]): InterestCluster {
  const byMonth = new Map<string, number>();
  for (const r of rows) for (const m of r.monthly) byMonth.set(m.month, (byMonth.get(m.month) ?? 0) + m.volume);
  const trend = [...byMonth.entries()].map(([month, volume]) => ({ month, volume })).sort((a, b) => a.month.localeCompare(b.month)).slice(-12);
  const t = trendOf(trend);
  const hasVolume = rows.some((r) => r.volume != null);
  const volume = hasVolume ? rows.reduce((a, r) => a + (r.volume ?? 0), 0) : null;
  const brandedVolume = rows.filter((r) => brandTerms.some((b) => r.keyword.includes(b))).reduce((a, r) => a + (r.volume ?? 1), 0);
  const totalW = rows.reduce((a, r) => a + (r.volume ?? 1), 0) || 1;
  return {
    id: nanoid(8),
    name,
    description,
    intent: majorityIntent(rows),
    volume,
    trend,
    trendDirection: t.dir,
    trendPct: t.pct,
    branded: brandedVolume / totalW > 0.5,
    keywords: [...rows]
      .sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1))
      .slice(0, 60)
      .map((r) => ({ keyword: r.keyword, volume: r.volume, intent: r.intent })),
  };
}

/** Heuristic clustering (no LLM): group keywords by their strongest shared head term. */
function heuristicClusters(rows: KeywordMetric[], brandTerms: string[], maxClusters = 14): { name: string; rows: KeywordMetric[] }[] {
  const tokenWeight = new Map<string, number>();
  const tokensOf = (k: string) => [...new Set(k.split(/[\s\-/]+/).filter((t) => t.length > 2 && !STOPWORDS.has(t) && !/^\d+$/.test(t)))];
  for (const r of rows) for (const t of tokensOf(r.keyword)) tokenWeight.set(t, (tokenWeight.get(t) ?? 0) + Math.log10((r.volume ?? 0) + 10));
  const heads = [...tokenWeight.entries()]
    .filter(([t]) => !brandTerms.includes(t))
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxClusters)
    .map(([t]) => t);
  const groups = new Map<string, KeywordMetric[]>();
  for (const r of rows) {
    const toks = tokensOf(r.keyword);
    const isBrand = brandTerms.some((b) => r.keyword.includes(b));
    const head = isBrand ? "__brand" : (heads.find((h) => toks.includes(h)) ?? "__other");
    if (!groups.has(head)) groups.set(head, []);
    groups.get(head)!.push(r);
  }
  return [...groups.entries()].map(([head, list]) => ({
    name: head === "__brand" ? "Brand searches" : head === "__other" ? "Other" : head.charAt(0).toUpperCase() + head.slice(1),
    rows: list,
  }));
}

const clusterSchema = z.object({
  clusters: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      keywordIds: z.array(z.number().int()),
    }),
  ),
});

const estimatedSchema = z.object({
  clusters: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      intent: z.enum(["informational", "commercial", "transactional", "navigational", "mixed"]),
      keywords: z.array(z.object({ keyword: z.string(), monthlyVolume: z.number() })),
    }),
  ),
});

/**
 * Interest analysis: clusters the queries people search around the brand and its categories.
 * DataForSEO (keyword ideas + suggestions) when configured, clustered by the LLM (or a heuristic
 * when no LLM is available). Without DataForSEO the LLM estimates clusters & volumes ("estimated").
 */
export async function analyzeInterest(projectId: string, userId: string | null, progress: Progress): Promise<{ data: InterestData; summary: string }> {
  const p = await getProjectRow(projectId);
  const profile = await getBrandProfile(projectId);
  const [dfs, providers] = await Promise.all([isDataForSeoConfigured(), availableLlmProviders()]);
  const hasLlm = providers.length > 0;
  if (!dfs && !hasLlm)
    throw new Error("Interest analysis needs DataForSEO (Admin → Data Providers) or an AI provider (Admin → AI Providers / Local Agents).");
  const brandTerms = [profile.name, ...profile.aliases].map((b) => b.toLowerCase()).filter((b) => b.length > 2);
  const countryName = getCountry(p.country)?.name ?? p.country;

  await progress({ step: "seeds", message: "Collecting seed terms" });
  const seeds = await seedTerms(projectId, hasLlm);

  if (dfs) {
    await progress({ step: "keywords", message: `Fetching keyword ideas for ${seeds.length} seed terms` });
    const ctx = { projectId, workspaceId: p.workspaceId, userId, feature: "brand_knowledge_interest" };
    const categorySeeds = seeds.filter((s) => !brandTerms.includes(s));
    const [ideas, brand] = await Promise.all([
      fetchKeywordIdeas(categorySeeds.length ? categorySeeds.slice(0, 15) : [profile.name], p.country, p.language, 600, ctx).catch(
        (err) => {
          console.error("[interest] keyword ideas failed", err);
          return [] as KeywordMetric[];
        },
      ),
      fetchKeywordSuggestions(profile.name, p.country, p.language, 150, ctx).catch(() => [] as KeywordMetric[]),
    ]);
    const all = new Map<string, KeywordMetric>();
    for (const r of [...brand, ...ideas]) if (!all.has(r.keyword)) all.set(r.keyword, r);
    const rows = [...all.values()].filter((r) => (r.volume ?? 0) > 0).sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
    if (!rows.length) throw new Error("DataForSEO returned no keywords with search volume for the seed terms. Add product categories in the Profile tab and retry.");

    let groups: { name: string; description?: string; rows: KeywordMetric[] }[];
    if (hasLlm) {
      await progress({ step: "cluster", message: `Clustering ${Math.min(rows.length, 350)} queries into topics` });
      const top = rows.slice(0, 350);
      try {
        const res = await runLlm({
          purpose: "brand_knowledge_interest_clusters",
          timeoutMs: 20 * 60_000,
          projectId,
          workspaceId: p.workspaceId,
          userId,
          prompt: `${await brandBriefing(projectId)}\n\nGroup these search queries (id: query — monthly volume) into 8–15 topic clusters that describe what people are interested in around this brand and its category. Name clusters in ${languageName(p.language)} (2–4 words), add a one-sentence description. Every id must appear in exactly one cluster; put the brand's own navigational queries into one cluster named after the brand.\n\n${top
            .map((r, i) => `${i}: ${r.keyword} — ${r.volume ?? 0}`)
            .join("\n")}`,
          schema: clusterSchema,
          maxTokens: 12000,
        });
        const used = new Set<number>();
        groups = res.data.clusters
          .map((c) => ({
            name: c.name,
            description: c.description,
            rows: c.keywordIds.filter((id) => id >= 0 && id < top.length && !used.has(id) && (used.add(id), true)).map((id) => top[id]!),
          }))
          .filter((g) => g.rows.length);
        const rest = top.filter((_, i) => !used.has(i));
        if (rest.length) groups.push({ name: "Other", description: undefined, rows: rest });
      } catch (err) {
        console.error("[interest] LLM clustering failed, falling back to heuristic", err);
        groups = heuristicClusters(rows.slice(0, 500), brandTerms);
      }
    } else {
      await progress({ step: "cluster", message: "Clustering queries by shared terms" });
      groups = heuristicClusters(rows.slice(0, 500), brandTerms);
    }
    const clusters = groups.map((g) => buildCluster(g.name, g.description, g.rows, brandTerms)).sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
    const totalVolume = clusters.reduce((a, c) => a + (c.volume ?? 0), 0);
    return {
      data: {
        clusters,
        seeds,
        volumeSource: "dataforseo",
        totalKeywords: rows.length,
        totalVolume,
        country: p.country,
        language: p.language,
        generatedAt: new Date().toISOString(),
      },
      summary: `${clusters.length} interest clusters from ${rows.length.toLocaleString("en-US")} real search queries (${totalVolume.toLocaleString("en-US")} monthly searches in ${countryName}).`,
    };
  }

  await progress({ step: "estimate", message: "Estimating interest clusters with AI (DataForSEO not configured)" });
  const res = await runLlm({
    purpose: "brand_knowledge_interest_estimate",
    timeoutMs: 20 * 60_000,
    projectId,
    workspaceId: p.workspaceId,
    userId,
    webSearch: true,
    prompt: `${await brandBriefing(projectId)}\nSeed terms: ${seeds.join(", ")}\n\nIdentify 8–12 clusters of search queries people in ${countryName} use around this brand and its product category. For each cluster give a name (${languageName(p.language)}, 2–4 words), a one-sentence description, the dominant search intent and 5–10 realistic example queries in ${languageName(p.language)} with your best estimate of monthly Google searches. Estimates must be conservative and realistic.`,
    schema: estimatedSchema,
    maxTokens: 8000,
  });
  const clusters: InterestCluster[] = res.data.clusters
    .map((c) => {
      const rows: KeywordMetric[] = c.keywords.map((k) => ({
        keyword: normalizeKeyword(k.keyword),
        volume: Math.max(0, Math.round(k.monthlyVolume)),
        cpc: null,
        difficulty: null,
        intent: c.intent === "mixed" ? null : c.intent,
        monthly: [],
      }));
      const cl = buildCluster(c.name, c.description, rows, brandTerms);
      return { ...cl, intent: c.intent };
    })
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
  const totalVolume = clusters.reduce((a, c) => a + (c.volume ?? 0), 0);
  return {
    data: {
      clusters,
      seeds,
      volumeSource: "estimated",
      totalKeywords: clusters.reduce((a, c) => a + c.keywords.length, 0),
      totalVolume,
      country: p.country,
      language: p.language,
      generatedAt: new Date().toISOString(),
    },
    summary: `${clusters.length} interest clusters estimated by AI (connect DataForSEO for real search volumes).`,
  };
}
