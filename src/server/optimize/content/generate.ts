import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import {
  brandKnowledge,
  catalogProducts,
  contentPersonas,
  contentPieces,
  projects,
  type ContentCitation,
} from "@/server/db/schema";
import {
  AiNotConfiguredError,
  availableLlmProviders,
  runLlm,
} from "@/server/ai/llm";
import { safeFetch } from "@/server/optimize/net";
import { slugify } from "@/server/optimize/markdown";
import { extractPage } from "./html-extract";
import { buildJsonLdString } from "./schema-ld";
import { computeScore, rescoreAndSnapshot, type ContentRow } from "./service";

export type GenerationOptions = {
  contentType?: string;
  wordCount?: number;
  includeFaq?: boolean;
  tone?: string;
  instructions?: string;
};

const briefSchema = z.object({
  audience: z.string(),
  intent: z.string(),
  angle: z.string(),
  keyTakeaways: z.array(z.string()),
  outline: z.array(z.string()),
  questions: z.array(z.string()),
  entities: z.array(z.string()),
  sources: z.array(
    z.object({ url: z.string(), title: z.string(), note: z.string() }),
  ),
});

const enrichSchema = z.object({
  title: z.string(),
  metaTitle: z.string(),
  metaDescription: z.string(),
  slug: z.string(),
  faqs: z.array(z.object({ question: z.string(), answer: z.string() })),
  entities: z.array(
    z.object({ name: z.string(), type: z.string(), sameAs: z.string() }),
  ),
});

async function setStage(
  id: string,
  stage: string | null,
  extra: Partial<typeof contentPieces.$inferInsert> = {},
) {
  await db
    .update(contentPieces)
    .set({ generationStage: stage, ...extra })
    .where(eq(contentPieces.id, id));
}

function stripFences(md: string): string {
  const m = md.trim().match(/^```(?:markdown|md)?\s*([\s\S]*?)```\s*$/i);
  return (m ? m[1]! : md).trim();
}

function isHttpUrl(u: string) {
  return /^https?:\/\/[^\s]+$/i.test(u);
}

