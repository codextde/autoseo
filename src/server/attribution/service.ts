import "server-only";
import { and, count, desc, eq, gte, ilike, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { attributionConversions, attributionResponses, attributionWorkflows } from "@/server/db/schema";
import { AI_DETAILS, CHANNELS, channelLabel } from "./channels";
import { hashEmail, isEmail } from "./email";
import { ingestResponse, type ResponseRow } from "./ingest";
import { defaultWebhookSchema } from "./payloads";
import { getAttributionSettings } from "./settings";
import { CHANNEL_IDS, type ChannelId } from "./types";

/* ─────────────────────────────── DTOs ─────────────────────────────── */

export type AttributionConversionDTO = {
  id: string;
  source: string;
  kind: string;
  transactionId: string | null;
  value: number | null;
  currency: string | null;
  occurredAt: string;
};

export type AttributionDTO = {
  id: string;
  respondedAt: string;
  channel: string;
  channelLabel: string;
  channelDetail: string | null;
  channelDetailLabel: string | null;
  isAiSearch: boolean;
  rawAnswer: string | null;
  freetext: string | null;
  sourceType: string;
  provider: string;
  formId: string | null;
  formName: string | null;
  contact: { emailMask: string | null; emailHash: string | null; externalId: string | null; name: string | null };
  dealValue: number | null;
  dealCurrency: string | null;
  valueSource: string | null;
  transactionId: string | null;
  matchedVia: string | null;
  conversion: AttributionConversionDTO | null;
  pageUrl: string | null;
  status: "active" | "dismissed";
  metadata: Record<string, unknown>;
};

export const PROVIDER_LABELS: Record<string, string> = {
  website_widget: "Website Widget",
  form_detect: "Website Form",
  api: "API",
  import: "CSV import",
  custom_webhook: "Webhook",
  custom: "Webhook",
  manual: "Manual",
};

export function providerLabel(provider: string): string {
  if (PROVIDER_LABELS[provider]) return PROVIDER_LABELS[provider]!;
  return provider
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function toDTO(r: ResponseRow, conv?: typeof attributionConversions.$inferSelect | null): AttributionDTO {
  return {
    id: r.id,
    respondedAt: r.respondedAt.toISOString(),
    channel: r.channel,
    channelLabel: channelLabel(r.channel),
    channelDetail: r.channelDetail,
    channelDetailLabel: r.channelDetail ? (AI_DETAILS[r.channelDetail as keyof typeof AI_DETAILS]?.label ?? r.channelDetail) : null,
    isAiSearch: r.channel === "ai_search",
    rawAnswer: r.rawAnswer,
    freetext: r.freetext,
    sourceType: r.sourceType,
    provider: r.provider,
    formId: r.formId,
    formName: r.formName,
    contact: { emailMask: r.emailMask, emailHash: r.emailHash, externalId: r.externalId, name: r.respondentName },
    dealValue: r.dealValue,
    dealCurrency: r.dealCurrency,
    valueSource: r.valueSource,
    transactionId: r.transactionId,
    matchedVia: r.matchedVia,
    conversion: conv
      ? {
          id: conv.id,
          source: conv.source,
          kind: conv.kind,
          transactionId: conv.transactionId,
          value: conv.value,
          currency: conv.currency,
          occurredAt: conv.occurredAt.toISOString(),
        }
      : null,
    pageUrl: r.pageUrl,
    status: r.status,
    metadata: r.metadata,
  };
}

/* ─────────────────────────────── List ─────────────────────────────── */

export const listFiltersSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /** "ai_search", "other" (= everything but AI), a channel id, or "all". */
  channel: z.string().max(40).optional(),
  source: z.string().max(80).optional(),
  status: z.enum(["active", "dismissed", "all"]).optional(),
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
});
export type ListFilters = z.infer<typeof listFiltersSchema>;

