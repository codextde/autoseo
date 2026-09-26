/**
 * Parsing of the default webhook schema + conversion of mapped values into ingestion inputs.
 * Pure (zod only) so it can be unit-tested.
 */
import { z } from "zod";
import { valueToNumber, valueToString, type MappedValues } from "./mapping";
import type { ConversionInput, ResponseInput } from "./types";

const str = (max: number) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .pipe(z.string().max(max))
    .optional()
    .nullable();

const money = z
  .union([z.number(), z.string()])
  .transform((v, ctx) => {
    const n = valueToNumber(v);
    if (n === null || n < 0 || n > 1e10) {
      ctx.addIssue({ code: "custom", message: "Invalid amount" });
      return z.NEVER;
    }
    return n;
  })
  .optional()
  .nullable();

const currency = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/, "Use a 3-letter ISO currency code")
  .transform((v) => v.toUpperCase())
  .optional()
  .nullable();

const dateLike = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    const d = typeof v === "number" ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: "custom", message: "Invalid date" });
      return z.NEVER;
    }
    return d;
  })
  .optional()
  .nullable();

const metadata = z
  .record(z.string(), z.unknown())
  .refine((m) => JSON.stringify(m).length <= 8_000, "metadata must be ≤ 8 KB")
  .optional()
  .nullable();

/** The documented webhook / REST schema (finseo-compatible field names + a few aliases). */
export const defaultWebhookSchema = z
  .object({
    channelId: str(200),
    channel: str(200),
    channelDetail: str(100),
    respondentEmail: str(320),
    email: str(320),
    respondentEmailHash: z.string().regex(/^[a-fA-F0-9]{64}$/).optional().nullable(),
    respondentExternalId: str(200),
    respondentName: str(200),
    freetextResponse: str(2000),
    dealValue: money,
    value: money,
    dealCurrency: currency,
    currency: currency,
    metadata,
    formId: str(200),
    formName: str(200),
    pageUrl: str(2000),
    transactionId: str(200),
    orderId: str(200),
    order_id: str(200),
    occurredAt: dateLike,
    submittedAt: dateLike,
  })
  .passthrough();

export type DefaultParseResult =
  | { type: "response"; response: ResponseInput }
  | { type: "conversion"; conversion: ConversionInput }
  | { type: "invalid"; error: string }
  | { type: "unrecognized" };

/** Tries the default schema. Payloads without channel and without an order id are "unrecognized". */
export function parseDefaultPayload(payload: unknown): DefaultParseResult {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { type: "unrecognized" };
  const p = payload as Record<string, unknown>;
  const looksDefault = ["channelId", "channel", "transactionId", "orderId", "order_id", "respondentEmail"].some((k) => k in p);
  if (!looksDefault) return { type: "unrecognized" };
  const parsed = defaultWebhookSchema.safeParse(p);
  if (!parsed.success) {
    return { type: "invalid", error: parsed.error.issues.map((i) => `${i.path.join(".") || "payload"}: ${i.message}`).join("; ") };
  }
  const d = parsed.data;
  const channel = d.channelId ?? d.channel ?? null;
  const transactionId = d.transactionId ?? d.orderId ?? d.order_id ?? null;
  const email = d.respondentEmail ?? d.email ?? null;
  const value = d.dealValue ?? d.value ?? null;
  const cur = d.dealCurrency ?? d.currency ?? null;
  const occurredAt = d.occurredAt ?? d.submittedAt ?? null;
  if (channel) {
    return {
      type: "response",
      response: {
        channel,
        channelDetail: d.channelDetail ?? null,
        rawAnswer: channel,
        freetext: d.freetextResponse ?? null,
        email,
        emailHash: d.respondentEmailHash ?? null,
        externalId: d.respondentExternalId ?? null,
        name: d.respondentName ?? null,
        dealValue: value,
        dealCurrency: cur,
        transactionId,
        formId: d.formId ?? null,
        formName: d.formName ?? null,
        pageUrl: d.pageUrl ?? null,
        occurredAt,
        metadata: d.metadata ?? null,
      },
    };
  }
  if (transactionId || (value != null && email)) {
    return {
      type: "conversion",
      conversion: {
        transactionId,
        kind: "purchase",
        value,
        currency: cur,
        email,
        emailHash: d.respondentEmailHash ?? null,
        pageUrl: d.pageUrl ?? null,
        occurredAt,
        metadata: d.metadata ?? null,
      },
    };
  }
  return { type: "invalid", error: "channelId is required (or send an order with transactionId + dealValue)" };
}

function toDate(v: string | undefined): Date | null {
  if (!v) return null;
  const n = Number(v);
  const d = Number.isFinite(n) && /^\d+$/.test(v) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Converts values produced by a field-mapping workflow into a response or conversion input. */
export function mappedToInput(
  mapped: MappedValues,
  kind: "auto" | "response" | "conversion",
): { type: "response"; response: ResponseInput } | { type: "conversion"; conversion: ConversionInput } | { type: "invalid"; error: string } {
  const value = mapped.dealValue ? valueToNumber(mapped.dealValue) : null;
  const cur = mapped.dealCurrency && /^[A-Za-z]{3}$/.test(mapped.dealCurrency.trim()) ? mapped.dealCurrency.trim().toUpperCase() : null;
  const occurredAt = toDate(mapped.occurredAt);
  const isResponse = kind === "response" || (kind === "auto" && !!mapped.channel);
  if (isResponse) {
    if (!mapped.channel) return { type: "invalid", error: "Mapped channel field is empty in this payload" };
    return {
      type: "response",
      response: {
        channel: mapped.channel,
        rawAnswer: mapped.channel,
        channelDetail: mapped.channelDetail ?? null,
        freetext: mapped.freetext ?? null,
        email: mapped.email ?? null,
        externalId: mapped.externalId ?? null,
        name: mapped.name ?? null,
        dealValue: value,
        dealCurrency: cur,
        transactionId: mapped.transactionId ?? null,
        formId: mapped.formId ?? null,
        formName: mapped.formName ?? null,
        pageUrl: mapped.pageUrl ?? null,
        occurredAt,
        metadata: mapped.metadata ?? null,
      },
    };
  }
  if (!mapped.transactionId && value == null) return { type: "invalid", error: "Mapped order id / value fields are empty in this payload" };
  return {
    type: "conversion",
    conversion: {
      transactionId: mapped.transactionId ?? null,
      kind: "purchase",
      value,
      currency: cur,
      email: mapped.email ?? null,
      pageUrl: mapped.pageUrl ?? null,
      occurredAt,
      metadata: mapped.metadata ?? null,
    },
  };
}

/** Clamps + cleans strings coming from untrusted sources. */
export function cleanText(v: unknown, max = 500): string | null {
  const s = valueToString(v);
  if (!s) return null;
  // Strip control characters.
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").slice(0, max) || null;
}

export function cleanUrl(v: unknown): string | null {
  const s = cleanText(v, 2000);
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    // Drop query strings (may contain emails / tokens) — keep origin + path.
    return `${u.origin}${u.pathname}`.slice(0, 1000);
  } catch {
    return null;
  }
}