/** Brand context ("connected knowledge") for grounding drafts. */
async function brandContext(projectId: string) {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) throw new Error("Project not found");
  let knowledge = "";
  try {
    const rows = await db
      .select({ kind: brandKnowledge.kind, data: brandKnowledge.data })
      .from(brandKnowledge)
      .where(
        and(
          eq(brandKnowledge.projectId, projectId),
          inArray(brandKnowledge.kind, ["profile", "products", "personas"]),
        ),
      );
    knowledge = rows
      .map((r) => `${r.kind}: ${JSON.stringify(r.data).slice(0, 2500)}`)
      .join("\n");
  } catch {
    knowledge = "";
  }
  let products = "";
  try {
    const rows = await db
      .select({
        name: catalogProducts.name,
        price: catalogProducts.price,
        currency: catalogProducts.currency,
        url: catalogProducts.url,
      })
      .from(catalogProducts)
      .where(eq(catalogProducts.projectId, projectId))
      .limit(25);
    products = rows
      .map(
        (p) =>
          `- ${p.name}${p.price ? ` (${p.price} ${p.currency ?? ""})` : ""}${p.url ? ` ${p.url}` : ""}`,
      )
      .join("\n");
  } catch {
    products = "";
  }
  const text = [
    `Brand: ${project.name} (${project.domain}), market ${project.country}, language ${project.language}.`,
    project.description ? `About: ${project.description}` : "",
    project.brand?.description
      ? `Positioning: ${project.brand.description}`
      : "",
    project.brand?.industry ? `Industry: ${project.brand.industry}` : "",
    knowledge ? `Brand knowledge:\n${knowledge}` : "",
    products ? `Product catalog:\n${products}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { project, text };
}

/** Full draft pipeline: web-grounded brief → draft in the persona's voice → meta/FAQ/entities → JSON-LD → score. */
export async function runContentGeneration(
  contentId: string,
  options: GenerationOptions = {},
) {
  const [row] = await db
    .select()
    .from(contentPieces)
    .where(eq(contentPieces.id, contentId))
    .limit(1);
  if (!row) throw new Error("Content not found");
  try {
    if (!(await availableLlmProviders()).length)
      throw new AiNotConfiguredError();
    const { project, text: brand } = await brandContext(row.projectId);
    // Personas are project-scoped: never use a persona of another project.
    const [persona] = row.personaId
      ? await db
          .select()
          .from(contentPersonas)
          .where(and(eq(contentPersonas.id, row.personaId), eq(contentPersonas.projectId, row.projectId)))
          .limit(1)
      : [];
    const target = row.targetPrompt || row.targetKeyword || row.title;
    const language = row.language || project.language;
    const words = options.wordCount ?? row.brief?.wordCount ?? 1500;
    const personaText = persona
      ? `Write from the perspective of ${persona.name} — ${persona.role}. Expertise: ${persona.expertise.join(", ")}. Voice: ${persona.voice}. ${persona.bio}`
      : `Write in the brand's own expert voice (${project.name}).`;

    /* 1) Research brief with web search (re-used on retry when a researched brief exists) */
    const existingBrief = row.brief;
    const researched = !!(
      existingBrief?.keyTakeaways?.length &&
      existingBrief.sources?.length &&
      existingBrief.outline?.length
    );
    let brief: {
      audience: string;
      intent: string;
      angle: string;
      keyTakeaways: string[];
      outline: string[];
      questions: string[];
      entities: string[];
      sources: ContentCitation[];
      wordCount: number;
    };
    let citations: ContentCitation[];
    if (researched && existingBrief) {
      citations = existingBrief.sources ?? [];
      brief = {
        audience: existingBrief.audience ?? "",
        intent: existingBrief.intent ?? "",
        angle: existingBrief.angle ?? "",
        keyTakeaways: existingBrief.keyTakeaways ?? [],
        outline: existingBrief.outline ?? [],
        questions: existingBrief.questions ?? [],
        entities: existingBrief.entities ?? [],
        sources: citations,
        wordCount: words,
      };
      await setStage(contentId, "drafting");
    } else {
      await setStage(contentId, "research");
      const briefRes = await runLlm({
        purpose: "content.brief",
        system:
          "You are a meticulous content strategist for answer-engine optimization. Only cite sources you actually found.",
        prompt: `Research and plan an article that answers: "${target}".
${row.targetKeyword ? `Primary keyword: ${row.targetKeyword}\n` : ""}Content type: ${options.contentType ?? "article"} · target length ~${words} words · language: ${language}.
${brand}
${existingBrief?.outline?.length ? `Planned outline to respect: ${existingBrief.outline.join(" | ")}\n` : ""}${existingBrief?.questions?.length ? `Questions engines search for: ${existingBrief.questions.join(" | ")}\n` : ""}${options.instructions ? `Extra instructions: ${options.instructions}\n` : ""}
Use web search to find 5–10 authoritative, current sources (official bodies, standards, reputable publications, test sites). Return the audience, search intent, a differentiating angle, 3–5 key takeaways with concrete facts, an outline of 5–9 H2 sections (phrase them as the questions people ask where natural), follow-up questions, important entities (products, standards, organisations), and the sources with url, title and a note on what fact each supports.`,
        schema: briefSchema,
        webSearch: true,
        maxTokens: 8000,
        timeoutMs: 12 * 60_000,
        projectId: row.projectId,
        workspaceId: project.workspaceId,
      });
      const found = new Map<string, ContentCitation>();
      for (const s of briefRes.data.sources)
        if (isHttpUrl(s.url))
          found.set(s.url, { url: s.url, title: s.title, note: s.note });
      for (const c of briefRes.citations)
        if (isHttpUrl(c.url) && !found.has(c.url))
          found.set(c.url, { url: c.url, title: c.title ?? null });
      citations = [...found.values()].slice(0, 15);
      brief = { ...briefRes.data, sources: citations, wordCount: words };
      await setStage(contentId, "drafting", { brief });
    }

    /* 2) Draft */
    const draftRes = await runLlm({
      purpose: "content.draft",
      system: `You are an expert writer producing content that AI answer engines quote and cite. ${personaText}`,
      prompt: `Write the full article in ${language} as Markdown (no front matter, no code fences around the whole text).
Target question: "${target}"
Brief: ${JSON.stringify({ audience: brief.audience, intent: brief.intent, angle: brief.angle, keyTakeaways: brief.keyTakeaways, outline: brief.outline, questions: brief.questions, entities: brief.entities })}
Sources you may cite (use ONLY these URLs, as inline markdown links right after the fact they support):
${citations.map((c, i) => `${i + 1}. ${c.title ?? c.url} — ${c.url}${c.note ? ` (${c.note})` : ""}`).join("\n")}
${brand}
Rules:
- Start with a bold "Key takeaways:" line (2–3 facts), then a 40–80 word paragraph that answers the target question directly.
- Use the outline as H2 sections (## …); add H3s where useful. No H1.
- Short paragraphs (2–4 sentences), concrete numbers, units, dates and named entities. No filler, no marketing superlatives.
- Include at least one comparison table and one bulleted or numbered list.
- Mention ${project.name} only where genuinely relevant, fairly and transparently.
- Never invent statistics, quotes or sources. If a fact is uncertain, say so.
- About ${words} words.${options.tone ? `\n- Tone: ${options.tone}.` : ""}${options.instructions ? `\n- ${options.instructions}` : ""}`,
      maxTokens: Math.min(16000, Math.round(words * 3) + 2000),
      timeoutMs: 15 * 60_000,
      projectId: row.projectId,
      workspaceId: project.workspaceId,
    });
    const body = stripFences(draftRes.text);
    if (body.split(/\s+/).length < 80)
      throw new Error("The model returned an unusably short draft.");
    await setStage(contentId, "enriching", { body });

    /* 3) Meta, FAQ, entities */
    const enrich = await runLlm({
      purpose: "content.enrich",
      system:
        "You optimize article metadata and structured data for answer engines. Base everything strictly on the article.",
      prompt: `Article (${language}):\n\n${body.slice(0, 24000)}\n\nReturn: a concise title (≤ 70 chars), metaTitle (30–60 chars, includes the main keyword${row.targetKeyword ? ` "${row.targetKeyword}"` : ""}), metaDescription (120–160 chars, answers the question), a short URL slug, ${options.includeFaq === false ? "an empty faqs array" : "5–7 FAQs (question + 40–80 word answer, only facts from the article)"}, and 6–12 key entities (name, schema.org type such as Organization/Product/Thing/Place/CreativeWork, and a Wikipedia/Wikidata sameAs URL only if you are certain, else empty string).`,
      schema: enrichSchema,
      effort: "low",
      timeoutMs: 8 * 60_000,
      projectId: row.projectId,
      workspaceId: project.workspaceId,
    });
    const e = enrich.data;
    const faqs = e.faqs
      .filter((f) => f.question.trim() && f.answer.trim())
      .slice(0, 8);
    const entities = e.entities
      .filter((x) => x.name.trim())
      .map((x) => ({
        name: x.name.trim(),
        type: x.type || "Thing",
        sameAs: isHttpUrl(x.sameAs) ? x.sameAs : null,
      }));
    const title = e.title.trim() || row.title;
    const jsonLd = buildJsonLdString({
      title,
      description: e.metaDescription,
      language,
      publisherName: project.name,
      publisherUrl: `https://${project.domain}`,
      publisherLogo: project.logoUrl,
      faqs,
      entities,
    });
    const next: ContentRow = {
      ...row,
      title,
      body,
      brief,
      citations,
      metaTitle: e.metaTitle.trim() || null,
      metaDescription: e.metaDescription.trim() || null,
      slug: slugify(e.slug || title),
      faqs,
      entities,
      schemaJsonLd: jsonLd,
    };
    await db
      .update(contentPieces)
      .set({
        title: next.title,
        body: next.body,
        citations,
        metaTitle: next.metaTitle,
        metaDescription: next.metaDescription,
        slug: next.slug,
        faqs,
        entities,
        schemaJsonLd: jsonLd,
        status: "draft",
        generationStage: null,
        error: null,
      })
      .where(eq(contentPieces.id, contentId));
    await rescoreAndSnapshot(next);
    return { ok: true };
  } catch (err) {
    const message =
      err instanceof AiNotConfiguredError
        ? "No AI provider is available. Connect a local agent or add an API key in Admin → AI Providers, then retry."
        : err instanceof Error
          ? err.message
          : String(err);
    await db
      .update(contentPieces)
      .set({
        status: "failed",
        generationStage: null,
        error: message.slice(0, 1000),
      })
      .where(eq(contentPieces.id, contentId));
    throw err;
  }
}