function listWhere(projectId: string, f: ListFilters): SQL {
  const where: SQL[] = [eq(attributionResponses.projectId, projectId)];
  if (f.from) where.push(gte(attributionResponses.respondedAt, f.from));
  if (f.to) where.push(lte(attributionResponses.respondedAt, f.to));
  if (f.channel && f.channel !== "all") {
    if (f.channel === "other") where.push(ne(attributionResponses.channel, "ai_search"));
    else where.push(eq(attributionResponses.channel, f.channel));
  }
  if (f.source) {
    const [provider, formName] = f.source.split("::");
    where.push(eq(attributionResponses.provider, provider!));
    if (formName) where.push(eq(attributionResponses.formName, formName));
  }
  const status = f.status ?? "active";
  if (status !== "all") where.push(eq(attributionResponses.status, status));
  const q = f.search?.trim();
  if (q) {
    if (isEmail(q)) where.push(eq(attributionResponses.emailHash, hashEmail(q)));
    else {
      const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
      where.push(
        or(
          ilike(attributionResponses.rawAnswer, like),
          ilike(attributionResponses.freetext, like),
          ilike(attributionResponses.formName, like),
          ilike(attributionResponses.externalId, like),
          ilike(attributionResponses.transactionId, like),
          ilike(attributionResponses.emailMask, like),
          ilike(attributionResponses.respondentName, like),
          /^[a-f0-9]{6,64}$/i.test(q) ? ilike(attributionResponses.emailHash, `${q.toLowerCase()}%`) : undefined,
        )!,
      );
    }
  }
  return and(...where)!;
}

/** Lists attribution responses (REST + UI). */
export async function listAttributions(projectId: string, filters: ListFilters = {}): Promise<{ items: AttributionDTO[]; total: number }> {
  const f = listFiltersSchema.parse(filters);
  const where = listWhere(projectId, f);
  const [rows, totalRows] = await Promise.all([
    db
      .select({ r: attributionResponses, c: attributionConversions })
      .from(attributionResponses)
      .leftJoin(
        attributionConversions,
        and(eq(attributionConversions.id, attributionResponses.conversionId), eq(attributionConversions.projectId, projectId)),
      )
      .where(where)
      .orderBy(desc(attributionResponses.respondedAt), desc(attributionResponses.id))
      .limit(f.limit ?? 100)
      .offset(f.offset ?? 0),
    db.select({ total: count() }).from(attributionResponses).where(where),
  ]);
  return { items: rows.map((x) => toDTO(x.r, x.c)), total: totalRows[0]?.total ?? 0 };
}

export async function getAttribution(projectId: string, id: string) {
  const [row] = await db
    .select({ r: attributionResponses, c: attributionConversions, w: { id: attributionWorkflows.id, name: attributionWorkflows.name } })
    .from(attributionResponses)
    .leftJoin(attributionConversions, and(eq(attributionConversions.id, attributionResponses.conversionId), eq(attributionConversions.projectId, projectId)))
    .leftJoin(attributionWorkflows, and(eq(attributionWorkflows.id, attributionResponses.workflowId), eq(attributionWorkflows.projectId, projectId)))
    .where(and(eq(attributionResponses.projectId, projectId), eq(attributionResponses.id, id)))
    .limit(1);
  if (!row) return null;
  return {
    ...toDTO(row.r, row.c),
    conversionDetail: row.c
      ? { items: row.c.items ?? [], metadata: row.c.metadata, emailMask: row.c.emailMask, pageUrl: row.c.pageUrl, createdAt: row.c.createdAt.toISOString() }
      : null,
    workflow: row.w?.id ? row.w : null,
    visitorId: row.r.visitorId,
    createdAt: row.r.createdAt.toISOString(),
    dismissedAt: row.r.dismissedAt?.toISOString() ?? null,
  };
}
export type AttributionDetail = NonNullable<Awaited<ReturnType<typeof getAttribution>>>;

export async function setAttributionStatus(projectId: string, id: string, status: "active" | "dismissed", actorId: string | null) {
  const [row] = await db
    .update(attributionResponses)
    .set({ status, dismissedAt: status === "dismissed" ? new Date() : null, dismissedBy: status === "dismissed" ? actorId : null })
    .where(and(eq(attributionResponses.projectId, projectId), eq(attributionResponses.id, id)))
    .returning({ id: attributionResponses.id });
  return !!row;
}

/* ─────────────────────────────── Create ─────────────────────────────── */

/** REST/API input schema (same field names as the webhook). */
export const createAttributionSchema = defaultWebhookSchema.refine((d) => !!(d.channelId ?? d.channel), {
  message: "channelId is required",
  path: ["channelId"],
});
export type CreateAttributionInput = z.input<typeof createAttributionSchema>;

