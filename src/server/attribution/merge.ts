/**
 * Merge logic between Responses ("How did you hear about us?") and Conversions (orders/leads).
 *
 *  - Keys, strongest first: transaction/order id → email hash → snippet visitor id (same browser).
 *  - A new conversion looks back 90 days for an unmatched answer (and accepts answers given up to 48h
 *    after the conversion, e.g. post-purchase surveys).
 *  - A new answer looks back 48h for unmatched conversions (and forward for conversions that were
 *    recorded before the answer was imported).
 *  - Transaction-id matches are exact, so they only need to fall inside the 90-day window.
 *  - Matches are 1:1. Renewals never merge (they would double count the original deal).
 *  - The conversion value fills an empty response deal value — it's never added on top.
 * Pure module so it can be unit-tested.
 */

export const CONVERSION_LOOKBACK_DAYS = 90;
export const RESPONSE_LOOKBACK_HOURS = 48;

const DAY = 86_400_000;
const HOUR = 3_600_000;

export type MatchVia = "transaction" | "email" | "visitor";

export type ResponseCandidate = {
  id: string;
  transactionId: string | null;
  emailHash: string | null;
  visitorId: string | null;
  respondedAt: Date;
  conversionId: string | null;
};

export type ConversionCandidate = {
  id: string;
  transactionId: string | null;
  emailHash: string | null;
  visitorId: string | null;
  occurredAt: Date;
  responseId: string | null;
  kind: string;
};

const RANK: Record<MatchVia, number> = { transaction: 0, email: 1, visitor: 2 };

function keyMatch(
  a: { transactionId: string | null; emailHash: string | null; visitorId: string | null },
  b: { transactionId: string | null; emailHash: string | null; visitorId: string | null },
): MatchVia | null {
  if (a.transactionId && b.transactionId && a.transactionId === b.transactionId) return "transaction";
  if (a.emailHash && b.emailHash && a.emailHash === b.emailHash) return "email";
  if (a.visitorId && b.visitorId && a.visitorId === b.visitorId) return "visitor";
  return null;
}

/** Time window in which a response may be merged with a conversion at `occurredAt`. */
export function responseWindowForConversion(occurredAt: Date) {
  return {
    from: new Date(occurredAt.getTime() - CONVERSION_LOOKBACK_DAYS * DAY),
    to: new Date(occurredAt.getTime() + RESPONSE_LOOKBACK_HOURS * HOUR),
  };
}

/** Time window in which a conversion may be merged with a response at `respondedAt`. */
export function conversionWindowForResponse(respondedAt: Date, via: MatchVia) {
  if (via === "transaction") {
    return {
      from: new Date(respondedAt.getTime() - CONVERSION_LOOKBACK_DAYS * DAY),
      to: new Date(respondedAt.getTime() + CONVERSION_LOOKBACK_DAYS * DAY),
    };
  }
  return {
    from: new Date(respondedAt.getTime() - RESPONSE_LOOKBACK_HOURS * HOUR),
    to: new Date(respondedAt.getTime() + CONVERSION_LOOKBACK_DAYS * DAY),
  };
}

/** Picks the best unmatched response for a new conversion (or null). */
export function matchResponseForConversion(
  conversion: Omit<ConversionCandidate, "responseId" | "id"> & { id?: string },
  responses: ResponseCandidate[],
): { response: ResponseCandidate; via: MatchVia } | null {
  if (conversion.kind === "renewal") return null;
  const window = responseWindowForConversion(conversion.occurredAt);
  let best: { response: ResponseCandidate; via: MatchVia; distance: number } | null = null;
  for (const r of responses) {
    if (r.conversionId) continue;
    const via = keyMatch(r, conversion);
    if (!via) continue;
    const t = r.respondedAt.getTime();
    if (t < window.from.getTime() || t > window.to.getTime()) continue;
    // Prefer answers given before the conversion; tie-break by closeness in time.
    const distance = Math.abs(conversion.occurredAt.getTime() - t) + (t > conversion.occurredAt.getTime() ? HOUR : 0);
    if (!best || RANK[via] < RANK[best.via] || (RANK[via] === RANK[best.via] && distance < best.distance)) {
      best = { response: r, via, distance };
    }
  }
  return best ? { response: best.response, via: best.via } : null;
}

/** Picks the best unmatched conversion for a new response (or null). */
export function matchConversionForResponse(
  response: Omit<ResponseCandidate, "conversionId" | "id"> & { id?: string },
  conversions: ConversionCandidate[],
): { conversion: ConversionCandidate; via: MatchVia } | null {
  let best: { conversion: ConversionCandidate; via: MatchVia; distance: number } | null = null;
  for (const c of conversions) {
    if (c.responseId || c.kind === "renewal") continue;
    const via = keyMatch(response, c);
    if (!via) continue;
    const window = conversionWindowForResponse(response.respondedAt, via);
    const t = c.occurredAt.getTime();
    if (t < window.from.getTime() || t > window.to.getTime()) continue;
    const distance = Math.abs(response.respondedAt.getTime() - t);
    if (!best || RANK[via] < RANK[best.via] || (RANK[via] === RANK[best.via] && distance < best.distance)) {
      best = { conversion: c, via, distance };
    }
  }
  return best ? { conversion: best.conversion, via: best.via } : null;
}

/**
 * Deal value after merging: the conversion value only fills an empty (null/0) response value, so a
 * deal is never counted twice.
 */
export function mergedDealValue(
  response: { dealValue: number | null; dealCurrency: string | null },
  conversion: { value: number | null; currency: string | null },
): { dealValue: number | null; dealCurrency: string | null; valueSource: "response" | "conversion" | null } {
  if (response.dealValue != null && response.dealValue > 0) {
    return { dealValue: response.dealValue, dealCurrency: response.dealCurrency, valueSource: "response" };
  }
  if (conversion.value != null && conversion.value > 0) {
    return { dealValue: conversion.value, dealCurrency: conversion.currency ?? response.dealCurrency, valueSource: "conversion" };
  }
  return { dealValue: response.dealValue, dealCurrency: response.dealCurrency, valueSource: response.dealValue != null ? "response" : null };
}
