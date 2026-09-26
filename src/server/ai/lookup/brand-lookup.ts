import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { aiLookups, projects } from "@/server/db/schema";
import { dfsPost } from "@/server/dataforseo/client";
import type { BrandLookupParams, BrandLookupResult, LookupPlatform } from "@/features/ai-research/types";

export const BRAND_LOOKUP_JOB = "ai_research.brand_lookup";

/** Raw DataForSEO cost estimate (LLM Mentions: $0.10 per request + $0.001 per row). */
export const LOOKUP_COST = { base: 0.85, competitors: 0.2 };

const PLATFORMS: LookupPlatform[] = ["chat_gpt", "google"];

export type LookupTarget = { type: "domain" | "keyword"; value: string };

export function detectTarget(raw: string): LookupTarget {
  const trimmed = raw.trim();
  if (!/\s/.test(trimmed) && trimmed.includes(".")) {
    try {
      const host = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname.replace(/^www\./, "").toLowerCase();
      if (host.includes(".") && /^[a-z0-9.-]+$/.test(host)) return { type: "domain", value: host };
    } catch {
      // fall through to keyword
    }
  }
  return { type: "keyword", value: trimmed };
}

function llmTarget(t: LookupTarget, scope: "domain" | "subdomains") {
  return t.type === "domain"
    ? { domain: t.value.slice(0, 63), include_subdomains: scope === "subdomains", search_filter: "include", search_scope: ["any"] }
    : { keyword: t.value.slice(0, 250), search_filter: "include", search_scope: ["any", "brand_entities"], match_type: "word_match" };
}

type GroupElement = { key?: string; mentions?: number | null; ai_search_volume?: number | null };
type AggregatedResult = { total?: { platform?: GroupElement[] } };
type TopPagesResult = { items?: { key?: string; platform?: GroupElement[] }[] | null };
type MentionItem = {
  platform?: string;
  question?: string | null;
  sources?: { url?: string; domain?: string; title?: string | null }[] | null;
  ai_search_volume?: number | null;
  monthly_searches?: { year: number; month: number; search_volume: number | null }[] | null;
  first_response_at?: string | null;
  last_response_at?: string | null;
  brand_entities?: { title?: string | null }[] | null;
};
type SearchResult = { items?: MentionItem[] | null };
type CrossResult = { items?: { key?: string; platform?: GroupElement[] }[] | null };