export async function createAttribution(projectId: string, input: unknown, opts: { provider?: string } = {}): Promise<AttributionDTO> {
  const d = createAttributionSchema.parse(input);
  const settings = await getAttributionSettings(projectId);
  const channel = (d.channelId ?? d.channel)!;
  const r = await ingestResponse(
    projectId,
    {
      channel,
      rawAnswer: channel,
      channelDetail: d.channelDetail ?? null,
      freetext: d.freetextResponse ?? null,
      email: d.respondentEmail ?? d.email ?? null,
      emailHash: d.respondentEmailHash ?? null,
      externalId: d.respondentExternalId ?? null,
      name: d.respondentName ?? null,
      dealValue: d.dealValue ?? d.value ?? null,
      dealCurrency: d.dealCurrency ?? d.currency ?? null,
      transactionId: d.transactionId ?? d.orderId ?? d.order_id ?? null,
      formId: d.formId ?? null,
      formName: d.formName ?? null,
      pageUrl: d.pageUrl ?? null,
      occurredAt: d.occurredAt ?? d.submittedAt ?? null,
      metadata: d.metadata ?? null,
    },
    { sourceType: "api", provider: opts.provider ?? "api", customChannels: settings.survey.channels },
  );
  const conv = r.response.conversionId
    ? (
        await db
          .select()
          .from(attributionConversions)
          .where(and(eq(attributionConversions.id, r.response.conversionId), eq(attributionConversions.projectId, projectId)))
          .limit(1)
      )[0]
    : null;
  return toDTO(r.response, conv);
}

export const BULK_LIMIT = 1000;

/** Creates up to 1000 attributions. Invalid items are reported by index, valid ones are stored. */
export async function bulkCreateAttributions(
  projectId: string,
  inputs: unknown[],
  opts: { provider?: string } = {},
): Promise<{ created: number; failed: Array<{ index: number; error: string }>; ids: string[] }> {
  if (!Array.isArray(inputs)) throw new Error("Expected an array of attributions");
  if (inputs.length > BULK_LIMIT) throw new Error(`At most ${BULK_LIMIT} attributions per request`);
  const failed: Array<{ index: number; error: string }> = [];
  const ids: string[] = [];
  for (let i = 0; i < inputs.length; i++) {
    try {
      const dto = await createAttribution(projectId, inputs[i], opts);
      ids.push(dto.id);
    } catch (err) {
      const msg =
        err instanceof z.ZodError
          ? err.issues.map((x) => `${x.path.join(".") || "item"}: ${x.message}`).join("; ")
          : err instanceof Error
            ? err.message
            : "Invalid item";
      failed.push({ index: i, error: msg.slice(0, 300) });
    }
  }
  return { created: ids.length, failed, ids };
}

/* ─────────────────────────────── Summary ─────────────────────────────── */

export type AttributionSummary = {
  from: string;
  to: string;
  currency: string;
  responses: number;
  aiResponses: number;
  aiShare: number;
  dealValue: number;
  aiDealValue: number;
  otherDealValue: number;
  aiDealShare: number;
  /** Responses with a deal value in another currency (not summed). */
  otherCurrencyDeals: number;
  previous: { responses: number; aiResponses: number; dealValue: number; aiDealValue: number };
  byChannel: Array<{ channel: string; label: string; responses: number; dealValue: number }>;
  byAiDetail: Array<{ detail: string; label: string; responses: number; dealValue: number }>;
  timeseries: Array<{ date: string; ai: number; other: number; aiRevenue: number; otherRevenue: number }>;
  conversions: { total: number; merged: number; value: number };
};

async function periodTotals(projectId: string, from: Date, to: Date, currency: string) {
  const [row] = await db
    .select({
      responses: sql<number>`count(*)::int`,
      aiResponses: sql<number>`count(*) filter (where ${attributionResponses.channel} = 'ai_search')::int`,
      dealValue: sql<number>`coalesce(sum(${attributionResponses.dealValue}) filter (where ${attributionResponses.dealCurrency} = ${currency} or ${attributionResponses.dealCurrency} is null), 0)::float8`,
      aiDealValue: sql<number>`coalesce(sum(${attributionResponses.dealValue}) filter (where ${attributionResponses.channel} = 'ai_search' and (${attributionResponses.dealCurrency} = ${currency} or ${attributionResponses.dealCurrency} is null)), 0)::float8`,
      otherCurrencyDeals: sql<number>`count(*) filter (where ${attributionResponses.dealValue} is not null and ${attributionResponses.dealCurrency} is not null and ${attributionResponses.dealCurrency} <> ${currency})::int`,
    })
    .from(attributionResponses)
    .where(
      and(
        eq(attributionResponses.projectId, projectId),
        eq(attributionResponses.status, "active"),
        gte(attributionResponses.respondedAt, from),
        lte(attributionResponses.respondedAt, to),
      ),
    );
  return row!;
}

