import "server-only";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { aiAnswers, fcAnswerChecks, fcAssets, fcDocuments, fcStatements, optimizeRuns, projects } from "@/server/db/schema";
import { availableLlmProviders, runLlm } from "@/server/ai/llm";
import {
  claimHash,
  extractCandidateStatements,
  findQuote,
  lexicalJudge,
  mentionRegex,
  relevantSections,
  type JudgeSection,
} from "./text";

type Asset = typeof fcAssets.$inferSelect;
type Doc = typeof fcDocuments.$inferSelect;
type Trigger = "schedule" | "manual" | "tracking" | "api";

/** Answers scanned per asset and run (AI extraction is slower, so fewer per run). */
const ANSWERS_PER_RUN_AI = 80;
const ANSWERS_PER_RUN_LEXICAL = 500;
const AI_EXTRACT_BATCH = 6;
const AI_JUDGE_BATCH = 10;
const MAX_JUDGE_AI = 300;
const MAX_JUDGE_LEXICAL = 3000;
/** After this many consecutive AI failures the run continues in word-for-word mode. */
const MAX_AI_FAILURES = 2;

export type RunStats = {
  assets: number;
  skippedNoDocs: number;
  answersScanned: number;
  answersWithMentions: number;
  statementsNew: number;
  statementsSeenAgain: number;
  judged: number;
  judgedAi: number;
  judgedLexical: number;
  deviations: number;
  mode: "ai" | "lexical";
  aiErrors: string[];
};

function normMarket(c: string) {
  const u = c.toUpperCase();
  return u === "GB" ? "UK" : u;
}

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/* ───────────────────────────── Extraction ───────────────────────────── */

const extractSchema = z.object({
  answers: z.array(
    z.object({
      answerId: z.string(),
      statements: z.array(z.object({ claim: z.string(), quote: z.string() })),
    }),
  ),
});

type AnswerRow = { id: string; promptId: string; engine: string; country: string; text: string; createdAt: Date };

async function extractWithAi(
  asset: Asset,
  batch: AnswerRow[],
  ctx: { projectId: string; workspaceId: string },
): Promise<Map<string, { claim: string; quote: string }[]>> {
  const names = [asset.name, ...asset.aliases].join(", ");
  const res = await runLlm({
    purpose: "fact_check.extract",
    system:
      "You extract atomic, checkable factual statements about ONE product from AI assistant answers for a label-compliance review. " +
      "A statement is a single claim about the product itself (indication/use, dosage, ingredients, effects, side effects, warnings, approvals, pricing, specifications, availability, comparisons). " +
      "Rewrite each claim as a self-contained sentence naming the product. Include the verbatim sentence from the answer as `quote`. " +
      "Skip opinions without factual content, questions, and statements about other products. Return an empty list when there are none.",
    prompt:
      `Product: ${asset.name}${asset.aliases.length ? ` (also written: ${names})` : ""}${asset.activeIngredient ? `; active ingredient: ${asset.activeIngredient}` : ""}\n\n` +
      batch.map((a) => `<answer id="${a.id}" engine="${a.engine}" market="${a.country}">\n${a.text.slice(0, 6000)}\n</answer>`).join("\n\n") +
      "\n\nReturn statements for every answer id (max 12 per answer).",
    schema: extractSchema,
    projectId: ctx.projectId,
    workspaceId: ctx.workspaceId,
    maxTokens: 4000,
  });
  const out = new Map<string, { claim: string; quote: string }[]>();
  for (const a of res.data.answers) {
    if (!batch.some((b) => b.id === a.answerId)) continue;
    out.set(
      a.answerId,
      a.statements
        .map((s) => ({ claim: s.claim.trim().slice(0, 600), quote: s.quote.trim().slice(0, 800) }))
        .filter((s) => s.claim.length >= 10)
        .slice(0, 12),
    );
  }
  return out;
}

