import "server-only";
import { and, eq, getTableColumns, gte, isNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db/client";
import { attributionConversions, attributionResponses } from "@/server/db/schema";
import { normalizeChannel, isAiDetailId } from "./channels";
import { redactEmails, resolveEmail } from "./email";
import {
  CONVERSION_LOOKBACK_DAYS,
  matchConversionForResponse,
  matchResponseForConversion,
  mergedDealValue,
  responseWindowForConversion,
} from "./merge";
import { cleanText, cleanUrl } from "./payloads";
import type { ConversionInput, ConversionKind, ConversionSourceType, ResponseInput, ResponseSourceType, SurveyChannel } from "./types";

export type ResponseRow = typeof attributionResponses.$inferSelect;
export type ConversionRow = typeof attributionConversions.$inferSelect;

const DAY = 86_400_000;

function clampDate(d: Date | null | undefined): Date {
  const now = Date.now();
  if (!d || Number.isNaN(d.getTime())) return new Date();
  if (d.getTime() > now + DAY) return new Date();
  if (d.getTime() < now - 5 * 365 * DAY) return new Date(now - 5 * 365 * DAY);
  return d;
}

function cleanMoney(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v) || v < 0 || v > 1e10) return null;
  return Math.round(v * 100) / 100;
}

function cleanCurrency(v: string | null | undefined): string | null {
  if (!v) return null;
  const c = v.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : null;
}

/** Sanitizes metadata: JSON-safe, emails masked, ≤ 8 KB. */
export function cleanMetadata(meta: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!meta || typeof meta !== "object") return {};
  let json: string;
  try {
    json = JSON.stringify(meta, (_k, v) => (typeof v === "string" ? redactEmails(v).slice(0, 1000) : typeof v === "bigint" ? String(v) : v));
  } catch {
    return {};
  }
  if (json.length > 8_000) return { truncated: true };
  return JSON.parse(json) as Record<string, unknown>;
}

function cleanItems(items: Array<Record<string, unknown>> | null | undefined): Array<Record<string, unknown>> | null {
  if (!Array.isArray(items) || !items.length) return null;
  return items.slice(0, 50).map((it) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(it ?? {}).slice(0, 12)) {
      if (typeof v === "string") out[k.slice(0, 40)] = redactEmails(v).slice(0, 200);
      else if (typeof v === "number" && Number.isFinite(v)) out[k.slice(0, 40)] = v;
      else if (typeof v === "boolean") out[k.slice(0, 40)] = v;
    }
    return out;
  });
}

function cleanVisitor(v: string | null | undefined): string | null {
  return v && /^[A-Za-z0-9_-]{6,80}$/.test(v) ? v : null;
}

/* ─────────────────────────────── Responses ─────────────────────────────── */

export type IngestResponseMeta = {
  sourceType: ResponseSourceType;
  provider: string;
  workflowId?: string | null;
  customChannels?: SurveyChannel[];
};

export type IngestResponseResult = { response: ResponseRow; created: boolean; merged: boolean };

