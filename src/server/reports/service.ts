import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { projects, reportTemplates, reports, users, type ReportDateRange } from "@/server/db/schema";
import { ActionError } from "@/server/auth/guards";
import { buildLibraryDeck, getLibraryTemplate } from "@/features/reports/lib/templates/library";
import { brandDots, themeFromBrandKit } from "@/features/reports/lib/theme";
import { countDeck, deckSchema, parseDeck, type Deck, type Slide, type Theme } from "@/features/reports/lib/types";
import { cloneSlide } from "@/features/reports/lib/build";
import type { DataBundle } from "@/features/reports/lib/bundle";
import { getBrandKit } from "./brand";
import { loadReportData } from "./data";
import { SHARE_PASSWORD_MIN, hashSharePassword, mintShareToken } from "./share";

export type ReportRow = typeof reports.$inferSelect;

export type ReportListItem = {
  id: string;
  kind: "deck" | "html";
  title: string;
  subtitle: string | null;
  clientName: string;
  status: "draft" | "published";
  slideCount: number;
  chartCount: number;
  brandColors: string[];
  templateKey: string | null;
  aiStatus: ReportRow["aiStatus"];
  aiError: string | null;
  sizeBytes: number;
  shareEnabled: boolean;
  createdByName: string | null;
  createdByLabel: string | null;
  updatedAt: string;
  createdAt: string;
  /** First slide + theme for the live thumbnail (decks only). */
  preview: { slide: Slide; theme: Theme; size: Deck["size"] } | null;
};

export const MAX_REPORTS_PER_PROJECT = 2000;
export const MAX_HTML_BYTES = 500_000;

function deckMeta(deck: Deck) {
  const { slides, charts } = countDeck(deck);
  return { slideCount: slides, chartCount: charts, brandColors: brandDots(deck.theme) };
}

export async function listReports(projectId: string): Promise<ReportListItem[]> {
  // Only the first slide + theme are needed for thumbnails; never load full decks/HTML/snapshots here.
  const rows = await db
    .select({
      id: reports.id,
      kind: reports.kind,
      title: reports.title,
      subtitle: reports.subtitle,
      status: reports.status,
      slideCount: reports.slideCount,
      chartCount: reports.chartCount,
      brandColors: reports.brandColors,
      templateKey: reports.templateKey,
      aiStatus: reports.aiStatus,
      aiError: reports.aiError,
      sizeBytes: reports.sizeBytes,
      shareEnabled: reports.shareEnabled,
      createdByLabel: reports.createdByLabel,
      updatedAt: reports.updatedAt,
      createdAt: reports.createdAt,
      preview: sql<Record<string, unknown> | null>`CASE WHEN ${reports.kind} = 'deck' THEN jsonb_build_object('version', 1, 'format', ${reports.document}->'format', 'size', ${reports.document}->'size', 'theme', ${reports.document}->'theme', 'slides', jsonb_build_array(${reports.document}->'slides'->0)) END`,
      createdByName: users.name,
      createdByEmail: users.email,
      projectName: projects.name,
    })
    .from(reports)
    .leftJoin(users, eq(users.id, reports.createdBy))
    .innerJoin(projects, eq(projects.id, reports.projectId))
    .where(eq(reports.projectId, projectId))
    .orderBy(desc(reports.updatedAt))
    .limit(500);
  return rows.map((r) => {
    const deck = r.preview ? parseDeck(r.preview) : null;
    return {
      id: r.id,
      kind: r.kind,
      title: r.title,
      subtitle: r.subtitle,
      clientName: r.projectName,
      status: r.status,
      slideCount: r.slideCount,
      chartCount: r.chartCount,
      brandColors: r.brandColors,
      templateKey: r.templateKey,
      aiStatus: r.aiStatus,
      aiError: r.aiError,
      sizeBytes: r.sizeBytes,
      shareEnabled: r.shareEnabled,
      createdByName: r.createdByName ?? r.createdByEmail ?? null,
      createdByLabel: r.createdByLabel,
      updatedAt: r.updatedAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
      preview: deck && deck.slides[0] ? { slide: deck.slides[0], theme: deck.theme, size: deck.size } : null,
    };
  });
}

export async function getReport(projectId: string, reportId: string): Promise<ReportRow | null> {
  const [row] = await db
    .select()
    .from(reports)
    .where(and(eq(reports.id, reportId), eq(reports.projectId, projectId)))
    .limit(1);
  return row ?? null;
}

