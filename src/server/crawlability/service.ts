import "server-only";
/**
 * Crawlability service (reusable by actions, jobs and the MCP server).
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { crawlabilityChecks, projects, siteAuditPages, siteAudits } from "@/server/db/schema";
import { enqueueJob } from "@/server/jobs/queue";
import { AiNotConfiguredError, availableLlmProviders, runLlm } from "@/server/ai/llm";
import { normalizeStartUrlInput, CrawlTargetBlockedError, InvalidUrlError } from "../audit-crawler/url-policy";
import { isSameOrigin } from "../audit-crawler/url-utils";
import { runCrawlabilityChecks } from "./checks";
import { generateLlmsTxt, validateLlmsTxt } from "./llms-txt";
import { scoreCrawlability } from "./scoring";
import type { CrawlabilityResult } from "./types";

export const CRAWLABILITY_JOB = "audit.crawlability";
export const LLMS_TXT_JOB = "audit.llms_txt";

export type CrawlabilityActor = { projectId: string; workspaceId?: string | null; userId?: string | null };

export class CrawlabilityError extends Error {
  constructor(
    message: string,
    public code: "VALIDATION_ERROR" | "CRAWL_TARGET_BLOCKED" | "ALREADY_RUNNING" | "NOT_FOUND" | "AI_NOT_CONFIGURED",
  ) {
    super(message);
  }
}

export type CheckRow = typeof crawlabilityChecks.$inferSelect;

function originFor(project: typeof projects.$inferSelect): string {
  return project.websiteUrl || `https://${project.domain}`;
}

function validateExtraUrls(urls: string[] | undefined, projectOrigin: string): string[] {
  const out: string[] = [];
  for (const raw of (urls ?? []).map((u) => u.trim()).filter(Boolean).slice(0, 10)) {
    let url: string;
    try {
      url = normalizeStartUrlInput(raw);
    } catch (err) {
      if (err instanceof CrawlTargetBlockedError) throw new CrawlabilityError(`${raw}: ${err.message}`, "CRAWL_TARGET_BLOCKED");
      throw new CrawlabilityError(`${raw}: not a valid URL.`, "VALIDATION_ERROR");
    }
    const host = new URL(projectOrigin).hostname.replace(/^www\./, "");
    const h = new URL(url).hostname.replace(/^www\./, "");
    if (h !== host && !h.endsWith(`.${host}`) && !isSameOrigin(url, projectOrigin)) {
      throw new CrawlabilityError(`${raw} is not on ${host}. Only pages of the project's site can be checked.`, "VALIDATION_ERROR");
    }
    out.push(url);
  }
  return out;
}

export async function startCrawlabilityCheck(
  actor: CrawlabilityActor,
  input: { urls?: string[]; trigger?: "manual" | "scheduled" | "api" | "mcp"; scheduleId?: string | null } = {},
): Promise<{ checkId: string }> {
  const [project] = await db.select().from(projects).where(eq(projects.id, actor.projectId)).limit(1);
  if (!project) throw new CrawlabilityError("Project not found.", "NOT_FOUND");
  const origin = originFor(project);
  try {
    normalizeStartUrlInput(origin);
  } catch (err) {
    if (err instanceof InvalidUrlError || err instanceof CrawlTargetBlockedError) throw new CrawlabilityError(err.message, "VALIDATION_ERROR");
    throw err;
  }
  const urls = validateExtraUrls(input.urls, origin);
  const [running] = await db
    .select({ id: crawlabilityChecks.id })
    .from(crawlabilityChecks)
    .where(and(eq(crawlabilityChecks.projectId, actor.projectId), inArray(crawlabilityChecks.status, ["queued", "running"])))
    .limit(1);
  if (running) throw new CrawlabilityError("A crawlability check is already running for this project.", "ALREADY_RUNNING");
  const [row] = await db
    .insert(crawlabilityChecks)
    .values({
      projectId: actor.projectId,
      origin,
      urls,
      status: "queued",
      trigger: input.trigger ?? "manual",
      scheduleId: input.scheduleId ?? null,
      createdBy: actor.userId ?? null,
    })
    .returning();
  await enqueueJob(CRAWLABILITY_JOB, { checkId: row!.id }, { projectId: actor.projectId, maxAttempts: 2, priority: 50, dedupeKey: `crawlability:${row!.id}` });
  return { checkId: row!.id };
}

/** Executes a check (job body). Also usable synchronously by MCP tools after `startCrawlabilityCheck`. */
export async function runCrawlabilityCheck(checkId: string): Promise<CheckRow | null> {
  const [check] = await db.select().from(crawlabilityChecks).where(eq(crawlabilityChecks.id, checkId)).limit(1);
  if (!check || !["queued", "running"].includes(check.status)) return check ?? null;
  await db.update(crawlabilityChecks).set({ status: "running", startedAt: new Date(), error: null }).where(eq(crawlabilityChecks.id, checkId));
  try {
    const base = await runCrawlabilityChecks({ origin: check.origin, urls: check.urls }, async (step, done, total) => {
      await db.update(crawlabilityChecks).set({ progress: { step, done, total } }).where(eq(crawlabilityChecks.id, checkId));
    });
    const { score, categories, findings } = scoreCrawlability(base);
    const result: CrawlabilityResult = { ...base, categories, findings };
    const [done] = await db
      .update(crawlabilityChecks)
      .set({
        status: "completed",
        origin: base.origin,
        score,
        scores: Object.fromEntries(categories.map((c) => [c.key, c.score])),
        result: result as unknown as Record<string, unknown>,
        progress: { step: "Done", done: 1, total: 1 },
        completedAt: new Date(),
      })
      .where(eq(crawlabilityChecks.id, checkId))
      .returning();
    if (done) {
      const { afterCrawlabilityCompleted } = await import("../audit-crawler/notify");
      await afterCrawlabilityCompleted(done).catch((err) => console.error("[crawlability] notify failed", err));
    }
    return done ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(crawlabilityChecks)
      .set({ status: "failed", error: message.slice(0, 1000), completedAt: new Date() })
      .where(eq(crawlabilityChecks.id, checkId));
    throw err;
  }
}