async function upsertStatements(asset: Asset, answer: AnswerRow, statements: { claim: string; quote: string }[], stats: RunStats) {
  const market = normMarket(answer.country);
  for (const s of statements) {
    const hash = claimHash(asset.id, s.claim, answer.engine, market);
    const rows = await db
      .insert(fcStatements)
      .values({
        projectId: asset.projectId,
        assetId: asset.id,
        hash,
        claim: s.claim,
        engine: answer.engine,
        market,
        promptId: answer.promptId,
        answerId: answer.id,
        answerQuote: s.quote || s.claim,
        firstSeenAt: answer.createdAt,
        lastSeenAt: answer.createdAt,
      })
      .onConflictDoUpdate({
        target: [fcStatements.projectId, fcStatements.hash],
        set: {
          seenCount: sql`${fcStatements.seenCount} + 1`,
          firstSeenAt: sql`least(${fcStatements.firstSeenAt}, excluded.first_seen_at)`,
          lastSeenAt: sql`greatest(${fcStatements.lastSeenAt}, excluded.last_seen_at)`,
          answerId: sql`case when excluded.last_seen_at >= ${fcStatements.lastSeenAt} then excluded.answer_id else ${fcStatements.answerId} end`,
          promptId: sql`case when excluded.last_seen_at >= ${fcStatements.lastSeenAt} then excluded.prompt_id else ${fcStatements.promptId} end`,
          answerQuote: sql`case when excluded.last_seen_at >= ${fcStatements.lastSeenAt} then excluded.answer_quote else ${fcStatements.answerQuote} end`,
          // A resolved finding that AI repeats after it was resolved is reopened.
          status: sql`case when ${fcStatements.status} = 'resolved' and excluded.last_seen_at > coalesce(${fcStatements.resolvedAt}, 'epoch'::timestamptz) then 'open' else ${fcStatements.status} end`,
          resolvedAt: sql`case when ${fcStatements.status} = 'resolved' and excluded.last_seen_at > coalesce(${fcStatements.resolvedAt}, 'epoch'::timestamptz) then null else ${fcStatements.resolvedAt} end`,
        },
      })
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    if (rows[0]?.inserted) stats.statementsNew++;
    else stats.statementsSeenAgain++;
  }
}

type RunCtx = { projectId: string; workspaceId: string; ai: boolean; aiFailures: number; isCancelled?: () => Promise<boolean> };

async function scanAnswers(asset: Asset, ctx: RunCtx, stats: RunStats) {
  const names = [asset.name, ...asset.aliases].map((n) => n.trim()).filter((n) => n.length >= 2);
  const re = mentionRegex(names);
  if (!re) return;
  const markets = [...new Set(asset.markets.map((m) => normMarket(m.country)))];
  const marketList = markets.flatMap((m) => (m === "UK" ? ["UK", "GB"] : [m]));
  const patterns = names.map((n) => `%${escapeLike(n)}%`);
  const rows: AnswerRow[] = await db
    .select({
      id: aiAnswers.id,
      promptId: aiAnswers.promptId,
      engine: aiAnswers.engine,
      country: aiAnswers.country,
      text: aiAnswers.text,
      createdAt: aiAnswers.createdAt,
    })
    .from(aiAnswers)
    .where(
      and(
        eq(aiAnswers.projectId, asset.projectId),
        eq(aiAnswers.status, "ok"),
        marketList.length ? inArray(aiAnswers.country, marketList) : undefined,
        sql`${aiAnswers.text} ILIKE ANY(ARRAY[${sql.join(
          patterns.map((p) => sql`${p}`),
          sql`, `,
        )}]::text[])`,
        sql`NOT EXISTS (SELECT 1 FROM ${fcAnswerChecks} c WHERE c.asset_id = ${asset.id} AND c.answer_id = ${aiAnswers.id})`,
      ),
    )
    .orderBy(desc(aiAnswers.createdAt))
    .limit(ctx.ai ? ANSWERS_PER_RUN_AI : ANSWERS_PER_RUN_LEXICAL);

  const mentioning = new Set(rows.filter((r) => re.test(r.text)).map((r) => r.id));
  stats.answersScanned += rows.length;
  stats.answersWithMentions += mentioning.size;

  const textCache = new Map<string, { claim: string; quote: string }[]>();
  // Process in small batches so progress is persisted even if the job is interrupted.
  for (let i = 0; i < rows.length; i += AI_EXTRACT_BATCH) {
    const batch = rows.slice(i, i + AI_EXTRACT_BATCH);
    const withMentions = batch.filter((r) => mentioning.has(r.id));
    const extracted = new Map<string, { claim: string; quote: string }[]>();
    // Identical answer texts (common for repeated daily runs) are extracted once per run.
    for (const a of withMentions) {
      const cached = textCache.get(a.text);
      if (cached) extracted.set(a.id, cached);
    }
    const todo = withMentions.filter((a) => !extracted.has(a.id));
    if (todo.length && ctx.ai && ctx.aiFailures < MAX_AI_FAILURES) {
      try {
        const res = await extractWithAi(asset, todo, ctx);
        for (const a of todo) {
          const list = res.get(a.id) ?? [];
          extracted.set(a.id, list);
          textCache.set(a.text, list);
        }
        ctx.aiFailures = 0;
      } catch (err) {
        ctx.aiFailures++;
        if (stats.aiErrors.length < 5) stats.aiErrors.push(err instanceof Error ? err.message : String(err));
      }
    }
    for (const a of withMentions) if (!extracted.has(a.id)) extracted.set(a.id, extractCandidateStatements(a.text, names));
    for (const row of batch) {
      const statements = extracted.get(row.id) ?? [];
      if (statements.length) await upsertStatements(asset, row, statements, stats);
      await db
        .insert(fcAnswerChecks)
        .values({ assetId: asset.id, answerId: row.id, projectId: asset.projectId, statements: statements.length })
        .onConflictDoNothing();
    }
    if (ctx.isCancelled && (await ctx.isCancelled())) return;
  }
}

