import "server-only";
import { z } from "zod";
import { runLlm } from "@/server/ai/llm";
import { getEngine } from "@/lib/engines";
import { getCountry } from "@/lib/countries";

/** Structured extraction from one AI answer (sentiment, statements, picks, products, other brands). */
export const answerAnalysisSchema = z.object({
  brands: z
    .array(
      z.object({
        name: z.string().describe("Tracked brand name exactly as given in the tracked list"),
        sentiment: z.number().describe("0 = very negative, 50 = neutral, 100 = very positive portrayal in this answer"),
        recommended: z.boolean().describe("true when the answer recommends it or names it as a (top) pick"),
      }),
    )
    .describe("Every TRACKED brand that is named in the answer"),
  statements: z
    .array(
      z.object({
        brand: z.string(),
        polarity: z.enum(["praise", "neutral", "criticism"]),
        theme: z.string().describe('Broad aspect group in English, e.g. "Price & Value", "Quality & Durability", "Customer Service", "Features", "Ease of Use"'),
        attribute: z.string().describe("Specific aspect in English, 1-4 words, e.g. \"Battery capacity\""),
        quote: z.string().describe("Verbatim fragment of the answer (max ~200 chars) that expresses the statement"),
        severity: z.number().describe("0-100: how strong the praise/criticism is"),
      }),
    )
    .describe("Praise / criticism statements the answer makes about brands (tracked or not)"),
  bestFor: z
    .array(z.object({ label: z.string().describe('Situation, e.g. "Best for beginners", "Best budget option", "Top pick"'), brand: z.string() }))
    .describe('"Best for …" picks made by the answer'),
  headToHead: z
    .array(
      z.object({
        claim: z.string().describe("Short summary of the comparison claim"),
        brand: z.string(),
        opponent: z.string(),
        winner: z.enum(["brand", "opponent", "tie"]),
      }),
    )
    .describe("Direct comparisons between two brands and who the answer favours"),
  products: z
    .array(
      z.object({
        name: z.string().describe("Product / model name as written"),
        brand: z.string().nullable(),
        category: z.string().nullable().describe("Product category in English"),
        attributes: z.array(z.object({ key: z.string(), value: z.string() })).describe("Key facts (price, capacity, …)"),
      }),
    )
    .describe("Specific products or models named in the answer"),
  otherBrands: z
    .array(
      z.object({
        name: z.string().describe("Spelling as in the answer"),
        domain: z.string().nullable(),
        sentiment: z.number(),
        recommended: z.boolean(),
      }),
    )
    .describe("Other brands/companies presented as options in the answer that are NOT in the tracked list (exclude generic retailers unless recommended as a brand)"),
});

export type AnswerAnalysis = z.infer<typeof answerAnalysisSchema>;

const MAX_TEXT = 14_000;

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(Number.isFinite(n) ? n : 50)));

export async function runAnswerAnalysis(input: {
  projectId: string;
  workspaceId: string;
  prompt: string;
  engine: string;
  country: string;
  language: string;
  text: string;
  own: { name: string; aliases: string[] };
  competitors: { name: string; aliases: string[] }[];
}): Promise<{ data: AnswerAnalysis; provider: string; model: string }> {
  const engineName = getEngine(input.engine)?.name ?? input.engine;
  const market = getCountry(input.country)?.name ?? input.country;
  const tracked = [
    `- ${input.own.name} (the client brand${input.own.aliases.length ? `; also written as: ${input.own.aliases.join(", ")}` : ""})`,
    ...input.competitors.map((c) => `- ${c.name}${c.aliases.length ? ` (also written as: ${c.aliases.join(", ")})` : ""}`),
  ].join("\n");
  const text = input.text.length > MAX_TEXT ? `${input.text.slice(0, MAX_TEXT)}\n[…truncated]` : input.text;
  const prompt = `A user in ${market} (language: ${input.language}) asked ${engineName}:
"${input.prompt}"

Tracked brands (use exactly these names in "brands"):
${tracked}

The answer (markdown) between the markers:
<<<ANSWER
${text}
ANSWER>>>

Analyze only what this answer says — do not add outside knowledge.
1. brands: each TRACKED brand that is named in the answer, with the sentiment of how the answer portrays it and whether it is recommended.
2. statements: praise, neutral or criticism statements about any brand, with theme/attribute labels in English and a verbatim quote.
3. bestFor: "best for …" picks (situation label + brand).
4. headToHead: direct comparisons between two brands and who wins.
5. products: specific products/models named.
6. otherBrands: brands/companies presented as options that are not in the tracked list.
Return empty arrays when nothing applies.`;

  const res = await runLlm({
    purpose: "ai_answer_analysis",
    system: "You are a precise analyst extracting brand-visibility facts from AI assistant answers. You never invent facts that are not in the answer.",
    prompt,
    schema: answerAnalysisSchema,
    effort: "low",
    maxTokens: 8000,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
  });
  const d = res.data;
  const data: AnswerAnalysis = {
    brands: d.brands.slice(0, 50).map((b) => ({ ...b, sentiment: clamp(b.sentiment) })),
    statements: d.statements
      .slice(0, 60)
      .filter((s) => s.quote.trim() && s.brand.trim())
      .map((s) => ({ ...s, quote: s.quote.trim().slice(0, 400), severity: clamp(s.severity), theme: s.theme.trim().slice(0, 60), attribute: s.attribute.trim().slice(0, 80) })),
    bestFor: d.bestFor.slice(0, 30).filter((b) => b.label.trim() && b.brand.trim()),
    headToHead: d.headToHead.slice(0, 30).filter((h) => h.brand.trim() && h.opponent.trim()),
    products: d.products.slice(0, 60).filter((p) => p.name.trim()),
    otherBrands: d.otherBrands
      .slice(0, 40)
      .filter((b) => b.name.trim().length >= 2)
      .map((b) => ({ ...b, sentiment: clamp(b.sentiment) })),
  };
  return { data, provider: res.provider, model: res.model };
}