export async function requireReport(projectId: string, reportId: string): Promise<ReportRow> {
  const row = await getReport(projectId, reportId);
  if (!row) throw new ActionError("Report not found.", "not_found");
  return row;
}

export function reportDeck(row: ReportRow): Deck | null {
  return row.kind === "deck" ? parseDeck(row.document) : null;
}

async function assertCapacity(projectId: string) {
  const [c] = await db.select({ c: sql<number>`count(*)::int` }).from(reports).where(eq(reports.projectId, projectId));
  if ((c?.c ?? 0) >= MAX_REPORTS_PER_PROJECT) throw new ActionError("This project has reached the maximum number of reports.", "conflict");
}

export async function themeForProject(workspaceId: string, projectId: string): Promise<Theme> {
  const kit = await getBrandKit(workspaceId, projectId);
  return themeFromBrandKit(kit.effective);
}

/** Creates a slide deck from a library template key or a workspace template id (`tpl:<id>`). */
export async function createDeckReport(opts: {
  projectId: string;
  workspaceId: string;
  userId: string;
  title: string;
  subtitle?: string | null;
  template: string;
  dateRange?: ReportDateRange;
}): Promise<ReportRow> {
  await assertCapacity(opts.projectId);
  let deck: Deck;
  if (opts.template.startsWith("tpl:")) {
    const [tpl] = await db
      .select()
      .from(reportTemplates)
      .where(and(eq(reportTemplates.id, opts.template.slice(4)), eq(reportTemplates.workspaceId, opts.workspaceId)))
      .limit(1);
    const parsed = tpl ? parseDeck(tpl.document) : null;
    if (!tpl || !parsed) throw new ActionError("Template not found.", "not_found");
    deck = { ...parsed, slides: parsed.slides.map(cloneSlide) };
  } else {
    if (!getLibraryTemplate(opts.template)) throw new ActionError("Unknown template.", "invalid");
    deck = buildLibraryDeck(opts.template, await themeForProject(opts.workspaceId, opts.projectId));
  }
  const [row] = await db
    .insert(reports)
    .values({
      projectId: opts.projectId,
      workspaceId: opts.workspaceId,
      kind: "deck",
      title: opts.title,
      subtitle: opts.subtitle ?? null,
      templateKey: opts.template,
      document: deck as unknown as Record<string, unknown>,
      dateRange: opts.dateRange ?? { preset: "30d" },
      ...deckMeta(deck),
      createdBy: opts.userId,
      updatedBy: opts.userId,
      createdByLabel: "AutoSEO app",
    })
    .returning();
  return row!;
}

/** Saves the deck document with optimistic concurrency (baseVersion must match unless forced). */
export async function saveDeck(opts: {
  projectId: string;
  reportId: string;
  deck: unknown;
  baseVersion: number;
  force?: boolean;
  userId: string;
  title?: string;
  dateRange?: ReportDateRange;
}): Promise<{ version: number; updatedAt: string }> {
  const deck = deckSchema.parse(opts.deck);
  const size = JSON.stringify(deck).length;
  if (size > 8_000_000) throw new ActionError("This deck is too large to save (8 MB limit).", "invalid");
  const conds = [eq(reports.id, opts.reportId), eq(reports.projectId, opts.projectId), eq(reports.kind, "deck")];
  if (!opts.force) conds.push(eq(reports.version, opts.baseVersion));
  const [row] = await db
    .update(reports)
    .set({
      document: deck as unknown as Record<string, unknown>,
      ...deckMeta(deck),
      ...(opts.title ? { title: opts.title } : {}),
      ...(opts.dateRange ? { dateRange: opts.dateRange } : {}),
      version: sql`${reports.version} + 1`,
      updatedBy: opts.userId,
      updatedAt: new Date(),
    })
    .where(and(...conds))
    .returning({ version: reports.version, updatedAt: reports.updatedAt });
  if (!row) {
    const exists = await getReport(opts.projectId, opts.reportId);
    if (!exists) throw new ActionError("Report not found.", "not_found");
    throw new ActionError("This report was changed in another tab or by a teammate. Reload to get the latest version, or overwrite it.", "conflict");
  }
  return { version: row.version, updatedAt: row.updatedAt.toISOString() };
}

