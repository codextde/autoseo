import "server-only";
import { dfsGet, dfsPost } from "@/server/dataforseo/client";
import { getCountry } from "@/lib/countries";
import type { EngineId } from "@/lib/engines";
import type { AnswerRequest, AnswerResult, ShoppingItem, AdItem } from "./types";
import { EngineUnavailableError } from "./types";
import { CitationCollector, arr, cleanAds, cleanShopping, hostOf, isoCountry, num, obj, str, trimRaw, uniqueStrings } from "./util";

/**
 * DataForSEO answer engines (endpoints verified against docs.dataforseo.com/v3, 2026-09):
 * - LLM Responses  POST /v3/ai_optimization/{chat_gpt|claude|gemini|perplexity}/llm_responses/live
 * - ChatGPT app    POST /v3/ai_optimization/chat_gpt/llm_scraper/live/advanced
 * - AI Overview    POST /v3/serp/google/organic/live/advanced  (load_async_ai_overview: true)
 * - AI Mode        POST /v3/serp/google/ai_mode/live/advanced
 * - Copilot        POST /v3/serp/bing/organic/live/advanced     (Bing "ai_overview" = Copilot Search answer)
 */

type LlmSlug = "chat_gpt" | "claude" | "gemini" | "perplexity";

const LLM_SLUG: Partial<Record<EngineId, LlmSlug>> = {
  chatgpt: "chat_gpt",
  claude: "claude",
  gemini: "gemini",
  perplexity: "perplexity",
};

/** Preferred model families per platform (first regex with matches wins; highest version picked). */
const MODEL_PREFS: Record<LlmSlug, RegExp[]> = {
  chat_gpt: [/^gpt-5(\.\d+)?$/, /^gpt-5/, /^gpt-4o$/, /^gpt-4o/],
  claude: [/^claude-sonnet-\d/, /sonnet/, /^claude-opus/],
  gemini: [/^gemini-[\d.]+-flash$/, /flash/, /pro/],
  perplexity: [/^sonar$/, /^sonar-pro$/, /sonar/],
};

const FALLBACK_MODEL: Record<LlmSlug, string> = {
  chat_gpt: "gpt-5",
  claude: "claude-sonnet-4-5",
  gemini: "gemini-2.5-flash",
  perplexity: "sonar",
};

/** `web_search_country_iso_code` values DataForSEO accepts for Claude. */
const CLAUDE_SEARCH_COUNTRIES = new Set(
  "AR AT AU BE BR CA CH CL CN DE DK ES FI FR GB HK ID IN IT JP KR MX MY NL NO NZ PH PL PT RU SA SE TR TW US ZA".split(" "),
);

type ModelRow = { model_name?: string; reasoning?: boolean; web_search_supported?: boolean };
const modelCache = new Map<LlmSlug, { models: ModelRow[]; at: number }>();

/** Available models (free GET), cached for 24h — invalid model names are billed by DataForSEO. */
async function listModels(slug: LlmSlug): Promise<ModelRow[]> {
  const hit = modelCache.get(slug);
  if (hit && Date.now() - hit.at < 24 * 3600_000) return hit.models;
  try {
    const task = await dfsGet<ModelRow>(`/v3/ai_optimization/${slug}/llm_responses/models`, { feature: "ai_tracking" });
    const models = (task.result ?? []).filter((m) => typeof m.model_name === "string");
    modelCache.set(slug, { models, at: Date.now() });
    return models;
  } catch {
    return [];
  }
}

async function pickModel(slug: LlmSlug, override: string | undefined): Promise<string> {
  const models = await listModels(slug);
  const names = models.filter((m) => slug === "perplexity" || m.web_search_supported !== false).map((m) => m.model_name!);
  if (override) {
    if (!models.length || names.includes(override) || models.some((m) => m.model_name === override)) return override;
    throw new EngineUnavailableError(`DataForSEO does not offer the model "${override}" for ${slug}. Fix it in Admin → AI Providers.`, "unsupported");
  }
  for (const re of MODEL_PREFS[slug]) {
    const matches = names.filter((n) => re.test(n)).sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
    if (matches[0]) return matches[0];
  }
  return names[0] ?? FALLBACK_MODEL[slug];
}

function dfsCtx(req: AnswerRequest) {
  return { feature: "ai_tracking", projectId: req.project.id, workspaceId: req.project.workspaceId, userId: req.userId ?? null };
}

function locationCode(country: string): number {
  const c = getCountry(country);
  if (!c) throw new EngineUnavailableError(`Unknown market "${country}".`, "unsupported");
  return c.locationCode;
}