/** KPIs + breakdowns + daily series for a period (REST + UI). */
export async function getAttributionSummary(projectId: string, range: { from: Date; to: Date }): Promise<AttributionSummary> {
  const settings = await getAttributionSettings(projectId);
  const currency = settings.reportingCurrency;
  const { from, to } = range;
  const span = Math.max(1, to.getTime() - from.getTime());
  const prevFrom = new Date(from.getTime() - span);
  const baseWhere = and(
    eq(attributionResponses.projectId, projectId),
    eq(attributionResponses.status, "active"),
    gte(attributionResponses.respondedAt, from),
    lte(attributionResponses.respondedAt, to),
  );
  const valueExpr = sql<number>`coalesce(sum(${attributionResponses.dealValue}) filter (where ${attributionResponses.dealCurrency} = ${currency} or ${attributionResponses.dealCurrency} is null), 0)::float8`;

  const [cur, prev, byChannel, byDetail, series, conv] = await Promise.all([
    periodTotals(projectId, from, to, currency),
    periodTotals(projectId, prevFrom, from, currency),
    db
      .select({ channel: attributionResponses.channel, responses: sql<number>`count(*)::int`, dealValue: valueExpr })
      .from(attributionResponses)
      .where(baseWhere)
      .groupBy(attributionResponses.channel),
    db
      .select({ detail: attributionResponses.channelDetail, responses: sql<number>`count(*)::int`, dealValue: valueExpr })
      .from(attributionResponses)
      .where(and(baseWhere, eq(attributionResponses.channel, "ai_search")))
      .groupBy(attributionResponses.channelDetail),
    db
      .select({
        date: sql<string>`to_char(${attributionResponses.respondedAt} at time zone 'UTC', 'YYYY-MM-DD')`,
        ai: sql<number>`count(*) filter (where ${attributionResponses.channel} = 'ai_search')::int`,
        other: sql<number>`count(*) filter (where ${attributionResponses.channel} <> 'ai_search')::int`,
        aiRevenue: sql<number>`coalesce(sum(${attributionResponses.dealValue}) filter (where ${attributionResponses.channel} = 'ai_search' and (${attributionResponses.dealCurrency} = ${currency} or ${attributionResponses.dealCurrency} is null)), 0)::float8`,
        otherRevenue: sql<number>`coalesce(sum(${attributionResponses.dealValue}) filter (where ${attributionResponses.channel} <> 'ai_search' and (${attributionResponses.dealCurrency} = ${currency} or ${attributionResponses.dealCurrency} is null)), 0)::float8`,
      })
      .from(attributionResponses)
      .where(baseWhere)
      .groupBy(sql`1`)
      .orderBy(sql`1`),
    db
      .select({
        total: sql<number>`count(*)::int`,
        merged: sql<number>`count(${attributionConversions.responseId})::int`,
        value: sql<number>`coalesce(sum(${attributionConversions.value}) filter (where ${attributionConversions.currency} = ${currency} and ${attributionConversions.kind} <> 'renewal'), 0)::float8`,
      })
      .from(attributionConversions)
      .where(and(eq(attributionConversions.projectId, projectId), gte(attributionConversions.occurredAt, from), lte(attributionConversions.occurredAt, to))),
  ]);

  // Fill every day of the range (chart needs continuous x-axis).
  const byDay = new Map(series.map((s) => [s.date, s]));
  const timeseries: AttributionSummary["timeseries"] = [];
  const dayMs = 86_400_000;
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  for (let t = start; t <= to.getTime() && timeseries.length < 400; t += dayMs) {
    const key = new Date(t).toISOString().slice(0, 10);
    const s = byDay.get(key);
    timeseries.push({ date: key, ai: s?.ai ?? 0, other: s?.other ?? 0, aiRevenue: s?.aiRevenue ?? 0, otherRevenue: s?.otherRevenue ?? 0 });
  }

  const channelRows = new Map(byChannel.map((c) => [c.channel, c]));
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    currency,
    responses: cur.responses,
    aiResponses: cur.aiResponses,
    aiShare: cur.responses ? (cur.aiResponses / cur.responses) * 100 : 0,
    dealValue: cur.dealValue,
    aiDealValue: cur.aiDealValue,
    otherDealValue: cur.dealValue - cur.aiDealValue,
    aiDealShare: cur.dealValue ? (cur.aiDealValue / cur.dealValue) * 100 : 0,
    otherCurrencyDeals: cur.otherCurrencyDeals,
    previous: { responses: prev.responses, aiResponses: prev.aiResponses, dealValue: prev.dealValue, aiDealValue: prev.aiDealValue },
    byChannel: CHANNEL_IDS.map((id) => ({
      channel: id,
      label: CHANNELS[id as ChannelId].label,
      responses: channelRows.get(id)?.responses ?? 0,
      dealValue: channelRows.get(id)?.dealValue ?? 0,
    })).filter((c) => c.responses > 0),
    byAiDetail: byDetail
      .map((d) => ({
        detail: d.detail ?? "unspecified",
        label: d.detail ? (AI_DETAILS[d.detail as keyof typeof AI_DETAILS]?.label ?? d.detail) : "Not specified",
        responses: d.responses,
        dealValue: d.dealValue,
      }))
      .sort((a, b) => b.responses - a.responses),
    timeseries,
    conversions: { total: conv[0]?.total ?? 0, merged: conv[0]?.merged ?? 0, value: conv[0]?.value ?? 0 },
  };
}