export async function updateReportMeta(
  projectId: string,
  reportId: string,
  patch: { title?: string; subtitle?: string | null; dateRange?: ReportDateRange },
  userId: string,
) {
  const [row] = await db
    .update(reports)
    .set({ ...patch, updatedBy: userId, updatedAt: new Date() })
    .where(and(eq(reports.id, reportId), eq(reports.projectId, projectId)))
    .returning();
  if (!row) throw new ActionError("Report not found.", "not_found");
  return row;
}

export async function duplicateReport(opts: { projectId: string; reportId: string; userId: string; targetProjectId?: string; workspaceId: string }) {
  const src = await requireReport(opts.projectId, opts.reportId);
  const target = opts.targetProjectId ?? opts.projectId;
  await assertCapacity(target);
  const [row] = await db
    .insert(reports)
    .values({
      projectId: target,
      workspaceId: opts.workspaceId,
      kind: src.kind,
      title: target === opts.projectId ? `${src.title} (copy)` : src.title,
      subtitle: src.subtitle,
      templateKey: src.templateKey,
      document: src.kind === "deck" ? (src.document as Record<string, unknown>) : null,
      dateRange: src.dateRange,
      slideCount: src.slideCount,
      chartCount: src.chartCount,
      brandColors: src.brandColors,
      html: src.html,
      summary: src.summary,
      prompt: src.prompt,
      aiStatus: src.kind === "html" ? (src.html ? "ready" : "idle") : "idle",
      sizeBytes: src.sizeBytes,
      createdBy: opts.userId,
      updatedBy: opts.userId,
      createdByLabel: "AutoSEO app",
    })
    .returning();
  return row!;
}

export async function deleteReport(projectId: string, reportId: string) {
  const res = await db
    .delete(reports)
    .where(and(eq(reports.id, reportId), eq(reports.projectId, projectId)))
    .returning({ id: reports.id });
  if (!res.length) throw new ActionError("Report not found.", "not_found");
}

/** Publishes (status) and, in snapshot mode, freezes the data bundle. */
export async function setPublished(projectId: string, reportId: string, published: boolean, userId: string) {
  const row = await requireReport(projectId, reportId);
  let snapshot: { bundle: DataBundle; capturedAt: string } | null = null;
  if (published && row.kind === "deck" && row.shareMode === "snapshot") {
    snapshot = { bundle: await loadReportData(projectId, row.dateRange), capturedAt: new Date().toISOString() };
  }
  const [updated] = await db
    .update(reports)
    .set({
      status: published ? "published" : "draft",
      publishedAt: published ? new Date() : row.publishedAt,
      ...(snapshot ? { snapshot: snapshot as unknown as Record<string, unknown>, snapshotAt: new Date() } : {}),
      updatedBy: userId,
    })
    .where(eq(reports.id, row.id))
    .returning();
  return updated!;
}

export type ShareSettingsInput = {
  enabled: boolean;
  /** undefined = keep, null = remove, string = set */
  password?: string | null;
  expiresAt?: string | null;
  mode?: "live" | "snapshot";
  refreshSnapshot?: boolean;
};

export async function updateShare(projectId: string, reportId: string, input: ShareSettingsInput, userId: string) {
  const row = await requireReport(projectId, reportId);
  const set: Partial<typeof reports.$inferInsert> = { shareEnabled: input.enabled, updatedBy: userId };
  if (input.enabled && !row.shareToken) {
    set.shareToken = mintShareToken();
    set.sharedAt = new Date();
  }
  if (input.password === null) set.sharePasswordHash = null;
  else if (typeof input.password === "string" && input.password.length) {
    if (input.password.length < SHARE_PASSWORD_MIN) throw new ActionError(`Share passwords need at least ${SHARE_PASSWORD_MIN} characters.`, "invalid");
    set.sharePasswordHash = await hashSharePassword(input.password);
  }
  if (input.expiresAt !== undefined) set.shareExpiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  if (input.mode) set.shareMode = input.mode;
  const mode = input.mode ?? row.shareMode;
  if (row.kind === "deck" && mode === "snapshot" && (input.refreshSnapshot || !row.snapshot || (input.mode === "snapshot" && row.shareMode !== "snapshot"))) {
    set.snapshot = { bundle: await loadReportData(projectId, row.dateRange), capturedAt: new Date().toISOString() } as unknown as Record<string, unknown>;
    set.snapshotAt = new Date();
  }
  const [updated] = await db.update(reports).set(set).where(eq(reports.id, row.id)).returning();
  return updated!;
}

