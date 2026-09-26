import "server-only";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { runLlm } from "@/server/ai/llm";
import { db } from "@/server/db/client";
import { reports, reportTemplates } from "@/server/db/schema";
import { CHARTS, LISTS, TABLES, TOKENS, resolveToken, type ResolveCtx } from "@/features/reports/lib/catalog";
import type { DataBundle } from "@/features/reports/lib/bundle";
import { card, chart, heading, icon as iconEl, kpi, list, score, slide as makeSlide, table, text } from "@/features/reports/lib/build";
import { ICONS } from "@/features/reports/lib/icons";
import { themeFromBrandKit } from "@/features/reports/lib/theme";
import { CHART_TYPES, type Slide, type SlideElement } from "@/features/reports/lib/types";
import { getBrandKit } from "./brand";
import { loadReportData } from "./data";
import { saveHtmlReport } from "./service";

/* ───────────────────────────── data digest for prompts ───────────────────────────── */

const KEY_TOKENS = [
  "brand.name",
  "client.name",
  "agency.name",
  "project.domain",
  "project.market",
  "report.period",
  "ai.visibility",
  "ai.visibility_delta",
  "ai.mention_rate",
  "ai.citation_rate",
  "ai.avg_position",
  "ai.sentiment",
  "ai.share_of_voice",
  "ai.geo_score",
  "ai.answers",
  "ai.tracked_prompts",
  "ai.engines",
  "ai.competitors",
  "ai.rank",
  "ai.rank_of",
  "ai.top_competitor",
  "ai.top_competitor_visibility",
  "ai.visibility_gap",
  "ai.prompts_invisible",
  "ai.prompt_coverage",
  "ai.top_source",
  "ai.best_engine",
  "ai.worst_engine",
  "tasks.open",
];

function digest(bundle: DataBundle): string {
  const ctx: ResolveCtx = { bundle };
  const lines = KEY_TOKENS.map((k) => `- ${k} (${TOKENS[k]?.label}): ${resolveToken(k, ctx).text}`);
  const brands = bundle.ai.brands.slice(0, 8).map((b) => `${b.isOwn ? "[YOU] " : ""}${b.name}: visibility ${b.visibility ?? "—"}%`);
  const engines = bundle.ai.engines.map((e) => `${e.label}: ${e.visibility ?? "—"}% (${e.answers} answers)`);
  const sources = bundle.ai.sources.slice(0, 8).map((s) => `${s.domain} (${s.citations} citations, ${s.contentType})`);
  const gaps = bundle.ai.prompts.filter((p) => p.category === "none").slice(0, 8).map((p) => p.text);
  const tops = [...bundle.ai.prompts].filter((p) => (p.visibility ?? 0) > 0).sort((a, b) => (b.visibility ?? 0) - (a.visibility ?? 0)).slice(0, 5).map((p) => `${p.text} (${p.visibility}%)`);
  return [
    "KEY NUMBERS:",
    ...lines,
    `BRANDS: ${brands.join("; ") || "none yet"}`,
    `ENGINES: ${engines.join("; ") || "none yet"}`,
    `TOP SOURCES: ${sources.join("; ") || "none yet"}`,
    `BEST PROMPTS: ${tops.join("; ") || "none yet"}`,
    `GAP PROMPTS (brand invisible): ${gaps.join("; ") || "none"}`,
    `PRAISE: ${bundle.ai.praise.slice(0, 3).map((s) => s.quote).join(" | ") || "none"}`,
    `CRITICISM: ${bundle.ai.criticism.slice(0, 3).map((s) => s.quote).join(" | ") || "none"}`,
    `OPEN TASKS: ${(bundle.other.tasks ?? []).slice(0, 5).map((t) => t.title).join("; ") || "none"}`,
  ].join("\n");
}

function catalogText(): string {
  const tokens = Object.entries(TOKENS)
    .filter(([k]) => !k.endsWith("_prev"))
    .map(([k, d]) => `${k} = ${d.label}`)
    .join("; ");
  const charts = Object.entries(CHARTS)
    .map(([k, d]) => `${k} (${d.label}; types: ${d.types.join("/")})`)
    .join("; ");
  const lists = Object.entries(LISTS)
    .map(([k, d]) => `${k} (${d.label})`)
    .join("; ");
  const tables = Object.entries(TABLES)
    .map(([k, d]) => `${k} (${d.label})`)
    .join("; ");
  return `TOKENS (use in text as {{key}} or as kpi/score metric): ${tokens}\nCHARTS (chart metric): ${charts}\nLISTS (list metric): ${lists}\nTABLES (table metric): ${tables}\nICONS: ${Object.keys(ICONS).join(", ")}`;
}