/** Distinct sources (provider + form) for the "All sources" filter. */
export async function listResponseSources(projectId: string) {
  const rows = await db
    .select({ provider: attributionResponses.provider, formName: attributionResponses.formName, n: sql<number>`count(*)::int` })
    .from(attributionResponses)
    .where(eq(attributionResponses.projectId, projectId))
    .groupBy(attributionResponses.provider, attributionResponses.formName)
    .orderBy(sql`3 desc`)
    .limit(100);
  return rows.map((r) => ({
    value: r.formName ? `${r.provider}::${r.formName}` : r.provider,
    provider: r.provider,
    label: r.formName ? `${providerLabel(r.provider)} — ${r.formName}` : providerLabel(r.provider),
    count: r.n,
  }));
}

/** Counts for the setup "verify live" step. */
export async function getLiveStatus(projectId: string, since?: Date) {
  const settings = await getAttributionSettings(projectId);
  const after = since ?? new Date(0);
  const [[resp], [conv]] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int`, last: sql<Date | null>`max(${attributionResponses.createdAt})` })
      .from(attributionResponses)
      .where(and(eq(attributionResponses.projectId, projectId), gte(attributionResponses.createdAt, after))),
    db
      .select({ n: sql<number>`count(*)::int`, last: sql<Date | null>`max(${attributionConversions.createdAt})` })
      .from(attributionConversions)
      .where(and(eq(attributionConversions.projectId, projectId), gte(attributionConversions.createdAt, after))),
  ]);
  return {
    snippetFirstSeenAt: settings.snippetFirstSeenAt?.toISOString() ?? null,
    snippetLastSeenAt: settings.snippetLastSeenAt?.toISOString() ?? null,
    snippetLastOrigin: settings.snippetLastOrigin,
    responses: resp?.n ?? 0,
    lastResponseAt: resp?.last ? new Date(resp.last).toISOString() : null,
    conversions: conv?.n ?? 0,
    lastConversionAt: conv?.last ? new Date(conv.last).toISOString() : null,
  };
}

/** Rows for CSV export (no clear-text PII: masked email + hash only). */
export async function exportAttributionsCsv(projectId: string, filters: ListFilters): Promise<string> {
  const { items } = await listAttributions(projectId, { ...filters, limit: 1000, offset: 0 });
  const all = [...items];
  let offset = items.length;
  while (items.length === 1000 && all.length < 50_000) {
    const next = await listAttributions(projectId, { ...filters, limit: 1000, offset });
    if (!next.items.length) break;
    all.push(...next.items);
    offset += next.items.length;
  }
  const header = [
    "date",
    "channel",
    "ai_assistant",
    "answer",
    "freetext",
    "source",
    "form",
    "contact_email_masked",
    "contact_email_sha256",
    "external_id",
    "deal_value",
    "deal_currency",
    "value_source",
    "transaction_id",
    "matched_via",
    "conversion_kind",
    "status",
  ];
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return "";
    // Neutralize spreadsheet formulas (also after ; / tab separators used by EU Excel) and quote every field.
    const s = String(v).replace(/(^|[;\t\r\n,])\s*([=+\-@])/g, "$1'$2");
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = [header.join(",")];
  for (const r of all) {
    lines.push(
      [
        r.respondedAt,
        r.channelLabel,
        r.channelDetailLabel,
        r.rawAnswer,
        r.freetext,
        providerLabel(r.provider),
        r.formName,
        r.contact.emailMask,
        r.contact.emailHash,
        r.contact.externalId,
        r.dealValue,
        r.dealCurrency,
        r.valueSource,
        r.transactionId,
        r.matchedVia,
        r.conversion?.kind,
        r.status,
      ]
        .map(esc)
        .join(","),
    );
  }
  return lines.join("\n");
}

export async function countResponses(projectId: string) {
  const [row] = await db.select({ n: count() }).from(attributionResponses).where(eq(attributionResponses.projectId, projectId));
  return row?.n ?? 0;
}