/* ───────────────────────────── LLM Responses ───────────────────────────── */

async function llmResponses(req: AnswerRequest, slug: LlmSlug, override?: string): Promise<AnswerResult> {
  const model = await pickModel(slug, override);
  const prompt = req.prompt.length > 500 ? req.prompt.slice(0, 500) : req.prompt;
  const body: Record<string, unknown> = {
    user_prompt: prompt,
    model_name: model,
    max_output_tokens: 4096,
  };
  if (slug !== "perplexity") body.web_search = true;
  // Gemini has no country field; Claude accepts only a fixed list (sent when supported); the system
  // message localises the answer in every case where the country can't be passed.
  const iso = isoCountry(req.country);
  if (slug === "chat_gpt" || slug === "perplexity" || (slug === "claude" && CLAUDE_SEARCH_COUNTRIES.has(iso))) {
    body.web_search_country_iso_code = iso;
  }
  if (slug === "claude" || slug === "gemini") {
    const market = getCountry(req.country)?.name ?? req.country;
    body.system_message = `The user is located in ${market}. Answer in the language of the question.`.slice(0, 500);
  }

  const task = await dfsPost<Record<string, unknown>>(`/v3/ai_optimization/${slug}/llm_responses/live`, [body], dfsCtx(req), {
    timeoutMs: 150_000,
    estimatedCostUsd: 0.03,
  });
  const result = obj(task.result?.[0]);
  const cites = new CitationCollector();
  const parts: string[] = [];
  for (const item of arr(result.items)) {
    const it = obj(item);
    if (it.type !== "message") continue;
    for (const section of arr(it.sections)) {
      const s = obj(section);
      const text = str(s.text);
      if (text) parts.push(text);
      for (const a of arr(s.annotations)) {
        const an = obj(a);
        cites.add(str(an.direct_url) ?? an.url, an.title);
      }
    }
  }
  const text = parts.join("\n\n").trim();
  if (!text) throw new EngineUnavailableError("The engine returned an empty answer.", "no_answer");
  return {
    text,
    citations: cites.list,
    fanouts: uniqueStrings(arr(result.fan_out_queries)),
    shopping: [],
    ads: [],
    model: str(result.model_name) ?? model,
    provider: "dataforseo",
    costUsd: Number(task.cost ?? 0),
    raw: trimRaw({
      endpoint: `ai_optimization/${slug}/llm_responses`,
      model_name: result.model_name,
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
      web_search: result.web_search,
      money_spent: result.money_spent,
    }),
  };
}

/* ───────────────────────────── ChatGPT app scraper ───────────────────────────── */

function ratingOf(v: unknown): { value: number | null; votes: number | null } {
  const r = obj(v);
  return { value: num(r.value), votes: num(r.votes_count) };
}

async function chatgptScraper(req: AnswerRequest): Promise<AnswerResult> {
  const task = await dfsPost<Record<string, unknown>>(
    "/v3/ai_optimization/chat_gpt/llm_scraper/live/advanced",
    [
      {
        keyword: req.prompt.slice(0, 2000),
        location_code: locationCode(req.country),
        language_code: req.language,
        force_web_search: true,
      },
    ],
    dfsCtx(req),
    { timeoutMs: 150_000, estimatedCostUsd: 0.004 },
  );
  const result = obj(task.result?.[0]);
  const cites = new CitationCollector();
  for (const s of arr(result.sources)) {
    const src = obj(s);
    cites.add(src.url, src.title);
  }
  const shopping: ShoppingItem[] = [];
  const ads: AdItem[] = [];
  const textParts: string[] = [];
  for (const item of arr(result.items)) {
    const it = obj(item);
    const type = str(it.type);
    if (type === "chat_gpt_text" || type === "chat_gpt_table") {
      const md = str(it.markdown);
      if (md) textParts.push(md);
      for (const s of arr(it.sources)) {
        const src = obj(s);
        cites.add(src.url, src.title);
      }
    } else if (type === "chat_gpt_navigation_list") {
      for (const s of arr(it.sources)) {
        const src = obj(s);
        cites.add(src.url, src.title);
      }
    } else if (type === "chat_gpt_products") {
      for (const p of arr(it.items)) {
        const pr = obj(p);
        const rating = ratingOf(pr.rating);
        const url = str(pr.url);
        shopping.push({
          name: str(pr.title) ?? "",
          brand: null,
          price: num(pr.price),
          currency: str(pr.currency),
          rating: rating.value,
          reviews: rating.votes,
          store: str(pr.merchants),
          storeDomain: str(pr.domain) ?? hostOf(url),
          url,
          imageUrl: str(arr(pr.images)[0]),
          position: shopping.length + 1,
        });
      }
    } else if (type === "chat_gpt_ad") {
      const adv = obj(it.advertiser);
      const url = str(it.url);
      ads.push({
        advertiser: str(adv.name) ?? str(it.domain) ?? hostOf(url) ?? "Unknown",
        advertiserDomain: str(it.domain) ?? hostOf(str(adv.url)) ?? hostOf(url),
        headline: str(it.title) ?? "",
        description: str(it.snippet),
        imageUrl: str(it.image_url),
        landingUrl: url,
        position: num(it.rank_group),
      });
    }
  }
  const text = (str(result.markdown) ?? textParts.join("\n\n")).trim();
  if (!text) throw new EngineUnavailableError("ChatGPT returned an empty answer.", "no_answer");
  return {
    text,
    citations: cites.list,
    fanouts: uniqueStrings(arr(result.fan_out_queries)),
    shopping: cleanShopping(shopping),
    ads: cleanAds(ads),
    model: str(result.model) ?? "chatgpt-app",
    provider: "dataforseo",
    costUsd: Number(task.cost ?? 0),
    raw: trimRaw({
      endpoint: "ai_optimization/chat_gpt/llm_scraper",
      model: result.model,
      check_url: result.check_url,
      item_types: result.item_types,
      brand_entities: arr(result.brand_entities).slice(0, 30),
      search_results: arr(result.search_results)
        .slice(0, 30)
        .map((r) => {
          const o = obj(r);
          return { url: o.url, title: o.title, domain: o.domain };
        }),
    }),
  };
}

