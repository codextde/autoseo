import "server-only";
import { z } from "zod";
import { availableLlmProviders, runLlm } from "@/server/ai/llm";
import type { ContentEntity, ContentFaq } from "@/server/db/schema";
import { markdownToText } from "@/server/optimize/markdown";
import { parseBlocks } from "./aeo-score";

/**
 * Editor assistants (FAQ generator, entity extraction, meta writer). Each uses the LLM when a
 * provider is available and falls back to deterministic extraction from the article otherwise.
 */
export type AssistResult<T> = { data: T; by: "ai" | "extract" };

type Ctx = { projectId: string; workspaceId: string; language: string };

async function aiAvailable() {
  return (await availableLlmProviders().catch(() => [])).length > 0;
}

/** Question-style headings + the first paragraph below them. */
export function extractFaqsFromMarkdown(md: string): ContentFaq[] {
  const blocks = parseBlocks(md);
  const out: ContentFaq[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (b.type !== "heading" || b.level < 2 || !b.text.trim().endsWith("?")) continue;
    const next = blocks.slice(i + 1).find((x) => x.type === "paragraph" || x.type === "heading");
    if (next?.type === "paragraph") out.push({ question: b.text.trim(), answer: markdownToText(next.text).slice(0, 600) });
  }
  return out.slice(0, 8);
}

export function extractEntitiesFromMarkdown(md: string): ContentEntity[] {
  const text = markdownToText(md);
  const counts = new Map<string, number>();
  for (const m of text.matchAll(/\b([A-ZÄÖÜ][\p{L}\d&+-]+(?:\s+[A-ZÄÖÜ\d][\p{L}\d&+-]+){0,3})\b/gu)) {
    const name = m[1]!.trim();
    if (name.length < 3 || /^(The|A|An|In|On|For|With|Der|Die|Das|Ein|Eine|This|That|What|How|Why|When|Which|Key)$/.test(name)) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([name, n]) => n >= 2 || name.includes(" "))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([name, n]) => ({ name, type: "Thing", mentions: n }));
}

export async function generateFaqs(input: { title: string; body: string; targetPrompt: string | null }, ctx: Ctx): Promise<AssistResult<ContentFaq[]>> {
  if (await aiAvailable()) {
    const res = await runLlm({
      purpose: "content.faq",
      system: "You write FAQ sections that answer engines quote. Use only facts contained in the article.",
      prompt: `Article "${input.title}"${input.targetPrompt ? ` (target question: ${input.targetPrompt})` : ""}, language ${ctx.language}:\n\n${input.body.slice(0, 24000)}\n\nWrite 5–7 FAQs people would ask next. Each answer 40–80 words, self-contained, specific.`,
      schema: z.object({ faqs: z.array(z.object({ question: z.string(), answer: z.string() })) }),
      effort: "low",
      projectId: ctx.projectId,
      workspaceId: ctx.workspaceId,
    });
    return { data: res.data.faqs.filter((f) => f.question.trim() && f.answer.trim()).slice(0, 8), by: "ai" };
  }
  return { data: extractFaqsFromMarkdown(input.body), by: "extract" };
}

export async function extractEntities(input: { title: string; body: string }, ctx: Ctx): Promise<AssistResult<ContentEntity[]>> {
  if (await aiAvailable()) {
    const res = await runLlm({
      purpose: "content.entities",
      system: "You extract named entities for schema.org markup. Only include entities that appear in the text.",
      prompt: `Extract the 8–15 most important entities from this article (products, brands, organisations, standards, places, concepts). For each: name, schema.org type, and a Wikipedia or Wikidata URL as sameAs only if certain (else empty string).\n\n${input.body.slice(0, 24000)}`,
      schema: z.object({ entities: z.array(z.object({ name: z.string(), type: z.string(), sameAs: z.string() })) }),
      effort: "low",
      projectId: ctx.projectId,
      workspaceId: ctx.workspaceId,
    });
    return {
      data: res.data.entities
        .filter((e) => e.name.trim())
        .map((e) => ({ name: e.name.trim(), type: e.type || "Thing", sameAs: /^https?:\/\//.test(e.sameAs) ? e.sameAs : null })),
      by: "ai",
    };
  }
  return { data: extractEntitiesFromMarkdown(input.body), by: "extract" };
}

export async function generateMeta(
  input: { title: string; body: string; targetKeyword: string | null; targetPrompt: string | null },
  ctx: Ctx,
): Promise<AssistResult<{ metaTitle: string; metaDescription: string }>> {
  if (await aiAvailable()) {
    const res = await runLlm({
      purpose: "content.meta",
      system: "You write search/AI snippet metadata. Be specific and factual.",
      prompt: `Language ${ctx.language}. Article "${input.title}"${input.targetKeyword ? `, keyword "${input.targetKeyword}"` : ""}${input.targetPrompt ? `, target question "${input.targetPrompt}"` : ""}:\n\n${input.body.slice(0, 12000)}\n\nWrite metaTitle (30–60 characters, includes the keyword) and metaDescription (120–160 characters, directly answers the question).`,
      schema: z.object({ metaTitle: z.string(), metaDescription: z.string() }),
      effort: "low",
      projectId: ctx.projectId,
      workspaceId: ctx.workspaceId,
    });
    return { data: { metaTitle: res.data.metaTitle.trim(), metaDescription: res.data.metaDescription.trim() }, by: "ai" };
  }
  const firstPara = parseBlocks(input.body).find((b) => b.type === "paragraph");
  const text = firstPara && firstPara.type === "paragraph" ? markdownToText(firstPara.text) : markdownToText(input.body);
  const desc = text.length > 158 ? `${text.slice(0, 155).replace(/\s+\S*$/, "")}…` : text;
  const title = input.title.length > 60 ? `${input.title.slice(0, 57).replace(/\s+\S*$/, "")}…` : input.title;
  return { data: { metaTitle: title, metaDescription: desc }, by: "extract" };
}