/* ───────────────────────────── Agent: design a slide ───────────────────────────── */

const agentElementSchema = z.object({
  kind: z.enum(["title", "text", "kpi", "chart", "list", "score", "card", "icon", "table"]),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  text: z.string().optional().describe("title/text: markup with **bold**, ==accent==, {{token.key}} and '- ' bullets"),
  size: z.number().optional().describe("font size in px (title 64-96, body 24-34)"),
  metric: z.string().optional().describe("kpi/score: token key; chart: chart key; list: list key; table: table key"),
  label: z.string().optional().describe("kpi/score label or chart title"),
  chartType: z.enum(CHART_TYPES).optional(),
  icon: z.string().optional(),
  color: z.enum(["text", "muted", "accent"]).optional(),
  align: z.enum(["left", "center", "right"]).optional(),
});

export const agentSlideSchema = z.object({
  name: z.string().describe("short slide name"),
  elements: z.array(agentElementSchema).max(30),
  notes: z.string().optional().describe("speaker notes"),
});
export type AgentSlide = z.infer<typeof agentSlideSchema>;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));

/** Converts the model's simplified slide into real, validated deck elements. */
export function agentSlideToSlide(a: AgentSlide, size: { w: number; h: number }): Slide {
  const els: SlideElement[] = [];
  for (const e of a.elements) {
    const x = clamp(e.x, 0, size.w - 20);
    const y = clamp(e.y, 0, size.h - 20);
    const box = { x, y, w: clamp(e.w, 20, size.w - x), h: clamp(e.h, 20, size.h - y) };
    const color = e.color ? `$${e.color}` : undefined;
    switch (e.kind) {
      case "title":
        els.push(heading(e.text ?? "Title", { ...box, size: clamp(e.size ?? 72, 32, 160), align: e.align, color }));
        break;
      case "text":
        els.push(text(e.text ?? "", { ...box, size: clamp(e.size ?? 28, 12, 120), align: e.align, color: color ?? "$text", lh: 1.4 }));
        break;
      case "kpi":
        if (e.metric && TOKENS[e.metric]) {
          const delta = TOKENS[`${e.metric}_delta`] ? `${e.metric}_delta` : undefined;
          els.push(kpi(e.metric, e.label ?? TOKENS[e.metric]!.label, { ...box, delta, valueSize: clamp(Math.min(box.h * 0.32, box.w * 0.2), 36, 160) }));
        }
        break;
      case "score":
        if (e.metric && TOKENS[e.metric]) els.push(score(e.metric, { ...box, label: e.label }));
        break;
      case "chart":
        if (e.metric && CHARTS[e.metric]) {
          const def = CHARTS[e.metric]!;
          const type = e.chartType && def.types.includes(e.chartType) ? e.chartType : def.defaultType;
          els.push(chart(e.metric, type, { ...box, fill: "$surface", radius: 32, title: e.label }));
        }
        break;
      case "list":
        if (e.metric && LISTS[e.metric]) {
          els.push(card({ ...box }));
          els.push(list(e.metric, { x: box.x + 36, y: box.y + 32, w: box.w - 72, h: box.h - 64, limit: clamp(Math.floor((box.h - 64) / 64), 2, 10), size: 24 }));
        }
        break;
      case "table":
        if (e.metric && TABLES[e.metric]) els.push(table({ ...box, source: e.metric, size: 22 }));
        break;
      case "card":
        els.push(card(box));
        break;
      case "icon":
        els.push(iconEl(e.icon && ICONS[e.icon] ? e.icon : "sparkles", { ...box, bg: "$surface2" }));
        break;
    }
  }
  return makeSlide(els, { name: a.name.slice(0, 80), notes: a.notes?.slice(0, 4000) });
}

const DESIGN_GUIDE = `You design slides for an AI-visibility (GEO) report builder. Canvas is 1920×1080 px.
Style: dark, premium pitch deck. Margins 112px. Eyebrow/title area y=92..310 (title size 64-80, may use ==accent== on 1-3 key words).
Content area y=340..950. Leave y>=990 empty (footer). Use cards (kind "card") behind lists/text groups, KPI tiles in rows of 3-4 (h 250-320),
charts in large panels (≥ 800×500). Prefer live data: KPI/score metrics and {{tokens}} in text instead of hard-coded numbers.
Only use keys from the catalog. Keep text short and persuasive; never invent numbers that are not tokens.`;

