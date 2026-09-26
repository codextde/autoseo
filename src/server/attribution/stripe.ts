/**
 * Stripe webhook support: signature verification (Stripe-Signature, HMAC-SHA256, 5 min tolerance)
 * and event → conversion parsing. $0 checkouts are trials, recurring invoices are renewals.
 * Pure module (node:crypto only).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { ConversionInput } from "./types";

const ZERO_DECIMAL = new Set(["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"]);

export function stripeAmount(amount: unknown, currency: unknown): number | null {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
  const cur = typeof currency === "string" ? currency.toLowerCase() : "";
  return ZERO_DECIMAL.has(cur) ? amount : amount / 100;
}

/** Verifies a `Stripe-Signature` header (`t=…,v1=…`) against the raw body and signing secret. */
export function verifyStripeSignature(
  rawBody: string,
  header: string | null | undefined,
  secret: string,
  opts: { toleranceSec?: number; now?: number } = {},
): { ok: true } | { ok: false; reason: string } {
  if (!header) return { ok: false, reason: "Missing Stripe-Signature header" };
  if (!secret) return { ok: false, reason: "No Stripe signing secret configured" };
  const parts = header.split(",").map((p) => p.trim());
  const t = parts.find((p) => p.startsWith("t="))?.slice(2);
  const sigs = parts.filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || !sigs.length) return { ok: false, reason: "Malformed Stripe-Signature header" };
  const ts = Number(t);
  if (!Number.isFinite(ts)) return { ok: false, reason: "Malformed timestamp" };
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > (opts.toleranceSec ?? 300)) return { ok: false, reason: "Timestamp outside tolerance" };
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const exp = Buffer.from(expected, "hex");
  const match = sigs.some((s) => {
    const b = Buffer.from(s, "hex");
    return b.length === exp.length && timingSafeEqual(b, exp);
  });
  return match ? { ok: true } : { ok: false, reason: "Signature mismatch" };
}

/** Helper for tests / the "send test event" button: builds a valid header for a payload. */
export function signStripePayload(rawBody: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const sig = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${sig}`;
}

type StripeObj = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export type StripeParseResult =
  | { type: "conversion"; conversion: ConversionInput; event: string }
  | { type: "ignored"; event: string; reason: string };

/** Maps a Stripe event to a conversion (or ignores it). */
export function parseStripeEvent(event: unknown): StripeParseResult {
  const e = (event ?? {}) as StripeObj;
  const type = str(e.type) ?? "unknown";
  const obj = ((e.data as StripeObj | undefined)?.object ?? {}) as StripeObj;
  const created = typeof e.created === "number" ? new Date(e.created * 1000) : new Date();

  if (type === "checkout.session.completed" || type === "checkout.session.async_payment_succeeded") {
    if (type === "checkout.session.completed" && obj.payment_status === "unpaid" && obj.mode === "payment") {
      return { type: "ignored", event: type, reason: "Payment not completed yet (async payment)" };
    }
    const currency = str(obj.currency)?.toUpperCase() ?? null;
    const value = stripeAmount(obj.amount_total, obj.currency) ?? 0;
    const meta = (obj.metadata ?? {}) as Record<string, unknown>;
    const details = (obj.customer_details ?? {}) as StripeObj;
    // Subscriptions are always keyed on the subscription id so the first invoice
    // (invoice.paid · subscription_create) dedupes with this checkout.
    const transactionId =
      obj.mode === "subscription" && str(obj.subscription)
        ? str(obj.subscription)
        : (str(meta.transaction_id) ?? str(meta.order_id) ?? str(obj.id));
    return {
      type: "conversion",
      event: type,
      conversion: {
        transactionId,
        kind: value === 0 ? "trial" : "purchase",
        value,
        currency,
        email: str(details.email) ?? str(obj.customer_email),
        occurredAt: typeof obj.created === "number" ? new Date(obj.created * 1000) : created,
        metadata: {
          stripeEvent: type,
          checkoutSession: str(obj.id),
          mode: str(obj.mode),
          clientReferenceId: str(obj.client_reference_id),
          subscription: str(obj.subscription),
        },
      },
    };
  }

  if (type === "invoice.paid" || type === "invoice.payment_succeeded") {
    const reason = str(obj.billing_reason);
    const currency = str(obj.currency)?.toUpperCase() ?? null;
    const value = stripeAmount(obj.amount_paid, obj.currency) ?? 0;
    const subscription = str(obj.subscription) ?? str((obj.parent as StripeObj | undefined)?.subscription_details && ((obj.parent as StripeObj).subscription_details as StripeObj).subscription);
    const base = {
      currency,
      value,
      email: str(obj.customer_email),
      occurredAt: typeof obj.created === "number" ? new Date(obj.created * 1000) : created,
    };
    if (reason === "subscription_cycle") {
      return {
        type: "conversion",
        event: type,
        conversion: { ...base, transactionId: str(obj.id), kind: "renewal", metadata: { stripeEvent: type, invoice: str(obj.id), subscription } },
      };
    }
    if (reason === "subscription_create") {
      // Same transaction id as the checkout session (subscription id) → deduped when both arrive.
      return {
        type: "conversion",
        event: type,
        conversion: {
          ...base,
          transactionId: subscription ?? str(obj.id),
          kind: value === 0 ? "trial" : "purchase",
          metadata: { stripeEvent: type, invoice: str(obj.id), subscription },
        },
      };
    }
    return { type: "ignored", event: type, reason: `Invoice billing reason "${reason ?? "unknown"}" is not tracked` };
  }

  return { type: "ignored", event: type, reason: "Event type not used for attribution" };
}