const rewriteSchema = z.object({
  body: z.string(),
  metaTitle: z.string(),
  metaDescription: z.string(),
  faqs: z.array(z.object({ question: z.string(), answer: z.string() })),
  changes: z.array(z.string()),
});

/** "Optimize existing URL": fetch (SSRF-safe) → extract → score the original → optionally AI rewrite → rescore. */
export async function runUrlOptimization(
  contentId: string,
  opts: { rewrite: boolean },
) {
  const [row] = await db
    .select()
    .from(contentPieces)
    .where(eq(contentPieces.id, contentId))
    .limit(1);
  if (!row || !row.sourceUrl) throw new Error("Content not found");
  try {
    await setStage(contentId, "fetching");
    const res = await safeFetch(row.sourceUrl, {
      timeoutMs: 25_000,
      maxBytes: 4 * 1024 * 1024,
      headers: { accept: "text/html,application/xhtml+xml" },
    });
    if (!res.ok) throw new Error(`The page returned HTTP ${res.status}.`);
    if (!(res.headers.get("content-type") ?? "").includes("html"))
      throw new Error("The URL is not an HTML page.");
    const page = extractPage(res.text(), res.url);
    if (page.wordCount < 30)
      throw new Error(
        "Couldn't find readable content on this page (it may render with JavaScript only).",
      );
    await setStage(contentId, "scoring");
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, row.projectId))
      .limit(1);
    const original: ContentRow = {
      ...row,
      title: page.title,
      body: page.markdown,
      metaTitle: page.metaTitle,
      metaDescription: page.metaDescription,
      slug: page.slug || slugify(page.title),
      schemaJsonLd: page.jsonLd,
      faqs: page.faqs,
      language: page.lang?.slice(0, 2) || row.language,
    };
    const baseline = computeScore(original);
    const snapshot = {
      fetchedAt: new Date().toISOString(),
      finalUrl: page.url,
      metaTitle: page.metaTitle,
      metaDescription: page.metaDescription,
      canonical: page.canonical,
      jsonLdTypes: page.jsonLdTypes,
      links: page.links,
      wordCount: page.wordCount,
      originalScore: baseline.score,
      originalPillars: baseline.pillars,
      originalMarkdown: page.markdown.slice(0, 200_000),
      changes: [] as string[],
    };
    let next = original;
    await db
      .update(contentPieces)
      .set({
        title: original.title,
        body: original.body,
        metaTitle: original.metaTitle,
        metaDescription: original.metaDescription,
        slug: original.slug,
        schemaJsonLd: original.schemaJsonLd,
        faqs: original.faqs,
        language: original.language,
        baselineScore: baseline.score,
        sourceSnapshot: snapshot,
      })
      .where(eq(contentPieces.id, contentId));
    await rescoreAndSnapshot({ ...original, baselineScore: baseline.score });

    if (opts.rewrite && (await availableLlmProviders()).length && project) {
      await setStage(contentId, "rewriting");
      try {
        const suggestions = baseline.suggestions
          .slice(0, 12)
          .map((s) => `- [${s.pillar}] ${s.message}`)
          .join("\n");
        const rw = await runLlm({
          purpose: "content.rewrite",
          system:
            "You rewrite existing web pages so AI answer engines can extract and cite them. Preserve every fact, claim, product detail and link of the original; never invent new facts, numbers or sources.",
          prompt: `Page: ${page.url}${row.targetPrompt ? `\nTarget question: ${row.targetPrompt}` : ""}${row.targetKeyword ? `\nTarget keyword: ${row.targetKeyword}` : ""}
Current AEO score: ${baseline.score}/100. Fix these issues:
${suggestions}

Original content (Markdown):
${page.markdown.slice(0, 30000)}

Return the improved full body as Markdown (answer-first opening paragraph, question-style H2s, short paragraphs, lists/tables where the content allows, a Key takeaways line), an improved metaTitle (30–60 chars) and metaDescription (120–160 chars), 4–6 FAQs answered only from the page's facts, and a list of the main changes you made.`,
          schema: rewriteSchema,
          maxTokens: 16000,
          timeoutMs: 15 * 60_000,
          projectId: row.projectId,
          workspaceId: project.workspaceId,
        });
        const body = stripFences(rw.data.body);
        if (body.split(/\s+/).length >= 60) {
          const faqs = rw.data.faqs.filter(
            (f) => f.question.trim() && f.answer.trim(),
          );
          next = {
            ...original,
            body,
            metaTitle: rw.data.metaTitle.trim() || original.metaTitle,
            metaDescription:
              rw.data.metaDescription.trim() || original.metaDescription,
            faqs: faqs.length ? faqs : original.faqs,
            baselineScore: baseline.score,
          };
          if (
            !original.schemaJsonLd ||
            !computeScore({ ...next }).pillars.schema
          ) {
            next.schemaJsonLd = buildJsonLdString({
              title: next.title,
              description: next.metaDescription,
              url: page.canonical ?? page.url,
              language: next.language,
              publisherName: project.name,
              publisherUrl: `https://${project.domain}`,
              faqs: next.faqs,
            });
          }
          snapshot.changes = rw.data.changes.slice(0, 20);
          await db
            .update(contentPieces)
            .set({
              body: next.body,
              metaTitle: next.metaTitle,
              metaDescription: next.metaDescription,
              faqs: next.faqs,
              schemaJsonLd: next.schemaJsonLd,
              sourceSnapshot: snapshot,
            })
            .where(eq(contentPieces.id, contentId));
          await rescoreAndSnapshot(next);
        }
      } catch (err) {
        // The scored original stays usable — record why the rewrite didn't happen.
        const note = err instanceof Error ? err.message : String(err);
        await db
          .update(contentPieces)
          .set({
            sourceSnapshot: { ...snapshot, rewriteError: note.slice(0, 500) },
          })
          .where(eq(contentPieces.id, contentId));
      }
    }
    await db
      .update(contentPieces)
      .set({ status: "draft", generationStage: null, error: null })
      .where(eq(contentPieces.id, contentId));
    return { ok: true, baseline: baseline.score };
  } catch (err) {
    await db
      .update(contentPieces)
      .set({
        status: "failed",
        generationStage: null,
        error: (err instanceof Error ? err.message : String(err)).slice(
          0,
          1000,
        ),
      })
      .where(eq(contentPieces.id, contentId));
    throw err;
  }
}