export async function agentDesignSlide(opts: {
  projectId: string;
  workspaceId: string;
  userId: string;
  prompt: string;
  bundle: DataBundle;
  size: { w: number; h: number };
}): Promise<{ slide: Slide; provider: string }> {
  const res = await runLlm({
    purpose: "reports.agent_slide",
    system: DESIGN_GUIDE,
    prompt: `${catalogText()}\n\nCURRENT DATA (for wording only; show numbers via tokens):\n${digest(opts.bundle)}\n\nCanvas: ${opts.size.w}×${opts.size.h}px.\n\nDesign this slide:\n${opts.prompt}`,
    schema: agentSlideSchema,
    projectId: opts.projectId,
    workspaceId: opts.workspaceId,
    userId: opts.userId,
    maxTokens: 8000,
    timeoutMs: 5 * 60_000,
  });
  return { slide: agentSlideToSlide(res.data, opts.size), provider: res.provider };
}

const markupSchema = z.object({ text: z.string().describe("markup: **bold**, ==accent==, {{token.key}}, '- ' bullets, newlines") });

export async function agentRewrite(opts: { projectId: string; workspaceId: string; userId: string; markup: string; instruction: string; bundle: DataBundle }) {
  const res = await runLlm({
    purpose: "reports.agent_rewrite",
    system:
      "You rewrite short slide copy for client-facing AI-visibility reports. Keep {{token.key}} placeholders exactly as they are (they are replaced with live data). Keep markup: **bold**, ==accent==, '- ' bullets. Return only the new copy.",
    prompt: `Data context:\n${digest(opts.bundle)}\n\nInstruction: ${opts.instruction}\n\nCopy to rewrite:\n${opts.markup}`,
    schema: markupSchema,
    projectId: opts.projectId,
    workspaceId: opts.workspaceId,
    userId: opts.userId,
    maxTokens: 2000,
    timeoutMs: 3 * 60_000,
  });
  return res.data.text.slice(0, 5000);
}

export async function agentSummarize(opts: { projectId: string; workspaceId: string; userId: string; bundle: DataBundle; focus?: string }) {
  const res = await runLlm({
    purpose: "reports.agent_summary",
    system:
      "You are a GEO strategist. Summarize the findings for a client slide: 3-5 bullets ('- ' prefix), max 18 words each, concrete and actionable. Reference numbers with {{token.key}} placeholders from the catalog instead of literal values where possible. Use **bold** for the key phrase of each bullet.",
    prompt: `${catalogText()}\n\nDATA:\n${digest(opts.bundle)}\n\n${opts.focus ? `Focus: ${opts.focus}` : "Summarize the most important findings."}`,
    schema: markupSchema,
    projectId: opts.projectId,
    workspaceId: opts.workspaceId,
    userId: opts.userId,
    maxTokens: 2000,
    timeoutMs: 3 * 60_000,
  });
  return res.data.text.slice(0, 5000);
}

/* ───────────────────────────── AI HTML reports ───────────────────────────── */

export function extractHtml(text: string): string {
  let t = text.trim();
  const fence = /```(?:html)?\s*([\s\S]*?)```/i.exec(t);
  if (fence && fence[1]!.toLowerCase().includes("<html")) t = fence[1]!.trim();
  const lower = t.toLowerCase();
  const start = Math.max(0, lower.indexOf("<!doctype") >= 0 ? lower.indexOf("<!doctype") : lower.indexOf("<html"));
  const end = lower.lastIndexOf("</html>");
  return end > start ? t.slice(start, end + 7) : t.slice(start);
}