/* ───────────────────────────── Judging ───────────────────────────── */

const judgeSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      verdict: z.enum(["matched", "contradicted", "unsupported", "outdated", "off_label", "needs_review"]),
      severity: z.enum(["critical", "major", "minor", "none"]),
      labelSection: z.string(),
      labelQuote: z.string(),
      explanation: z.string(),
    }),
  ),
});

function sectionsFor(docs: Doc[], market: string): JudgeSection[] {
  return docs
    .filter((d) => !d.market || normMarket(d.market) === market)
    .flatMap((d) =>
      d.sections.map((s) => ({ ...s, documentId: d.id, documentTitle: d.title, superseded: d.superseded })),
    );
}

type PendingRow = { id: string; claim: string; market: string };

type Judgement = {
  verdict: "matched" | "contradicted" | "unsupported" | "outdated" | "off_label" | "needs_review";
  severity: "critical" | "major" | "minor" | null;
  labelSection: string | null;
  labelQuote: string | null;
  documentId: string | null;
  explanation: string;
  matchScore: number | null;
  judgedBy: "ai" | "lexical";
};

function applyLexical(row: PendingRow, sections: JudgeSection[]): Judgement {
  const r = lexicalJudge(row.claim, sections);
  return {
    verdict: r.verdict,
    severity: r.severity,
    labelSection: r.labelSection,
    labelQuote: r.labelQuote,
    documentId: r.documentId,
    explanation: r.explanation,
    matchScore: r.score,
    judgedBy: "lexical",
  };
}

