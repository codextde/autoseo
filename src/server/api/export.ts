import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import type { AiScope } from "./ai-data";
import { listPromptsWithMetrics } from "./ai-data";

export type ExportAnswer = {
  answerId: string;
  date: string;
  promptId: string;
  prompt: string;
  country: string;
  language: string;
  model: string;
  provider: string;
  status: string;
  brandMentioned: boolean;
  brandCited: boolean;
  position: number | null;
  mentionDepth: number | null;
  sentiment: number | null;
  brandCount: number;
  citationCount: number;
  ownCitationCount: number;
  competitorsMentioned: string[];
  sources: string[];
  text?: string;
};

/** Bulk export: all prompts with metrics + one row per AI answer in the period (paginated). */
export async function exportProjectData(s: AiScope, opts: { page: number; limit: number; includeText: boolean }) {
  const engineSql = s.engines.length ? sql`and a.engine in ${s.engines}` : sql``;
  const tagSql = s.tagIds.length ? sql`and a.prompt_id in (select l.prompt_id from prompt_tag_links l where l.tag_id in ${s.tagIds})` : sql``;
  const where = sql`a.project_id = ${s.project.id} and a.answer_date between ${s.period.from}::date and ${s.period.to}::date ${engineSql} ${tagSql}`;
  const offset = (opts.page - 1) * opts.limit;

  const [countRow] = (await db.execute(sql`select count(*)::int n from ai_answers a where ${where}`)) as unknown as { n: number }[];
  const total = Number(countRow?.n ?? 0);
  type Row = {
    id: string; d: string; prompt_id: string; prompt: string; country: string; language: string; engine: string; provider: string; status: string;
    brand_mentioned: boolean; brand_cited: boolean; brand_position: number | null; mention_depth: number | null; sentiment: number | null;
    brand_count: number; citation_count: number; own_citation_count: number; competitors: string[] | null; sources: string[] | null; text?: string;
  };
  const rows = (await db.execute(sql`
    select a.id, a.answer_date::text d, a.prompt_id, p.text prompt, a.country, a.language, a.engine, a.provider, a.status,
      a.brand_mentioned, a.brand_cited, a.brand_position, a.mention_depth, a.sentiment, a.brand_count, a.citation_count, a.own_citation_count,
      (select array_agg(distinct m.brand_name) from ai_mentions m where m.answer_id = a.id and not m.is_own) competitors,
      (select array_agg(src.url order by c.position) from ai_citations c join ai_sources src on src.id = c.source_id where c.answer_id = a.id) sources
      ${opts.includeText ? sql`, a.text` : sql``}
    from ai_answers a join prompts p on p.id = a.prompt_id
    where ${where}
    order by a.answer_date desc, a.prompt_id, a.engine
    limit ${opts.limit} offset ${offset}`)) as unknown as Row[];

  const answers: ExportAnswer[] = rows.map((r) => ({
    answerId: r.id,
    date: r.d,
    promptId: r.prompt_id,
    prompt: r.prompt,
    country: r.country,
    language: r.language,
    model: r.engine,
    provider: r.provider,
    status: r.status,
    brandMentioned: Boolean(r.brand_mentioned),
    brandCited: Boolean(r.brand_cited),
    position: r.brand_position,
    mentionDepth: r.mention_depth == null ? null : Math.round(Number(r.mention_depth) * 10) / 10,
    sentiment: r.sentiment == null ? null : Math.round(Number(r.sentiment) * 10) / 10,
    brandCount: Number(r.brand_count),
    citationCount: Number(r.citation_count),
    ownCitationCount: Number(r.own_citation_count),
    competitorsMentioned: r.competitors ?? [],
    sources: r.sources ?? [],
    ...(opts.includeText ? { text: r.text ?? "" } : {}),
  }));

  const prompts = opts.page === 1 ? (await listPromptsWithMetrics(s, { status: "all", page: 1, limit: 10_000 })).items : undefined;
  return {
    prompts,
    answers,
    pagination: { page: opts.page, limit: opts.limit, total, totalPages: Math.max(1, Math.ceil(total / opts.limit)) },
  };
}

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = Array.isArray(v) ? v.join("; ") : typeof v === "boolean" ? (v ? "true" : "false") : String(v);
  // Neutralise spreadsheet formulas and quote.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function answersToCsv(answers: ExportAnswer[], includeText: boolean): string {
  const cols: (keyof ExportAnswer)[] = [
    "date", "answerId", "promptId", "prompt", "country", "language", "model", "provider", "status", "brandMentioned", "brandCited",
    "position", "mentionDepth", "sentiment", "brandCount", "citationCount", "ownCitationCount", "competitorsMentioned", "sources",
    ...(includeText ? (["text"] as const) : []),
  ];
  return [cols.join(","), ...answers.map((a) => cols.map((c) => csvCell(a[c])).join(","))].join("\n");
}