export function summaryFrom(html: string): string {
  const meta = /<meta\s+name=["']description["']\s+content=["']([^"']{10,})["']/i.exec(html);
  if (meta) return meta[1]!.slice(0, 2500);
  const p = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(html);
  const txt = (p?.[1] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return txt.slice(0, 600);
}

function compactData(bundle: DataBundle) {
  return {
    brand: bundle.project.name,
    domain: bundle.project.domain,
    client: bundle.project.clientName,
    agency: bundle.agency.name,
    period: bundle.period,
    kpis: bundle.ai.current,
    previousKpis: bundle.ai.previous,
    answers: bundle.ai.answers,
    counts: bundle.ai.counts,
    brands: bundle.ai.brands.slice(0, 10).map((b) => ({ name: b.name, you: b.isOwn, visibility: b.visibility, mentionRate: b.mentionRate, position: b.avgPosition, sentiment: b.sentiment, shareOfVoice: b.shareOfVoice })),
    engines: bundle.ai.engines,
    topSources: bundle.ai.sources.slice(0, 12),
    sourceTypes: bundle.ai.sourceTypes,
    ownPages: bundle.ai.ownPages.slice(0, 8),
    bestPrompts: [...bundle.ai.prompts].filter((p) => (p.visibility ?? 0) > 0).sort((a, b) => (b.visibility ?? 0) - (a.visibility ?? 0)).slice(0, 10).map((p) => ({ prompt: p.text, visibility: p.visibility })),
    gapPrompts: bundle.ai.prompts.filter((p) => p.category === "none").slice(0, 12).map((p) => p.text),
    funnel: bundle.ai.funnel,
    topics: bundle.ai.topics,
    sentimentMix: bundle.ai.sentimentMix,
    praise: bundle.ai.praise.slice(0, 5),
    criticism: bundle.ai.criticism.slice(0, 5),
    weeklyTrend: bundle.ai.trend.filter((_, i, arr) => i % 7 === 0 || i === arr.length - 1).map((t) => ({ date: t.date, visibility: t.visibility })),
    tasks: bundle.other.tasks?.slice(0, 8) ?? null,
    siteAudit: bundle.other.audit,
    crawlability: bundle.other.crawlability,
    searchConsole: bundle.other.searchConsole,
    aiTraffic: bundle.other.aiTraffic,
  };
}

/** Job body: writes the HTML report with the LLM router and stores it. */
export async function generateHtmlReport(reportId: string, opts: { isCancelled?: () => Promise<boolean> } = {}) {
  const [row] = await db.select().from(reports).where(eq(reports.id, reportId)).limit(1);
  if (!row || row.kind !== "html") throw new Error("Report not found");
  await db.update(reports).set({ aiStatus: "running", aiError: null }).where(eq(reports.id, row.id));
  try {
    const bundle = await loadReportData(row.projectId, row.dateRange);
    const kit = await getBrandKit(row.workspaceId, row.projectId);
    const theme = themeFromBrandKit(kit.effective);
    let instructions = "";
    if (row.templateKey?.startsWith("tpl:")) {
      const [tpl] = await db.select().from(reportTemplates).where(eq(reportTemplates.id, row.templateKey.slice(4))).limit(1);
      if (tpl && tpl.workspaceId === row.workspaceId) instructions = tpl.instructions ?? "";
    }
    const system = `You are a senior GEO / SEO analyst writing a client-facing report as ONE complete, self-contained HTML document.
Rules:
- Output ONLY the HTML document, starting with <!doctype html> and ending with </html>. No markdown fences, no commentary.
- Inline <style> only. NO <script>, NO external resources (no web fonts, no remote images, no links to CSS/JS). Use system font stacks.
- Use CSS variables: --accent: ${theme.colors.accent}; --bg: #ffffff; --ink: #111512. Clean, modern, print-friendly layout (max-width 960px, generous spacing, tables with tabular numbers, simple inline SVG bar charts are welcome).
- Include <meta name="description" content="one-sentence verdict">.
- Use only the numbers provided in DATA. Never invent metrics. When data is missing, say so plainly.
- Structure: title with brand + period, a one-line verdict, key metrics, findings with evidence, prioritized recommendations, and a short "How this report was made" section (data source: AutoSEO AI visibility tracking; metric definitions).
- Written by ${bundle.agency.name || "the agency"} for ${bundle.project.clientName}.`;
    const prompt = `${instructions ? `TEMPLATE INSTRUCTIONS:\n${instructions}\n\n` : ""}REQUEST:\n${row.prompt ?? "Write a monthly AI visibility report."}\n\nTITLE: ${row.title}\n\nDATA (JSON):\n${JSON.stringify(compactData(bundle))}`;
    const res = await runLlm({
      purpose: "reports.html_report",
      system,
      prompt,
      projectId: row.projectId,
      workspaceId: row.workspaceId,
      userId: row.createdBy,
      maxTokens: 32000,
      timeoutMs: 15 * 60_000,
    });
    if (await opts.isCancelled?.().catch(() => false)) return { ok: false, cancelled: true };
    const html = extractHtml(res.text);
    await saveHtmlReport({
      projectId: row.projectId,
      workspaceId: row.workspaceId,
      title: row.title,
      html,
      summary: summaryFrom(html),
      reportId: row.id,
      userId: row.createdBy,
    });
    await db.update(reports).set({ createdByLabel: res.provider === "agent" ? `Local agent (${res.model})` : `AutoSEO app · ${res.model}` }).where(eq(reports.id, row.id));
    return { ok: true, bytes: Buffer.byteLength(html, "utf8"), provider: res.provider };
  } catch (err) {
    // a cancelled/superseded run must not overwrite the result of a newer one
    if (await opts.isCancelled?.().catch(() => false)) throw err;
    const message = err instanceof Error ? err.message : String(err);
    await db.update(reports).set({ aiStatus: "failed", aiError: message.slice(0, 1000) }).where(eq(reports.id, row.id));
    throw err;
  }
}