async function judgeWithAi(
  asset: Asset,
  batch: PendingRow[],
  sections: JudgeSection[],
  ctx: { projectId: string; workspaceId: string },
) {
  const current = sections.filter((s) => !s.superseded);
  const old = sections.filter((s) => s.superseded);
  const claims = batch.map((b) => b.claim);
  const picked = [...relevantSections(current, claims, 8), ...relevantSections(old, claims, 3)];
  const labelText = picked
    .map(
      (s) =>
        `<section document="${s.documentTitle}"${s.superseded ? ' status="SUPERSEDED older version"' : ""} heading="${s.heading.replace(/"/g, "'")}">\n${s.text.slice(0, 6000)}\n</section>`,
    )
    .join("\n\n");
  const res = await runLlm({
    purpose: "fact_check.judge",
    system:
      "You are a regulatory label-alignment reviewer. Compare each claim that AI assistants made about a product with the reference documents (the label). Judge strictly by the label text, word for word:\n" +
      "- matched: the label explicitly states the same thing.\n" +
      "- contradicted: the label states something different (other dose, population, frequency, effect…).\n" +
      "- off_label: the claim promotes a use, indication, population or route the label does not approve.\n" +
      "- unsupported: the label contains no evidence for the claim (and it is not an off-label use).\n" +
      "- outdated: the claim matches only a SUPERSEDED older version of the label.\n" +
      "- needs_review: ambiguous; a human must decide.\n" +
      "severity for deviations: critical = patient safety / dosing / contraindications; major = efficacy or indication claims; minor = wording, marketing or non-safety facts. Use 'none' for matched/needs_review.\n" +
      "labelQuote must be copied VERBATIM from the label (empty string when the label has nothing relevant). labelSection = the section heading.",
    prompt:
      `Product: ${asset.name}${asset.activeIngredient ? ` (active ingredient: ${asset.activeIngredient})` : ""}\n\nLabel excerpts:\n${labelText}\n\nClaims:\n` +
      batch.map((b) => `- id=${b.id}: ${b.claim}`).join("\n") +
      "\n\nReturn one result per claim id.",
    schema: judgeSchema,
    projectId: ctx.projectId,
    workspaceId: ctx.workspaceId,
    maxTokens: 4000,
  });
  const allText = sections.map((s) => `${s.heading}\n${s.text}`).join("\n\n");
  const results = new Map<string, Judgement>();
  function normalizeAi(r: z.infer<typeof judgeSchema>["results"][number]): Judgement {
    let verdict: (typeof r)["verdict"] = r.verdict;
    let quote = r.labelQuote.trim();
    let explanation = r.explanation.trim();
    if (quote) {
      const q = findQuote(quote, allText);
      if (q.found) quote = q.sentence ?? quote;
      else {
        if (["matched", "contradicted", "outdated"].includes(verdict)) {
          explanation = `${explanation} (Downgraded: the cited label passage could not be found verbatim.)`.trim();
          verdict = "needs_review";
        }
        quote = "";
      }
    } else if (["matched", "contradicted", "outdated"].includes(verdict)) {
      explanation = `${explanation} (Downgraded: no verbatim label passage was cited.)`.trim();
      verdict = "needs_review";
    }
    const isDeviation = ["contradicted", "unsupported", "outdated", "off_label"].includes(verdict);
    const section = picked.find((s) => s.heading === r.labelSection.trim()) ?? (quote ? picked.find((s) => findQuote(quote, s.text).found) : undefined);
    return {
      verdict,
      severity: isDeviation ? (r.severity === "none" ? "minor" : r.severity) : null,
      labelSection: r.labelSection.trim() || section?.heading || null,
      labelQuote: quote || null,
      documentId: section?.documentId ?? null,
      explanation: explanation.slice(0, 1000),
      matchScore: verdict === "matched" ? 1 : null,
      judgedBy: "ai",
    };
  }
  for (const r of res.data.results) {
    if (batch.some((b) => b.id === r.id)) results.set(r.id, normalizeAi(r));
  }
  return results;
}

async function judgePending(asset: Asset, docs: Doc[], ctx: RunCtx, stats: RunStats) {
  const pending: PendingRow[] = await db
    .select({ id: fcStatements.id, claim: fcStatements.claim, market: fcStatements.market })
    .from(fcStatements)
    .where(and(eq(fcStatements.assetId, asset.id), eq(fcStatements.verdict, "pending")))
    .orderBy(desc(fcStatements.lastSeenAt))
    .limit(ctx.ai ? MAX_JUDGE_AI : MAX_JUDGE_LEXICAL);
  if (!pending.length) return;
  const byMarket = new Map<string, PendingRow[]>();
  for (const p of pending) byMarket.set(p.market, [...(byMarket.get(p.market) ?? []), p]);

  for (const [market, rows] of byMarket) {
    const sections = sectionsFor(docs, market);
    for (let i = 0; i < rows.length; i += AI_JUDGE_BATCH) {
      const batch = rows.slice(i, i + AI_JUDGE_BATCH);
      let results = new Map<string, Judgement>();
      if (ctx.ai && ctx.aiFailures < MAX_AI_FAILURES && sections.length) {
        try {
          results = await judgeWithAi(asset, batch, sections, ctx);
          ctx.aiFailures = 0;
        } catch (err) {
          ctx.aiFailures++;
          if (stats.aiErrors.length < 5) stats.aiErrors.push(err instanceof Error ? err.message : String(err));
        }
      }
      for (const row of batch) {
        const r = results.get(row.id) ?? applyLexical(row, sections);
        await db
          .update(fcStatements)
          .set({
            verdict: r.verdict,
            severity: r.severity,
            labelSection: r.labelSection,
            labelQuote: r.labelQuote,
            documentId: r.documentId,
            explanation: r.explanation,
            matchScore: r.matchScore,
            judgedBy: r.judgedBy,
            checkedAt: new Date(),
          })
          .where(eq(fcStatements.id, row.id));
        stats.judged++;
        if (r.judgedBy === "ai") stats.judgedAi++;
        else stats.judgedLexical++;
        if (["contradicted", "unsupported", "outdated", "off_label"].includes(r.verdict)) stats.deviations++;
      }
    }
  }
}