export async function listCrawlabilityChecks(projectId: string, limit = 30) {
  return db
    .select({
      id: crawlabilityChecks.id,
      status: crawlabilityChecks.status,
      trigger: crawlabilityChecks.trigger,
      origin: crawlabilityChecks.origin,
      score: crawlabilityChecks.score,
      scores: crawlabilityChecks.scores,
      error: crawlabilityChecks.error,
      createdAt: crawlabilityChecks.createdAt,
      completedAt: crawlabilityChecks.completedAt,
    })
    .from(crawlabilityChecks)
    .where(eq(crawlabilityChecks.projectId, projectId))
    .orderBy(desc(crawlabilityChecks.createdAt))
    .limit(limit);
}

export async function getCrawlabilityCheck(projectId: string, checkId: string): Promise<(CheckRow & { parsed: CrawlabilityResult | null }) | null> {
  const [row] = await db
    .select()
    .from(crawlabilityChecks)
    .where(and(eq(crawlabilityChecks.id, checkId), eq(crawlabilityChecks.projectId, projectId)))
    .limit(1);
  if (!row) return null;
  return { ...row, parsed: (row.result as unknown as CrawlabilityResult) ?? null };
}

export async function getLatestCrawlabilityCheck(projectId: string) {
  const [row] = await db
    .select({ id: crawlabilityChecks.id })
    .from(crawlabilityChecks)
    .where(eq(crawlabilityChecks.projectId, projectId))
    .orderBy(desc(crawlabilityChecks.createdAt))
    .limit(1);
  return row ? getCrawlabilityCheck(projectId, row.id) : null;
}

/* ───────────────────────────── llms.txt generator ───────────────────────────── */

async function collectPagesForLlms(check: CheckRow & { parsed: CrawlabilityResult | null }) {
  // Prefer titles/descriptions from the latest completed site audit of the project.
  const [audit] = await db
    .select({ id: siteAudits.id })
    .from(siteAudits)
    .where(and(eq(siteAudits.projectId, check.projectId), eq(siteAudits.status, "completed")))
    .orderBy(desc(siteAudits.startedAt))
    .limit(1);
  const pages: Array<{ url: string; title: string | null; description: string | null }> = [];
  if (audit) {
    const rows = await db
      .select({ url: siteAuditPages.url, title: siteAuditPages.title, description: siteAuditPages.metaDescription, statusCode: siteAuditPages.statusCode, isIndexable: siteAuditPages.isIndexable, depth: siteAuditPages.crawlDepth })
      .from(siteAuditPages)
      .where(eq(siteAuditPages.auditId, audit.id))
      .limit(3000);
    for (const r of rows) {
      if (r.statusCode && r.statusCode >= 200 && r.statusCode < 300 && r.isIndexable) pages.push({ url: r.url, title: r.title, description: r.description });
    }
  }
  if (!pages.length && check.parsed) {
    for (const url of check.parsed.sitemap.sampleUrls) pages.push({ url, title: null, description: null });
    for (const p of check.parsed.pages) {
      const existing = pages.find((x) => x.url === p.url);
      if (existing) {
        existing.title = p.signals?.title ?? null;
        existing.description = p.signals?.metaDescription ?? null;
      } else pages.unshift({ url: p.finalUrl ?? p.url, title: p.signals?.title ?? null, description: p.signals?.metaDescription ?? null });
    }
  }
  return pages;
}