export async function ingestResponse(projectId: string, input: ResponseInput, meta: IngestResponseMeta): Promise<IngestResponseResult> {
  // Free text never keeps clear-text emails (e.g. typed into “Other”).
  const txt = (v: unknown, max: number) => {
    const t = cleanText(v, max);
    return t ? redactEmails(t).slice(0, max) : null;
  };
  const rawAnswer = txt(input.rawAnswer ?? input.channel, 500);
  const freetext = txt(input.freetext, 2000);
  let norm = normalizeChannel(input.channel ?? rawAnswer, { customChannels: meta.customChannels });
  if (norm.channel === "other" && freetext) {
    const fromText = normalizeChannel(freetext);
    if (fromText.channel !== "other") norm = fromText;
  }
  let detail = norm.detail;
  if (input.channelDetail) {
    const d = input.channelDetail.trim().toLowerCase();
    if (isAiDetailId(d)) detail = d;
    else {
      const n = normalizeChannel(input.channelDetail);
      if (n.detail) detail = n.detail;
    }
    if (detail && norm.channel !== "ai_search") norm = { channel: "ai_search", detail };
  }
  const email = resolveEmail({ email: input.email, emailHash: input.emailHash, emailMask: input.emailMask });
  const externalId = txt(input.externalId, 200);
  const dedupeKey = cleanText(input.dedupeKey, 300) ?? (externalId ? `${meta.provider}:${externalId}` : null);
  const transactionId = cleanText(input.transactionId, 200);
  let dealValue = cleanMoney(input.dealValue);
  if (transactionId && dealValue != null) {
    // The order is already attributed to another answer → keep this answer, but never count its value twice.
    const [taken] = await db
      .select({ responseId: attributionConversions.responseId })
      .from(attributionConversions)
      .where(and(eq(attributionConversions.projectId, projectId), eq(attributionConversions.transactionId, transactionId)))
      .limit(1);
    if (taken?.responseId && !(dedupeKey && (await responseHasDedupeKey(projectId, taken.responseId, dedupeKey)))) dealValue = null;
  }
  const values = {
    projectId,
    sourceType: meta.sourceType,
    provider: meta.provider.slice(0, 60),
    formId: txt(input.formId, 200),
    formName: txt(input.formName, 200),
    channel: norm.channel,
    channelDetail: norm.channel === "ai_search" ? detail : null,
    rawAnswer,
    freetext,
    emailHash: email.emailHash,
    emailMask: email.emailMask,
    externalId,
    respondentName: txt(input.name, 200),
    dealValue,
    dealCurrency: cleanCurrency(input.dealCurrency),
    valueSource: dealValue != null ? ("response" as const) : null,
    transactionId,
    visitorId: cleanVisitor(input.visitorId),
    pageUrl: cleanUrl(input.pageUrl),
    workflowId: meta.workflowId ?? null,
    metadata: cleanMetadata(input.metadata),
    dedupeKey,
    respondedAt: clampDate(input.occurredAt),
  };

  const [row] = await db
    .insert(attributionResponses)
    .values(values)
    .onConflictDoUpdate({
      target: [attributionResponses.projectId, attributionResponses.dedupeKey],
      set: {
        channel: sql`excluded.channel`,
        channelDetail: sql`excluded.channel_detail`,
        rawAnswer: sql`excluded.raw_answer`,
        freetext: sql`coalesce(excluded.freetext, ${attributionResponses.freetext})`,
        emailHash: sql`coalesce(excluded.email_hash, ${attributionResponses.emailHash})`,
        emailMask: sql`coalesce(excluded.email_mask, ${attributionResponses.emailMask})`,
        respondentName: sql`coalesce(excluded.respondent_name, ${attributionResponses.respondentName})`,
        dealValue: sql`coalesce(excluded.deal_value, ${attributionResponses.dealValue})`,
        dealCurrency: sql`coalesce(excluded.deal_currency, ${attributionResponses.dealCurrency})`,
        valueSource: sql`coalesce(excluded.value_source, ${attributionResponses.valueSource})`,
        transactionId: sql`coalesce(excluded.transaction_id, ${attributionResponses.transactionId})`,
        formName: sql`coalesce(excluded.form_name, ${attributionResponses.formName})`,
        metadata: sql`${attributionResponses.metadata} || excluded.metadata`,
      },
    })
    .returning({ ...getTableColumns(attributionResponses), inserted: sql<boolean>`(xmax = 0)` });
  const { inserted: created, ...inserted } = row!;
  let response: ResponseRow = inserted;
  let merged = false;
  if (!response.conversionId) {
    const m = await mergeResponse(projectId, response);
    if (m) {
      response = m;
      merged = true;
    }
  }
  return { response, created, merged };
}

async function responseHasDedupeKey(projectId: string, responseId: string, dedupeKey: string) {
  const [r] = await db
    .select({ id: attributionResponses.id })
    .from(attributionResponses)
    .where(and(eq(attributionResponses.projectId, projectId), eq(attributionResponses.id, responseId), eq(attributionResponses.dedupeKey, dedupeKey)))
    .limit(1);
  return !!r;
}