/* ───────────────────────────── Entry point ───────────────────────────── */

/** Scans new AI answers for statements about the project's assets and judges them against the label. */
export async function runFactCheck(opts: {
  projectId: string;
  assetId?: string | null;
  trigger?: Trigger;
  isCancelled?: () => Promise<boolean>;
}) {
  const [project] = await db.select({ id: projects.id, workspaceId: projects.workspaceId }).from(projects).where(eq(projects.id, opts.projectId)).limit(1);
  if (!project) return { skipped: "project not found" };
  const [run] = await db
    .insert(optimizeRuns)
    .values({ projectId: project.id, kind: "fact_check", trigger: opts.trigger ?? "manual", status: "running" })
    .returning();
  const ai = (await availableLlmProviders()).length > 0;
  const stats: RunStats = {
    assets: 0,
    skippedNoDocs: 0,
    answersScanned: 0,
    answersWithMentions: 0,
    statementsNew: 0,
    statementsSeenAgain: 0,
    judged: 0,
    judgedAi: 0,
    judgedLexical: 0,
    deviations: 0,
    mode: ai ? "ai" : "lexical",
    aiErrors: [],
  };
  try {
    const assets = await db
      .select()
      .from(fcAssets)
      .where(and(eq(fcAssets.projectId, project.id), eq(fcAssets.status, "active"), opts.assetId ? eq(fcAssets.id, opts.assetId) : undefined));
    const ctx: RunCtx = { projectId: project.id, workspaceId: project.workspaceId, ai, aiFailures: 0, isCancelled: opts.isCancelled };
    for (const asset of assets) {
      if (opts.isCancelled && (await opts.isCancelled())) break;
      const docs = await db
        .select()
        .from(fcDocuments)
        .where(and(eq(fcDocuments.assetId, asset.id), eq(fcDocuments.status, "ready"), isNotNull(fcDocuments.sections)));
      stats.assets++;
      if (!docs.some((d) => d.sections.length > 0)) {
        stats.skippedNoDocs++;
        continue;
      }
      await scanAnswers(asset, ctx, stats);
      await judgePending(asset, docs, ctx, stats);
      await db.update(fcAssets).set({ lastCheckedAt: new Date() }).where(eq(fcAssets.id, asset.id));
    }
    await db
      .update(optimizeRuns)
      .set({ status: "completed", stats, finishedAt: new Date() })
      .where(eq(optimizeRuns.id, run!.id));
    return stats;
  } catch (err) {
    await db
      .update(optimizeRuns)
      .set({ status: "failed", stats, error: err instanceof Error ? err.message : String(err), finishedAt: new Date() })
      .where(eq(optimizeRuns.id, run!.id));
    throw err;
  }
}

/** Resets automatic verdicts of an asset so statements are re-judged against an updated label. */
export async function resetAssetVerdicts(assetId: string) {
  await db
    .update(fcStatements)
    .set({ verdict: "pending", checkedAt: null })
    .where(and(eq(fcStatements.assetId, assetId), sql`coalesce(${fcStatements.judgedBy}, 'lexical') <> 'user'`));
}
