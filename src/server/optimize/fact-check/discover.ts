import "server-only";
import * as cheerio from "cheerio";
import { z } from "zod";
import { availableLlmProviders, runLlm } from "@/server/ai/llm";
import { fetchDocumentUrl } from "./documents";

export type AssetCandidate = {
  name: string;
  aliases: string[];
  activeIngredient: string | null;
  source: "structured_data" | "heading" | "ai";
};

const PRODUCT_TYPES = new Set(["product", "drug", "medicalentity", "dietarysupplement", "individualproduct", "productmodel", "softwareapplication", "service"]);

function collectJsonLd(node: unknown, out: AssetCandidate[]) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) collectJsonLd(n, out);
    return;
  }
  const obj = node as Record<string, unknown>;
  const types = ([] as unknown[]).concat(obj["@type"] ?? []).map((t) => String(t).toLowerCase());
  if (types.some((t) => PRODUCT_TYPES.has(t)) && typeof obj.name === "string") {
    const ingredient =
      typeof obj.activeIngredient === "string"
        ? obj.activeIngredient
        : typeof (obj.activeIngredient as { name?: string } | undefined)?.name === "string"
          ? (obj.activeIngredient as { name: string }).name
          : null;
    const aliases = ([] as unknown[])
      .concat(obj.alternateName ?? [], obj.nonProprietaryName ?? [], obj.proprietaryName ?? [])
      .filter((a): a is string => typeof a === "string" && a.trim().length > 0 && a !== obj.name);
    out.push({ name: obj.name.trim(), aliases, activeIngredient: ingredient, source: "structured_data" });
  }
  for (const key of ["@graph", "itemListElement", "item", "hasVariant", "isRelatedTo", "offers", "mainEntity"]) collectJsonLd(obj[key], out);
}

function heuristicCandidates(html: string): AssetCandidate[] {
  const $ = cheerio.load(html);
  const out: AssetCandidate[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      collectJsonLd(JSON.parse($(el).text()), out);
    } catch {
      // ignore invalid JSON-LD
    }
  });
  if (!out.length) {
    const headings = $("h1, h2")
      .map((_, el) => $(el).text().replace(/\s+/g, " ").trim())
      .get()
      .filter((t) => t.length >= 2 && t.length <= 60 && t.split(" ").length <= 6 && !/[?!:]$/.test(t));
    for (const h of headings.slice(0, 12)) out.push({ name: h, aliases: [], activeIngredient: null, source: "heading" });
  }
  return out;
}

function dedupe(list: AssetCandidate[]): AssetCandidate[] {
  const map = new Map<string, AssetCandidate>();
  for (const c of list) {
    const key = c.name.toLowerCase();
    const prev = map.get(key);
    if (!prev) map.set(key, { ...c, aliases: [...new Set(c.aliases)] });
    else {
      prev.aliases = [...new Set([...prev.aliases, ...c.aliases])];
      prev.activeIngredient ??= c.activeIngredient;
    }
  }
  return [...map.values()].slice(0, 30);
}

const aiSchema = z.object({
  assets: z.array(
    z.object({
      name: z.string(),
      aliases: z.array(z.string()),
      activeIngredient: z.string(),
    }),
  ),
});

/** Fetches a page (SSRF-safe) and returns product/asset candidates found on it. */
export async function discoverAssets(url: string, ctx: { projectId: string; userId?: string | null; workspaceId?: string | null }) {
  const page = await fetchDocumentUrl(url);
  const candidates: AssetCandidate[] = page.html ? heuristicCandidates(page.html) : [];
  let usedAi = false;
  let aiError: string | null = null;
  if ((await availableLlmProviders()).length > 0) {
    try {
      const res = await runLlm({
        purpose: "fact_check.discover_assets",
        system:
          "You extract the products (brands, medicines, devices, SKUs or services) a web page is about, for a label-compliance tool. Only list real products named on the page. Use empty string when there is no active ingredient.",
        prompt: `Page: ${page.finalUrl}\nTitle: ${page.title}\n\nPage text (truncated):\n${page.text.slice(0, 14_000)}\n\nList each product once with spelling variants/aliases used on the page and its active ingredient (if it is a medicine).`,
        schema: aiSchema,
        projectId: ctx.projectId,
        workspaceId: ctx.workspaceId ?? null,
        userId: ctx.userId ?? null,
        maxTokens: 2000,
      });
      usedAi = true;
      candidates.unshift(
        ...res.data.assets
          .filter((a) => a.name.trim())
          .map((a) => ({
            name: a.name.trim().slice(0, 120),
            aliases: a.aliases.map((x) => x.trim()).filter(Boolean).slice(0, 10),
            activeIngredient: a.activeIngredient.trim() || null,
            source: "ai" as const,
          })),
      );
    } catch (err) {
      aiError = err instanceof Error ? err.message : String(err);
    }
  }
  return {
    url: page.finalUrl,
    title: page.title,
    kind: page.kind,
    chars: page.text.length,
    usedAi,
    aiError,
    candidates: dedupe(candidates),
  };
}
