import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { competitors, projects } from "@/server/db/schema";
import { normalizeDomain, isValidDomain } from "@/server/projects";
import { brandNames } from "./brands";
import { dismissedBrands } from "./competitors";

export type CompetitorInput = {
  name: string;
  domain?: string | null;
  aliases?: string[];
  tracked?: boolean;
  source?: "manual" | "auto" | "import";
};

function cleanDomain(input: string | null | undefined): string | null {
  if (!input?.trim()) return null;
  const d = normalizeDomain(input);
  if (!isValidDomain(d)) throw new Error("Please enter a valid domain, e.g. example.com");
  return d;
}

function cleanAliases(list: string[] | undefined, name: string): string[] {
  return [...new Set((list ?? []).map((a) => a.trim()).filter((a) => a && a.toLowerCase() !== name.toLowerCase()))].slice(0, 20);
}

/**
 * Links historical answer facts of untracked brands to a competitor (name/alias match, and
 * citations of its domain) so history shows up immediately after adding a competitor.
 */
async function relinkHistory(projectId: string, competitorId: string, names: string[], domain: string | null) {
  if (!names.length) return;
  await db.execute(sql`
    update ai_mentions set competitor_id = ${competitorId}
    where project_id = ${projectId} and competitor_id is null and is_own = false and lower(trim(brand_name)) in ${names}`);
  await db.execute(sql`
    update ai_statements set competitor_id = ${competitorId}
    where project_id = ${projectId} and competitor_id is null and is_own = false and lower(trim(brand_name)) in ${names}`);
  await db.execute(sql`
    update ai_recommendations set competitor_id = ${competitorId}
    where project_id = ${projectId} and competitor_id is null and is_own = false and lower(trim(brand_name)) in ${names}`);
  await db.execute(sql`
    update ai_recommendations set opponent_competitor_id = ${competitorId}
    where project_id = ${projectId} and opponent_competitor_id is null and coalesce(opponent_is_own, false) = false
      and lower(trim(coalesce(opponent_name, ''))) in ${names}`);
  await db.execute(sql`
    update ai_products set competitor_id = ${competitorId}
    where project_id = ${projectId} and competitor_id is null and is_own = false and lower(trim(coalesce(brand_name, ''))) in ${names}`);
  await db.execute(sql`
    update ai_ads set competitor_id = ${competitorId}
    where project_id = ${projectId} and competitor_id is null and is_own = false
      and (lower(trim(advertiser)) in ${names}${domain ? sql` or advertiser_domain = ${domain}` : sql``})`);
  if (domain) {
    await db.execute(sql`
      update ai_sources set competitor_id = ${competitorId}, ownership = 'competitor'
      where project_id = ${projectId} and ownership = 'third_party'
        and (domain = ${domain} or domain like ${`%.${domain}`})`);
  }
}

/** Reverse of relinkHistory: keeps the facts as untracked-brand history. */
async function detachHistory(projectId: string, competitorId: string) {
  await db.execute(sql`update ai_mentions set competitor_id = null where project_id = ${projectId} and competitor_id = ${competitorId}`);
  await db.execute(sql`update ai_statements set competitor_id = null where project_id = ${projectId} and competitor_id = ${competitorId}`);
  await db.execute(sql`update ai_recommendations set competitor_id = null where project_id = ${projectId} and competitor_id = ${competitorId}`);
  await db.execute(
    sql`update ai_recommendations set opponent_competitor_id = null where project_id = ${projectId} and opponent_competitor_id = ${competitorId}`,
  );
  await db.execute(sql`update ai_sources set competitor_id = null, ownership = 'third_party' where project_id = ${projectId} and competitor_id = ${competitorId}`);
}

export async function createCompetitor(projectId: string, input: CompetitorInput) {
  const name = input.name.trim();
  if (!name) throw new Error("Name is required.");
  const domain = cleanDomain(input.domain);
  const aliases = cleanAliases(input.aliases, name);
  const existing = await db
    .select({ id: competitors.id })
    .from(competitors)
    .where(and(eq(competitors.projectId, projectId), sql`lower(${competitors.name}) = ${name.toLowerCase()}`))
    .limit(1);
  if (existing.length) throw new Error(`"${name}" is already a competitor.`);
  const [row] = await db
    .insert(competitors)
    .values({ projectId, name, domain, aliases, tracked: input.tracked ?? true, source: input.source ?? "manual" })
    .returning();
  await relinkHistory(projectId, row!.id, brandNames({ name, aliases }), domain);
  return row!;
}

export async function updateCompetitor(projectId: string, competitorId: string, input: CompetitorInput) {
  const name = input.name.trim();
  if (!name) throw new Error("Name is required.");
  const domain = cleanDomain(input.domain);
  const aliases = cleanAliases(input.aliases, name);
  const clash = await db
    .select({ id: competitors.id })
    .from(competitors)
    .where(
      and(
        eq(competitors.projectId, projectId),
        sql`lower(${competitors.name}) = ${name.toLowerCase()}`,
        sql`${competitors.id} <> ${competitorId}`,
      ),
    )
    .limit(1);
  if (clash.length) throw new Error(`"${name}" is already a competitor.`);
  const [row] = await db
    .update(competitors)
    .set({ name, domain, aliases, ...(input.tracked !== undefined ? { tracked: input.tracked } : {}) })
    .where(and(eq(competitors.projectId, projectId), eq(competitors.id, competitorId)))
    .returning();
  if (!row) throw new Error("Competitor not found.");
  await relinkHistory(projectId, row.id, brandNames({ name, aliases }), domain);
  return row;
}

export async function setCompetitorTracked(projectId: string, competitorId: string, tracked: boolean) {
  const [row] = await db
    .update(competitors)
    .set({ tracked })
    .where(and(eq(competitors.projectId, projectId), eq(competitors.id, competitorId)))
    .returning();
  if (!row) throw new Error("Competitor not found.");
  return row;
}

export async function removeCompetitor(projectId: string, competitorId: string) {
  const [row] = await db
    .select()
    .from(competitors)
    .where(and(eq(competitors.projectId, projectId), eq(competitors.id, competitorId)))
    .limit(1);
  if (!row) throw new Error("Competitor not found.");
  await detachHistory(projectId, competitorId);
  await db.delete(competitors).where(and(eq(competitors.projectId, projectId), eq(competitors.id, competitorId)));
  return row;
}

export async function dismissBrandSuggestion(projectId: string, name: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new Error("Project not found.");
  const list = [...new Set([...dismissedBrands(project), name.trim()])].slice(-200);
  const settings = { ...(project.settings ?? {}) } as Record<string, unknown>;
  const ai = { ...((settings.aiInsights as Record<string, unknown> | undefined) ?? {}), dismissedBrands: list };
  await db.update(projects).set({ settings: { ...settings, aiInsights: ai } }).where(eq(projects.id, projectId));
}