/** Finds and claims an unmatched conversion for a response. Returns the updated response or null. */
async function mergeResponse(projectId: string, response: ResponseRow): Promise<ResponseRow | null> {
  const keys: SQL[] = [];
  if (response.transactionId) keys.push(eq(attributionConversions.transactionId, response.transactionId));
  if (response.emailHash) keys.push(eq(attributionConversions.emailHash, response.emailHash));
  if (response.visitorId) keys.push(eq(attributionConversions.visitorId, response.visitorId));
  if (!keys.length) return null;
  const t = response.respondedAt.getTime();
  const candidates = await db
    .select()
    .from(attributionConversions)
    .where(
      and(
        eq(attributionConversions.projectId, projectId),
        isNull(attributionConversions.responseId),
        ne(attributionConversions.kind, "renewal"),
        gte(attributionConversions.occurredAt, new Date(t - CONVERSION_LOOKBACK_DAYS * DAY)),
        lte(attributionConversions.occurredAt, new Date(t + CONVERSION_LOOKBACK_DAYS * DAY)),
        or(...keys),
      ),
    )
    .limit(100);
  const match = matchConversionForResponse(response, candidates);
  if (!match) return null;
  return claim(projectId, response, candidates.find((c) => c.id === match.conversion.id)!, match.via);
}

/** Links a response and a conversion atomically (1:1). */
async function claim(projectId: string, response: ResponseRow, conversion: ConversionRow, via: "transaction" | "email" | "visitor"): Promise<ResponseRow | null> {
  return db.transaction(async (tx) => {
    const [c] = await tx
      .update(attributionConversions)
      .set({ responseId: response.id })
      .where(and(eq(attributionConversions.id, conversion.id), eq(attributionConversions.projectId, projectId), isNull(attributionConversions.responseId)))
      .returning({ id: attributionConversions.id });
    if (!c) return null;
    const deal = mergedDealValue(response, conversion);
    const [r] = await tx
      .update(attributionResponses)
      .set({
        conversionId: conversion.id,
        matchedVia: via,
        dealValue: deal.dealValue,
        dealCurrency: deal.dealCurrency,
        valueSource: deal.valueSource,
        transactionId: response.transactionId ?? conversion.transactionId,
      })
      .where(and(eq(attributionResponses.id, response.id), eq(attributionResponses.projectId, projectId), isNull(attributionResponses.conversionId)))
      .returning();
    if (!r) {
      // Response got matched concurrently → release the conversion.
      await tx.update(attributionConversions).set({ responseId: null }).where(eq(attributionConversions.id, conversion.id));
      return null;
    }
    return r;
  });
}

/* ─────────────────────────────── Conversions ─────────────────────────────── */

export type IngestConversionResult = { conversion: ConversionRow; created: boolean; mergedResponseId: string | null };

/** Sources reported by browsers with the public snippet key (spoofable) — they never overwrite verified data. */
export const UNTRUSTED_CONVERSION_SOURCES: ConversionSourceType[] = ["snippet_ga", "snippet_meta", "snippet_api", "shopify"];

