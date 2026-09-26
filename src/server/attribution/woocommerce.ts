/**
 * WooCommerce native webhooks (Settings → Advanced → Webhooks, topic "Order created/updated").
 * Signature: base64(HMAC-SHA256(rawBody, secret)) in `X-WC-Webhook-Signature`.
 * Pure module (node:crypto only).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { HDYHAU_PATTERN } from "./channels";
import { valueToNumber, valueToString } from "./mapping";
import type { ConversionInput, ResponseInput } from "./types";

export function verifyWooSignature(rawBody: string, header: string | null | undefined, secret: string): boolean {
  if (!header || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  let got: Buffer;
  try {
    got = Buffer.from(header, "base64");
  } catch {
    return false;
  }
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export function signWooPayload(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("base64");
}

const PAID_STATUSES = new Set(["processing", "completed", "on-hold"]);

export type WooParseResult =
  | { type: "order"; conversion: ConversionInput; response: ResponseInput | null }
  | { type: "ignored"; reason: string };

export function parseWooOrder(order: unknown): WooParseResult {
  const o = (order ?? {}) as Record<string, unknown>;
  if (!("order_key" in o) && !("line_items" in o)) return { type: "ignored", reason: "Not a WooCommerce order payload" };
  const status = valueToString(o.status) ?? "";
  if (status && !PAID_STATUSES.has(status)) return { type: "ignored", reason: `Order status "${status}" is not paid yet` };
  const billing = (o.billing ?? {}) as Record<string, unknown>;
  const transactionId = valueToString(o.number) ?? valueToString(o.id);
  const occurredAtRaw = valueToString(o.date_paid_gmt) ?? valueToString(o.date_created_gmt) ?? valueToString(o.date_created);
  const occurredAt = occurredAtRaw ? new Date(occurredAtRaw.endsWith("Z") || /[+-]\d\d:?\d\d$/.test(occurredAtRaw) ? occurredAtRaw : `${occurredAtRaw}Z`) : new Date();
  const items = Array.isArray(o.line_items)
    ? (o.line_items as Array<Record<string, unknown>>).slice(0, 50).map((li) => ({
        name: valueToString(li.name),
        sku: valueToString(li.sku),
        quantity: valueToNumber(li.quantity),
        total: valueToNumber(li.total),
      }))
    : null;
  const conversion: ConversionInput = {
    transactionId,
    kind: "purchase",
    value: valueToNumber(o.total),
    currency: valueToString(o.currency)?.toUpperCase() ?? null,
    email: valueToString(billing.email),
    occurredAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
    items,
    metadata: { wooOrderId: valueToString(o.id), status },
  };

  // Checkout "How did you hear about us?" fields are usually stored in order meta.
  let response: ResponseInput | null = null;
  if (Array.isArray(o.meta_data)) {
    const hit = (o.meta_data as Array<Record<string, unknown>>).find(
      (m) => typeof m.key === "string" && (HDYHAU_PATTERN.test(m.key.replace(/_/g, " ")) || /hdyhau|hear_about|heard_about|how_did_you/i.test(m.key)) && valueToString(m.value),
    );
    if (hit) {
      response = {
        rawAnswer: valueToString(hit.value),
        email: conversion.email,
        transactionId,
        dealValue: conversion.value,
        dealCurrency: conversion.currency,
        formName: "WooCommerce checkout",
        occurredAt: conversion.occurredAt,
        dedupeKey: `woocommerce:${transactionId}`,
      };
    }
  }
  return { type: "order", conversion, response };
}