function httpUrl(u: unknown): string | null {
  if (typeof u !== "string" || u.length > 2048) return null;
  try {
    const url = new URL(u);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function hostOf(u: string) {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function market(platform: LookupPlatform, params: BrandLookupParams) {
  // DataForSEO only has US/English ChatGPT mention data.
  return platform === "chat_gpt" ? { location_code: 2840, language_code: "en" } : { location_code: params.locationCode, language_code: params.languageCode };
}

export async function runBrandLookup(lookupId: string) {
  const [row] = await db.select().from(aiLookups).where(eq(aiLookups.id, lookupId)).limit(1);
  if (!row || row.kind !== "brand_lookup") return { skipped: "lookup not found" };
  const [project] = await db.select().from(projects).where(eq(projects.id, row.projectId)).limit(1);
  if (!project) return { skipped: "project deleted" };
  await db.update(aiLookups).set({ status: "running" }).where(eq(aiLookups.id, lookupId));
  const params = row.params as unknown as BrandLookupParams;
  const ctx = { projectId: row.projectId, workspaceId: project.workspaceId, userId: row.createdBy, feature: "ai_brand_lookup" };
  let cost = 0;
  const call = async <T>(path: string, body: Record<string, unknown>): Promise<T | null> => {
    const task = await dfsPost<T>(path, [body], ctx, { estimatedCostUsd: 0.2 });
    cost += Number(task.cost ?? 0);
    return task.result?.[0] ?? null;
  };

  try {
    const target = detectTarget(params.query);
    const lt = llmTarget(target, params.scope);
    const chatGptInScope = params.locationCode === 2840 && params.languageCode === "en";

    const perPlatform: BrandLookupResult["perPlatform"] = [];
    const topPages: BrandLookupResult["topPages"] = [];
    const queries: BrandLookupResult["topQueries"] = [];
    const monthly = new Map<string, number>();
    let anyMentionItems = false;

    for (const platform of PLATFORMS) {
      const m = market(platform, params);
      const [agg, pages, search] = await Promise.allSettled([
        call<AggregatedResult>("/v3/ai_optimization/llm_mentions/aggregated_metrics/live", { target: [lt], platform, ...m, internal_list_limit: 20 }),
        call<TopPagesResult>("/v3/ai_optimization/llm_mentions/top_pages/live", {
          target: [lt],
          platform,
          ...m,
          links_scope: "sources",
          items_list_limit: 10,
          internal_list_limit: 5,
        }),
        call<SearchResult>("/v3/ai_optimization/llm_mentions/search/live", { target: [lt], platform, ...m, limit: 100 }),
      ]);
      for (const r of [agg, pages, search]) {
        if (r.status === "rejected" && /40[12]|insufficient|credentials/i.test(String(r.reason?.message ?? r.reason))) throw r.reason;
      }
      if (agg.status === "rejected" && pages.status === "rejected" && search.status === "rejected") {
        perPlatform.push({ platform, status: "error", mentions: null, aiSearchVolume: null, error: String(agg.reason?.message ?? agg.reason).slice(0, 300) });
        continue;
      }
      const group = agg.status === "fulfilled" ? agg.value?.total?.platform?.find((g) => g.key === platform) : undefined;
      perPlatform.push({
        platform,
        status: "ok",
        mentions: group?.mentions != null ? Math.round(group.mentions) : agg.status === "fulfilled" ? 0 : null,
        aiSearchVolume: group?.ai_search_volume != null ? Math.round(group.ai_search_volume) : agg.status === "fulfilled" ? 0 : null,
        locationNote: platform === "chat_gpt" && !chatGptInScope ? "ChatGPT data is only available for the US (English)." : undefined,
      });

      const mentionItems = search.status === "fulfilled" ? (search.value?.items ?? []) : [];
      if (mentionItems.length) anyMentionItems = true;
      for (const it of mentionItems) {
        for (const ms of it.monthly_searches ?? []) {
          if (!ms?.year || !ms.month) continue;
          const k = `${ms.year}-${String(ms.month).padStart(2, "0")}`;
          monthly.set(k, (monthly.get(k) ?? 0) + (ms.search_volume ?? 0));
        }
      }
      // Cited sources
      const platformPages: BrandLookupResult["topPages"] = [];
      for (const item of pages.status === "fulfilled" ? (pages.value?.items ?? []) : []) {
        const url = httpUrl(item.key);
        if (!url) continue;
        const g = item.platform?.find((x) => x.key === platform) ?? item.platform?.[0];
        const prompts = mentionItems
          .filter((mi) => mi.question && (mi.sources ?? []).some((s) => s.url === url))
          .sort((a, b) => (b.ai_search_volume ?? 0) - (a.ai_search_volume ?? 0))
          .slice(0, 50)
          .map((mi) => mi.question!.slice(0, 500));
        const domain = hostOf(url);
        platformPages.push({
          url,
          domain,
          platform,
          mentions: g?.mentions ?? null,
          capturedVolume: g?.ai_search_volume ?? null,
          prompts,
          isTarget: target.type === "domain" && (domain === target.value || domain.endsWith(`.${target.value}`)),
        });
      }
      topPages.push(...platformPages.slice(0, 10));
      // Queries
      const platformQueries = mentionItems
        .filter((mi) => mi.question?.trim())
        .sort((a, b) => (b.ai_search_volume ?? 0) - (a.ai_search_volume ?? 0))
        .slice(0, 25)
        .map((mi) => ({
          question: mi.question!.trim().slice(0, 500),
          platform,
          aiSearchVolume: mi.ai_search_volume ?? null,
          firstSeenAt: mi.first_response_at ?? null,
          lastSeenAt: mi.last_response_at ?? null,
          citedSources: (mi.sources ?? [])
            .map((s) => ({ url: httpUrl(s.url), domain: s.domain ?? "", title: s.title?.slice(0, 300) ?? null }))
            .filter((s): s is { url: string; domain: string; title: string | null } => !!s.url)
            .slice(0, 10),
          brandsMentioned: [...new Set((mi.brand_entities ?? []).map((b) => b.title?.trim()).filter((t): t is string => !!t))].slice(0, 20),
        }));
      queries.push(...platformQueries);
    }

    // Share of voice
    let shareOfVoice: BrandLookupResult["shareOfVoice"] = null;
    const seen = new Set<string>([target.value.toLowerCase()]);
    const comps = params.competitors
      .map((c) => detectTarget(c))
      .filter((c) => c.value && !seen.has(c.value.toLowerCase()) && (seen.add(c.value.toLowerCase()), true))
      .slice(0, 5);
    if (comps.length) {
      const groups = [{ key: target.value, t: target }, ...comps.map((c) => ({ key: c.value, t: c }))];
      const totals = new Map<string, number | null>(groups.map((g) => [g.key, null]));
      const okPlatforms: LookupPlatform[] = [];
      for (const platform of PLATFORMS) {
        if (platform === "chat_gpt" && !chatGptInScope) continue;
        try {
          const res = await call<CrossResult>("/v3/ai_optimization/llm_mentions/cross_aggregated_metrics/live", {
            targets: groups.map((g) => ({ aggregation_key: g.key.slice(0, 250), target: [llmTarget(g.t, params.scope)] })),
            platform,
            ...market(platform, params),
            internal_list_limit: 5,
          });
          okPlatforms.push(platform);
          for (const item of res?.items ?? []) {
            if (!item.key || !totals.has(item.key)) continue;
            const sum = (item.platform ?? []).reduce((a, g) => a + (g.mentions ?? 0), 0);
            totals.set(item.key, (totals.get(item.key) ?? 0) + sum);
          }
        } catch (err) {
          if (/40[12]|insufficient|credentials/i.test(String((err as Error).message))) throw err;
          console.warn("[brand-lookup] cross aggregated failed", platform, err);
        }
      }
      if (okPlatforms.length) {
        const denom = [...totals.values()].reduce<number>((a, v) => a + (v ?? 0), 0);
        const entries = groups
          .map((g) => {
            const mentions = totals.get(g.key) ?? null;
            return { key: g.key, label: g.key, mentions, sharePct: mentions == null || denom <= 0 ? null : (mentions / denom) * 100, isTarget: g.key === target.value };
          })
          .sort((a, b) => (b.mentions ?? -1) - (a.mentions ?? -1));
        shareOfVoice = { entries, platforms: okPlatforms };
      }
    }

    const counted = perPlatform.filter((p) => p.status === "ok" && (p.platform !== "chat_gpt" || chatGptInScope));
    const sumNullable = (vals: (number | null)[]) => (vals.some((v) => v != null) ? vals.reduce<number>((a, v) => a + (v ?? 0), 0) : null);
    const topQueries = queries.sort((a, b) => (b.aiSearchVolume ?? 0) - (a.aiSearchVolume ?? 0));
    const sortedPages = topPages.sort((a, b) => (b.capturedVolume ?? 0) - (a.capturedVolume ?? 0) || (b.mentions ?? 0) - (a.mentions ?? 0));
    const monthlyVolume = [...monthly.entries()]
      .map(([month, volume]) => ({ month, volume }))
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-12);
    const result: BrandLookupResult = {
      target,
      perPlatform,
      totalMentions: sumNullable(counted.map((p) => p.mentions)),
      totalAiSearchVolume: sumNullable(counted.map((p) => p.aiSearchVolume)),
      topPages: sortedPages,
      topQueries,
      monthlyVolume,
      shareOfVoice,
      hasData:
        perPlatform.some((p) => (p.mentions ?? 0) > 0) || sortedPages.length > 0 || topQueries.length > 0 || monthlyVolume.length > 0 || anyMentionItems || !!shareOfVoice,
      fetchedAt: new Date().toISOString(),
    };
    await db
      .update(aiLookups)
      .set({ status: "done", result: result as unknown as Record<string, unknown>, costUsd: cost, finishedAt: new Date(), error: null })
      .where(and(eq(aiLookups.id, lookupId)));
    return { cost, hasData: result.hasData };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(aiLookups).set({ status: "failed", error: message.slice(0, 1000), costUsd: cost, finishedAt: new Date() }).where(eq(aiLookups.id, lookupId));
    throw err;
  }
}