/* ───────────────────────────── Google / Bing SERP AI answers ───────────────────────────── */

function priceOf(v: unknown): { current: number | null; regular: number | null; currency: string | null } {
  const p = obj(v);
  return { current: num(p.current), regular: num(p.regular), currency: str(p.currency) };
}

/** Parses an `ai_overview` item (Google organic, AI Mode, Bing). */
function parseAiOverview(ov: Record<string, unknown>, cites: CitationCollector, shopping: ShoppingItem[], ads: AdItem[]): string {
  const parts: string[] = [];
  for (const el of arr(ov.items)) {
    const e = obj(el);
    const type = str(e.type);
    if (type === "ai_overview_shopping") {
      for (const p of arr(e.items)) {
        const pr = obj(p);
        const price = priceOf(pr.price);
        const rating = ratingOf(pr.rating);
        const url = str(pr.url);
        shopping.push({
          name: str(pr.title) ?? "",
          price: price.current,
          oldPrice: price.regular && price.current && price.regular > price.current ? price.regular : null,
          currency: price.currency,
          rating: rating.value,
          reviews: rating.votes,
          store: str(pr.seller) ?? str(pr.marketplace),
          storeDomain: str(pr.domain) ?? hostOf(str(pr.marketplace_url)) ?? hostOf(url),
          url,
          imageUrl: str(pr.image_url),
          position: shopping.length + 1,
        });
      }
    } else if (type === "ai_overview_paid") {
      for (const a of arr(e.items)) {
        const ad = obj(a);
        const url = str(ad.url);
        ads.push({
          advertiser: str(ad.website_name) ?? str(ad.domain) ?? hostOf(url) ?? "Unknown",
          advertiserDomain: str(ad.domain) ?? hostOf(url),
          headline: str(ad.title) ?? "",
          description: str(ad.snippet),
          imageUrl: str(arr(ad.images).map((i) => obj(i).url)[0]),
          landingUrl: url,
          position: ads.length + 1,
        });
      }
    }
    for (const r of arr(e.references)) {
      const ref = obj(r);
      cites.add(ref.url, ref.title);
    }
    for (const l of arr(e.links)) {
      const link = obj(l);
      cites.add(link.url, link.title);
    }
    for (const c of arr(e.components)) {
      for (const r of arr(obj(c).references)) {
        const ref = obj(r);
        cites.add(ref.url, ref.title);
      }
    }
    if (type !== "ai_overview_shopping" && type !== "ai_overview_paid") {
      const md = str(e.markdown) ?? str(e.text);
      if (md) parts.push(md);
    }
  }
  for (const r of arr(ov.references)) {
    const ref = obj(r);
    cites.add(ref.url, ref.title);
  }
  return (str(ov.markdown) ?? parts.join("\n\n")).trim();
}