export async function generateLlmsTxtTemplate(projectId: string, checkId: string) {
  const check = await getCrawlabilityCheck(projectId, checkId);
  if (!check) throw new CrawlabilityError("Check not found.", "NOT_FOUND");
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  const pages = await collectPagesForLlms(check);
  const home = check.parsed?.pages[0]?.signals;
  const text = generateLlmsTxt({
    siteName: project?.name ?? new URL(check.origin).hostname,
    summary: project?.description || home?.metaDescription || null,
    origin: check.parsed?.origin ?? check.origin,
    pages,
  });
  await db
    .update(crawlabilityChecks)
    .set({ llmsTxtDraft: text, llmsTxtDraftSource: "template", llmsTxtStatus: "idle", llmsTxtError: null })
    .where(eq(crawlabilityChecks.id, checkId));
  return text;
}

export async function aiLlmsAvailable(): Promise<boolean> {
  return (await availableLlmProviders()).length > 0;
}

export async function startAiLlmsTxt(actor: CrawlabilityActor, checkId: string) {
  const check = await getCrawlabilityCheck(actor.projectId, checkId);
  if (!check) throw new CrawlabilityError("Check not found.", "NOT_FOUND");
  if (!(await aiLlmsAvailable())) {
    throw new CrawlabilityError("No AI provider is available. Connect a local agent or add an API key in Admin → AI Providers.", "AI_NOT_CONFIGURED");
  }
  await db.update(crawlabilityChecks).set({ llmsTxtStatus: "running", llmsTxtError: null }).where(eq(crawlabilityChecks.id, checkId));
  await enqueueJob(LLMS_TXT_JOB, { checkId, userId: actor.userId ?? null }, { projectId: actor.projectId, maxAttempts: 1, dedupeKey: `llms-txt:${checkId}` });
}

/** Job body: AI-written llms.txt from the site structure (runLlm: local agent first, API fallback). */
export async function runAiLlmsTxt(checkId: string, userId: string | null) {
  const [row] = await db.select().from(crawlabilityChecks).where(eq(crawlabilityChecks.id, checkId)).limit(1);
  if (!row) return;
  const check = { ...row, parsed: (row.result as unknown as CrawlabilityResult) ?? null };
  const [project] = await db.select().from(projects).where(eq(projects.id, row.projectId)).limit(1);
  try {
    const pages = (await collectPagesForLlms(check)).slice(0, 250);
    const home = check.parsed?.pages[0]?.signals;
    const origin = check.parsed?.origin ?? check.origin;
    const prompt = [
      `Write an llms.txt file (llmstxt.org format) for the website ${origin}.`,
      `Brand / site name: ${project?.name ?? new URL(origin).hostname}.`,
      project?.description ? `Description: ${project.description}` : home?.metaDescription ? `Homepage description: ${home.metaDescription}` : "",
      "",
      "Rules:",
      "- Start with `# <Site name>`, then a one-sentence `> summary` of what the company offers and for whom.",
      "- Optionally 1–3 short lines of key facts (products, audience, markets) without marketing fluff.",
      "- Then `## <Section>` groups (e.g. Products, Solutions, Docs, Guides, Company). Only use URLs from the list below — never invent URLs.",
      "- Each link: `- [Clear page title](absolute URL): one short factual note about what the page contains`.",
      "- Prioritize pages that answer customer questions (products, pricing, guides, FAQs, comparisons). At most ~60 links.",
      "- Put legal/account pages (imprint, privacy, terms, login, cart) under `## Optional` or leave them out.",
      "- Write in the site's language when obvious from the titles.",
      "- Output ONLY the markdown file content, no explanations or code fences.",
      "",
      "Pages (URL | title | description):",
      ...pages.map((p) => `${p.url} | ${(p.title ?? "").slice(0, 100)} | ${(p.description ?? "").slice(0, 140)}`),
    ]
      .filter((l) => l !== null)
      .join("\n");
    const res = await runLlm({ purpose: "crawlability.llms_txt", prompt, projectId: row.projectId, workspaceId: project?.workspaceId ?? null, userId, maxTokens: 6000, effort: "medium" });
    let text = String(res.data ?? res.text).trim();
    text = text.replace(/^```(?:markdown|md)?\s*/i, "").replace(/```\s*$/, "").trim() + "\n";
    const validation = validateLlmsTxt(text);
    if (!validation.title) throw new Error("The AI response was not a valid llms.txt (missing # title).");
    await db
      .update(crawlabilityChecks)
      .set({ llmsTxtDraft: text, llmsTxtDraftSource: "ai", llmsTxtStatus: "idle", llmsTxtError: null })
      .where(eq(crawlabilityChecks.id, checkId));
  } catch (err) {
    const message = err instanceof AiNotConfiguredError ? err.message : err instanceof Error ? err.message : String(err);
    await db.update(crawlabilityChecks).set({ llmsTxtStatus: "failed", llmsTxtError: message.slice(0, 1000) }).where(eq(crawlabilityChecks.id, checkId));
  }
}

export async function deleteCrawlabilityCheck(projectId: string, checkId: string) {
  await db.delete(crawlabilityChecks).where(and(eq(crawlabilityChecks.id, checkId), eq(crawlabilityChecks.projectId, projectId)));
}