/** Revokes the link: disables sharing and rotates the token so the old URL is dead forever. */
export async function revokeShare(projectId: string, reportId: string, userId: string) {
  const row = await requireReport(projectId, reportId);
  const [updated] = await db
    .update(reports)
    .set({ shareEnabled: false, shareToken: null, sharedAt: null, sharePasswordHash: null, updatedBy: userId })
    .where(eq(reports.id, row.id))
    .returning();
  return updated!;
}

export async function getReportByShareToken(token: string) {
  const [row] = await db
    .select({ r: reports, projectName: projects.name, projectDomain: projects.domain, archived: projects.archived })
    .from(reports)
    .innerJoin(projects, eq(projects.id, reports.projectId))
    .where(eq(reports.shareToken, token))
    .limit(1);
  if (!row || !row.r.shareEnabled || row.archived) return null;
  if (row.r.shareExpiresAt && row.r.shareExpiresAt.getTime() < Date.now()) return null;
  return row;
}

export async function countShareView(reportId: string) {
  await db
    .update(reports)
    .set({ shareViews: sql`${reports.shareViews} + 1`, updatedAt: sql`${reports.updatedAt}` })
    .where(eq(reports.id, reportId));
}

/* ───────────────────────────── Templates (My Templates) ───────────────────────────── */

export async function listTemplates(workspaceId: string) {
  const rows = await db
    .select()
    .from(reportTemplates)
    .where(eq(reportTemplates.workspaceId, workspaceId))
    .orderBy(desc(reportTemplates.updatedAt))
    .limit(200);
  return rows.map((t) => {
    const deck = t.kind === "deck" ? parseDeck(t.document) : null;
    return {
      id: t.id,
      kind: t.kind,
      name: t.name,
      description: t.description,
      instructions: t.instructions,
      slideCount: t.slideCount,
      updatedAt: t.updatedAt.toISOString(),
      preview: deck && deck.slides[0] ? { slide: deck.slides[0], theme: deck.theme, size: deck.size } : null,
    };
  });
}
export type TemplateListItem = Awaited<ReturnType<typeof listTemplates>>[number];

export async function saveAsTemplate(opts: { projectId: string; reportId: string; workspaceId: string; userId: string; name: string; description?: string | null }) {
  const row = await requireReport(opts.projectId, opts.reportId);
  const [c] = await db.select({ c: sql<number>`count(*)::int` }).from(reportTemplates).where(eq(reportTemplates.workspaceId, opts.workspaceId));
  if ((c?.c ?? 0) >= 200) throw new ActionError("Template limit reached (200 per workspace).", "conflict");
  if (row.kind === "deck") {
    const deck = reportDeck(row);
    if (!deck) throw new ActionError("This report has no valid slides to save.", "invalid");
    const [tpl] = await db
      .insert(reportTemplates)
      .values({
        workspaceId: opts.workspaceId,
        kind: "deck",
        name: opts.name,
        description: opts.description ?? null,
        document: deck as unknown as Record<string, unknown>,
        slideCount: deck.slides.length,
        sourceReportId: row.id,
        createdBy: opts.userId,
      })
      .returning();
    return tpl!;
  }
  const [tpl] = await db
    .insert(reportTemplates)
    .values({
      workspaceId: opts.workspaceId,
      kind: "html",
      name: opts.name,
      description: opts.description ?? null,
      instructions: row.prompt ?? "",
      sourceReportId: row.id,
      createdBy: opts.userId,
    })
    .returning();
  return tpl!;
}

export async function createHtmlTemplate(opts: { workspaceId: string; userId: string; name: string; description?: string | null; instructions: string }) {
  const [tpl] = await db
    .insert(reportTemplates)
    .values({ workspaceId: opts.workspaceId, kind: "html", name: opts.name, description: opts.description ?? null, instructions: opts.instructions, createdBy: opts.userId })
    .returning();
  return tpl!;
}

export async function updateTemplate(workspaceId: string, templateId: string, patch: { name?: string; description?: string | null; instructions?: string }) {
  const [tpl] = await db
    .update(reportTemplates)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(reportTemplates.id, templateId), eq(reportTemplates.workspaceId, workspaceId)))
    .returning();
  if (!tpl) throw new ActionError("Template not found.", "not_found");
  return tpl;
}