function parseSerpExtras(items: unknown[], shopping: ShoppingItem[], ads: AdItem[]) {
  for (const item of items) {
    const it = obj(item);
    const type = str(it.type);
    if (type === "paid") {
      const url = str(it.url);
      ads.push({
        advertiser: str(it.website_name) ?? str(it.domain) ?? hostOf(url) ?? "Unknown",
        advertiserDomain: str(it.domain) ?? hostOf(url),
        headline: str(it.title) ?? "",
        description: str(it.description),
        landingUrl: url,
        position: num(it.rank_group),
        rating: ratingOf(it.rating).value,
      });
    } else if (type === "shopping" || type === "popular_products" || type === "commercial_units") {
      for (const p of arr(it.items)) {
        const pr = obj(p);
        const price = priceOf(pr.price);
        const rating = ratingOf(pr.rating);
        const url = str(pr.url);
        shopping.push({
          name: str(pr.title) ?? "",
          price: price.current,
          oldPrice: price.regular && price.current && price.regular > price.current ? price.regular : null,
          currency: price.currency,
          rating: rating.value,
          reviews: rating.votes,
          store: str(pr.seller) ?? str(pr.source) ?? str(pr.marketplace),
          storeDomain: str(pr.domain) ?? hostOf(str(pr.marketplace_url)) ?? hostOf(url),
          url,
          imageUrl: str(pr.image_url),
          position: shopping.length + 1,
        });
      }
    }
  }
}

async function serpAi(req: AnswerRequest, kind: "ai_overview" | "ai_mode" | "copilot"): Promise<AnswerResult> {
  const path =
    kind === "ai_overview"
      ? "/v3/serp/google/organic/live/advanced"
      : kind === "ai_mode"
        ? "/v3/serp/google/ai_mode/live/advanced"
        : "/v3/serp/bing/organic/live/advanced";
  const body: Record<string, unknown> = {
    keyword: req.prompt.slice(0, 700),
    location_code: locationCode(req.country),
    language_code: req.language,
    device: "desktop",
  };
  if (kind === "ai_overview") {
    body.load_async_ai_overview = true;
    body.depth = 10;
  }
  if (kind === "copilot") body.depth = 10;
  const task = await dfsPost<Record<string, unknown>>(path, [body], dfsCtx(req), { timeoutMs: 150_000, estimatedCostUsd: 0.006 });
  const result = obj(task.result?.[0]);
  const items = arr(result.items);
  const cites = new CitationCollector();
  const shopping: ShoppingItem[] = [];
  const ads: AdItem[] = [];
  let text = "";
  for (const item of items) {
    const it = obj(item);
    if (it.type === "ai_overview") {
      const t = parseAiOverview(it, cites, shopping, ads);
      if (t) text = text ? `${text}\n\n${t}` : t;
    }
  }
  if (kind !== "ai_mode") parseSerpExtras(items, shopping, ads);
  const related = items
    .map(obj)
    .filter((i) => i.type === "related_searches")
    .flatMap((i) => arr(i.items));
  const engineLabel = kind === "ai_overview" ? "google/organic" : kind === "ai_mode" ? "google/ai_mode" : "bing/organic";
  return {
    // An empty text means the SERP showed no AI answer for this query (brand not visible).
    text,
    citations: cites.list,
    fanouts: [],
    shopping: cleanShopping(shopping),
    ads: cleanAds(ads),
    model: kind === "ai_overview" ? "google-ai-overview" : kind === "ai_mode" ? "google-ai-mode" : "bing-copilot",
    provider: "dataforseo",
    costUsd: Number(task.cost ?? 0),
    raw: trimRaw({
      endpoint: `serp/${engineLabel}`,
      check_url: result.check_url,
      item_types: result.item_types,
      noAiAnswer: !text,
      relatedSearches: uniqueStrings(related, 12),
    }),
  };
}

/* ───────────────────────────── Dispatcher ───────────────────────────── */

export async function answerViaDataForSeo(req: AnswerRequest, modelOverride?: string): Promise<AnswerResult> {
  switch (req.engine) {
    case "chatgpt":
    case "claude":
    case "gemini":
    case "perplexity":
      return llmResponses(req, LLM_SLUG[req.engine]!, modelOverride || undefined);
    case "chatgpt_gui":
      return chatgptScraper(req);
    case "ai_overview":
      return serpAi(req, "ai_overview");
    case "google_ai_mode":
      return serpAi(req, "ai_mode");
    case "copilot":
      return serpAi(req, "copilot");
    default:
      throw new EngineUnavailableError(`DataForSEO cannot answer ${req.engine}.`, "unsupported");
  }
}