export async function ingestConversion(projectId: string, input: ConversionInput, source: ConversionSourceType): Promise<IngestConversionResult> {
  const trusted = !UNTRUSTED_CONVERSION_SOURCES.includes(source);
  const email = resolveEmail({ email: input.email, emailHash: input.emailHash, emailMask: input.emailMask });
  const kind: ConversionKind = input.kind ?? "purchase";
  const values = {
    projectId,
    source,
    kind,
    transactionId: cleanText(input.transactionId, 200),
    value: cleanMoney(input.value),
    currency: cleanCurrency(input.currency),
    emailHash: email.emailHash,
    emailMask: email.emailMask,
    visitorId: cleanVisitor(input.visitorId),
    pageUrl: cleanUrl(input.pageUrl),
    items: cleanItems(input.items),
    metadata: cleanMetadata(input.metadata),
    occurredAt: clampDate(input.occurredAt),
  };

  let row: ConversionRow;
  let created = true;
  if (values.transactionId) {
    // Dedupe by transaction id (e.g. snippet GA purchase + Shopify pixel + webhook for the same order).
    const [r] = await db
      .insert(attributionConversions)
      .values(values)
      .onConflictDoUpdate({
        target: [attributionConversions.projectId, attributionConversions.transactionId],
        // Browser-reported sources (public snippet key / pixel) may only fill gaps; server-verified
        // sources (signed webhooks, token webhooks, imports, API) win.
        set: trusted
          ? {
              source: sql`excluded.source`,
              value: sql`coalesce(excluded.value, ${attributionConversions.value})`,
              currency: sql`coalesce(excluded.currency, ${attributionConversions.currency})`,
              kind: sql`excluded.kind`,
              emailHash: sql`coalesce(excluded.email_hash, ${attributionConversions.emailHash})`,
              emailMask: sql`coalesce(excluded.email_mask, ${attributionConversions.emailMask})`,
              visitorId: sql`coalesce(${attributionConversions.visitorId}, excluded.visitor_id)`,
              items: sql`coalesce(excluded.items, ${attributionConversions.items})`,
              metadata: sql`${attributionConversions.metadata} || excluded.metadata`,
            }
          : {
              value: sql`coalesce(${attributionConversions.value}, excluded.value)`,
              currency: sql`coalesce(${attributionConversions.currency}, excluded.currency)`,
              emailHash: sql`coalesce(${attributionConversions.emailHash}, excluded.email_hash)`,
              emailMask: sql`coalesce(${attributionConversions.emailMask}, excluded.email_mask)`,
              visitorId: sql`coalesce(${attributionConversions.visitorId}, excluded.visitor_id)`,
              items: sql`coalesce(${attributionConversions.items}, excluded.items)`,
              metadata: sql`excluded.metadata || ${attributionConversions.metadata}`,
            },
      })
      .returning({ ...getTableColumns(attributionConversions), inserted: sql<boolean>`(xmax = 0)` });
    const { inserted, ...rest } = r!;
    row = rest;
    created = inserted;
  } else {
    const [r] = await db.insert(attributionConversions).values(values).returning();
    row = r!;
  }

  if (row.responseId) {
    // Already merged: keep a conversion-derived deal value in sync (never add on top).
    if (row.value != null && trusted) {
      await db
        .update(attributionResponses)
        .set({ dealValue: row.value, dealCurrency: row.currency })
        .where(and(eq(attributionResponses.id, row.responseId), eq(attributionResponses.projectId, projectId), eq(attributionResponses.valueSource, "conversion")));
    }
    return { conversion: row, created, mergedResponseId: row.responseId };
  }
  if (row.kind === "renewal") return { conversion: row, created, mergedResponseId: null };

  const keys: SQL[] = [];
  if (row.transactionId) keys.push(eq(attributionResponses.transactionId, row.transactionId));
  if (row.emailHash) keys.push(eq(attributionResponses.emailHash, row.emailHash));
  if (row.visitorId) keys.push(eq(attributionResponses.visitorId, row.visitorId));
  if (!keys.length) return { conversion: row, created, mergedResponseId: null };
  const window = responseWindowForConversion(row.occurredAt);
  const candidates = await db
    .select()
    .from(attributionResponses)
    .where(
      and(
        eq(attributionResponses.projectId, projectId),
        isNull(attributionResponses.conversionId),
        eq(attributionResponses.status, "active"),
        gte(attributionResponses.respondedAt, window.from),
        lte(attributionResponses.respondedAt, window.to),
        or(...keys),
      ),
    )
    .limit(100);
  const match = matchResponseForConversion(row, candidates);
  if (!match) return { conversion: row, created, mergedResponseId: null };
  const merged = await claim(projectId, candidates.find((c) => c.id === match.response.id)!, row, match.via);
  return { conversion: merged ? { ...row, responseId: merged.id } : row, created, mergedResponseId: merged?.id ?? null };
}