export async function deleteTemplate(workspaceId: string, templateId: string) {
  const res = await db
    .delete(reportTemplates)
    .where(and(eq(reportTemplates.id, templateId), eq(reportTemplates.workspaceId, workspaceId)))
    .returning({ id: reportTemplates.id });
  if (!res.length) throw new ActionError("Template not found.", "not_found");
}

export async function getTemplate(workspaceId: string, templateId: string) {
  const [tpl] = await db
    .select()
    .from(reportTemplates)
    .where(and(eq(reportTemplates.id, templateId), eq(reportTemplates.workspaceId, workspaceId)))
    .limit(1);
  return tpl ?? null;
}

/* ───────────────────────────── AI HTML reports ───────────────────────────── */

export async function createHtmlReport(opts: {
  projectId: string;
  workspaceId: string;
  userId: string | null;
  title: string;
  prompt: string;
  templateId?: string | null;
  dateRange?: ReportDateRange;
  createdByLabel?: string;
}) {
  await assertCapacity(opts.projectId);
  const kit = await getBrandKit(opts.workspaceId, opts.projectId);
  const theme = themeFromBrandKit(kit.effective);
  const [row] = await db
    .insert(reports)
    .values({
      projectId: opts.projectId,
      workspaceId: opts.workspaceId,
      kind: "html",
      title: opts.title,
      prompt: opts.prompt,
      templateKey: opts.templateId ? `tpl:${opts.templateId}` : "ai",
      dateRange: opts.dateRange ?? { preset: "30d" },
      brandColors: brandDots(theme),
      aiStatus: "queued",
      createdBy: opts.userId,
      updatedBy: opts.userId,
      createdByLabel: opts.createdByLabel ?? "AutoSEO app",
    })
    .returning();
  return row!;
}

/** Validation shared by the AI job and external callers (MCP `save_report`). */
export function validateReportHtml(html: string): string | null {
  const bytes = Buffer.byteLength(html, "utf8");
  if (bytes > MAX_HTML_BYTES) return `The HTML is ${Math.ceil(bytes / 1000)} KB; the limit is ${Math.floor(MAX_HTML_BYTES / 1000)} KB.`;
  const trimmed = html.trim().toLowerCase();
  if (!trimmed.includes("<html") || !trimmed.endsWith("</html>")) return "The HTML has no closing </html>; the model stopped early.";
  return null;
}

/**
 * Saves an agent-written HTML report (used by the AI job and available for the MCP/API module:
 * pass `reportId` to replace in place).
 */
export async function saveHtmlReport(opts: {
  projectId: string;
  workspaceId: string;
  title: string;
  html: string;
  summary?: string | null;
  reportId?: string | null;
  userId?: string | null;
  createdByLabel?: string;
}) {
  const problem = validateReportHtml(opts.html);
  if (problem) throw new ActionError(problem, "invalid");
  const sizeBytes = Buffer.byteLength(opts.html, "utf8");
  if (opts.reportId) {
    const [row] = await db
      .update(reports)
      .set({ title: opts.title, html: opts.html, summary: opts.summary ?? null, sizeBytes, aiStatus: "ready", aiError: null, updatedBy: opts.userId ?? null })
      .where(and(eq(reports.id, opts.reportId), eq(reports.projectId, opts.projectId), eq(reports.kind, "html")))
      .returning();
    if (!row) throw new ActionError("Report not found.", "not_found");
    return row;
  }
  await assertCapacity(opts.projectId);
  const [row] = await db
    .insert(reports)
    .values({
      projectId: opts.projectId,
      workspaceId: opts.workspaceId,
      kind: "html",
      title: opts.title,
      html: opts.html,
      summary: opts.summary ?? null,
      sizeBytes,
      aiStatus: "ready",
      createdBy: opts.userId ?? null,
      updatedBy: opts.userId ?? null,
      createdByLabel: opts.createdByLabel ?? "API",
    })
    .returning();
  return row!;
}

export async function projectWorkspace(projectId: string): Promise<string> {
  const [p] = await db.select({ w: projects.workspaceId }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!p) throw new ActionError("Project not found.", "not_found");
  return p.w;
}
