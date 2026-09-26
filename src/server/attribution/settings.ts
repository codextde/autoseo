import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { attributionSettings, projects } from "@/server/db/schema";
import { randomToken, sha256, timingSafeEqualStr } from "@/server/crypto";
import { env } from "@/server/env";
import { getBranding } from "@/server/branding";
import { withSurveyDefaults } from "./channels";
import { findSourceByToken } from "./sources";
import type { SurveyConfig } from "./types";

export type AttributionSettingsRow = typeof attributionSettings.$inferSelect;
export type ResolvedSettings = Omit<AttributionSettingsRow, "survey"> & { survey: SurveyConfig };

function defaultCurrency(country: string): string {
  const eur = ["DE", "AT", "FR", "IT", "ES", "NL", "BE", "IE", "FI", "PT", "GR", "LU", "SK", "SI", "EE", "LV", "LT", "MT", "CY", "HR"];
  if (eur.includes(country)) return "EUR";
  const map: Record<string, string> = { US: "USD", GB: "GBP", CH: "CHF", CA: "CAD", AU: "AUD", SE: "SEK", NO: "NOK", DK: "DKK", PL: "PLN", CZ: "CZK", JP: "JPY", IN: "INR", BR: "BRL" };
  return map[country] ?? "USD";
}

/** Loads (or lazily creates) the attribution settings of a project. */
export async function getAttributionSettings(projectId: string): Promise<ResolvedSettings> {
  const [row] = await db.select().from(attributionSettings).where(eq(attributionSettings.projectId, projectId)).limit(1);
  if (row) return { ...row, survey: withSurveyDefaults(row.survey) };
  const [project] = await db.select({ country: projects.country }).from(projects).where(eq(projects.id, projectId)).limit(1);
  const survey = withSurveyDefaults({});
  await db
    .insert(attributionSettings)
    .values({
      projectId,
      publicKey: `atk_${randomToken(18)}`,
      reportingCurrency: defaultCurrency(project?.country ?? "US"),
      survey,
    })
    .onConflictDoNothing();
  const [created] = await db.select().from(attributionSettings).where(eq(attributionSettings.projectId, projectId)).limit(1);
  return { ...created!, survey: withSurveyDefaults(created!.survey) };
}

export async function updateAttributionSettings(
  projectId: string,
  patch: Partial<Omit<AttributionSettingsRow, "projectId" | "publicKey" | "createdAt" | "updatedAt">>,
  actorId?: string | null,
) {
  await getAttributionSettings(projectId);
  await db
    .update(attributionSettings)
    .set({ ...patch, updatedBy: actorId ?? null, updatedAt: new Date() })
    .where(eq(attributionSettings.projectId, projectId));
}

export async function findSettingsByPublicKey(publicKey: string) {
  if (!/^atk_[A-Za-z0-9_-]{10,64}$/.test(publicKey)) return null;
  const [row] = await db.select().from(attributionSettings).where(eq(attributionSettings.publicKey, publicKey)).limit(1);
  return row ? { ...row, survey: withSurveyDefaults(row.survey) } : null;
}

/** Creates a new project webhook token. Returns the clear token (shown once); only the hash is stored. */
export async function rotateWebhookToken(projectId: string, actorId?: string | null): Promise<string> {
  const token = `awh_${randomToken(24)}`;
  await updateAttributionSettings(
    projectId,
    { webhookTokenHash: sha256(token), webhookTokenPrefix: token.slice(0, 10), webhookTokenCreatedAt: new Date() },
    actorId,
  );
  return token;
}

/**
 * Verifies a webhook token for a project: either the project token or a source-specific token.
 * Returns the matching source provider (if a source token was used).
 */
export async function verifyWebhookToken(
  projectId: string,
  token: string | null,
): Promise<{ ok: true; sourceId: string | null; provider: string | null } | { ok: false }> {
  if (!token || token.length < 16 || token.length > 200) return { ok: false };
  const hash = sha256(token);
  const [settings] = await db
    .select({ hash: attributionSettings.webhookTokenHash })
    .from(attributionSettings)
    .where(eq(attributionSettings.projectId, projectId))
    .limit(1);
  if (settings?.hash && timingSafeEqualStr(settings.hash, hash)) return { ok: true, sourceId: null, provider: null };
  const source = await findSourceByToken(projectId, token);
  return source ? { ok: true, sourceId: source.id, provider: source.provider } : { ok: false };
}

/* ─────────────────────────── URLs ─────────────────────────── */

export function webhookUrl(projectId: string, token: string | null, source?: string | null): string {
  const params = new URLSearchParams();
  params.set("token", token ?? "YOUR_TOKEN");
  if (source) params.set("source", source);
  return `${env.appUrl}/api/attribution/webhook/${projectId}?${params.toString()}`;
}

export function collectUrl(): string {
  return `${env.appUrl}/api/public/attribution/collect`;
}

export function snippetUrl(publicKey: string): string {
  return `${env.appUrl}/api/public/attribution/snippet.js?k=${encodeURIComponent(publicKey)}`;
}

/** JS namespace of the snippet API, e.g. `window.AutoSEOAttribution`. */
export async function snippetNamespace(): Promise<string> {
  const b = await getBranding();
  const ns = b.appName.replace(/[^A-Za-z0-9]/g, "");
  return /^[A-Za-z]/.test(ns) ? ns.slice(0, 32) : "AutoSEO";
}

export async function installTag(publicKey: string): Promise<string> {
  const ns = `${await snippetNamespace()}Attribution`;
  return [
    `<!-- ${ns} -->`,
    `<script>window.${ns}=window.${ns}||{q:[],show:function(){this.q.push(["show",arguments])},trackConversion:function(){this.q.push(["trackConversion",arguments])},identify:function(){this.q.push(["identify",arguments])}};</script>`,
    `<script async src="${snippetUrl(publicKey)}"></script>`,
  ].join("\n");
}
