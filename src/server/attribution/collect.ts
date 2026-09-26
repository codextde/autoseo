import "server-only";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "@/server/db/client";
import { attributionSettings } from "@/server/db/schema";
import { sha256 } from "@/server/crypto";
import { rateLimit } from "@/server/rate-limit";
import { ingestConversion, ingestResponse } from "./ingest";
import { findSettingsByPublicKey } from "./settings";
import { touchPixelSource } from "./sources";
import type { ConversionSourceType } from "./types";
import { collectSchema } from "./collect-schema";

export { collectSchema };

export const COLLECT_MAX_BYTES = 16 * 1024;
export const COLLECT_RATE_LIMIT_PER_MIN = 60;

function hostAllowed(origin: string | null, allowed: string[]): boolean {
  if (!allowed.length) return true;
  if (!origin || origin === "null") return false;
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  return allowed.some((a) => {
    const d = a.toLowerCase().replace(/^\*\./, "");
    return host === d || host.endsWith(`.${d}`);
  });
}

export type CollectResult = { status: number; error?: string };

/** Handles a snippet / pixel event. No cookies, no PII in logs; emails are hashed. */
export async function handleCollect(input: { body: string; ip: string | null; origin: string | null }): Promise<CollectResult> {
  if (!rateLimit(`attr:collect:${sha256(input.ip ?? "unknown").slice(0, 24)}`, COLLECT_RATE_LIMIT_PER_MIN, 60_000)) {
    return { status: 429, error: "Rate limit exceeded" };
  }
  if (Buffer.byteLength(input.body, "utf8") > COLLECT_MAX_BYTES) return { status: 413, error: "Payload too large" };
  let json: unknown;
  try {
    json = JSON.parse(input.body);
  } catch {
    return { status: 400, error: "Invalid JSON" };
  }
  const parsed = collectSchema.safeParse(json);
  if (!parsed.success) return { status: 400, error: "Invalid payload" };
  const e = parsed.data;
  const settings = await findSettingsByPublicKey(e.k);
  if (!settings) return { status: 404, error: "Unknown key" };
  if (!hostAllowed(input.origin, settings.allowedDomains)) return { status: 403, error: "Origin not allowed" };
  const projectId = settings.projectId;

  // Liveness for the setup "verify" step (throttled writes).
  let origin: string | null = null;
  try {
    origin = input.origin && input.origin !== "null" ? new URL(input.origin).origin : e.u ? new URL(e.u).origin : null;
  } catch {
    origin = null;
  }
  const now = new Date();
  await db
    .update(attributionSettings)
    .set({ snippetLastSeenAt: now, snippetLastOrigin: origin ?? settings.snippetLastOrigin, snippetFirstSeenAt: settings.snippetFirstSeenAt ?? now })
    .where(
      and(
        eq(attributionSettings.projectId, projectId),
        or(isNull(attributionSettings.snippetLastSeenAt), lt(attributionSettings.snippetLastSeenAt, new Date(now.getTime() - 30_000))),
      ),
    );

  if (e.t === "seen") return { status: 204 };

  if (e.t === "response" && e.r) {
    const r = e.r;
    const answer = r.answer ?? r.channel ?? null;
    if (!answer && !r.freetext) return { status: 400, error: "Empty answer" };
    await ingestResponse(
      projectId,
      {
        channel: r.mode === "popup" ? (r.channel ?? answer) : answer,
        channelDetail: r.detail ?? null,
        rawAnswer: answer,
        freetext: r.freetext ?? null,
        email: r.email ?? null,
        emailHash: r.emailHash ?? null,
        emailMask: r.emailMask ?? null,
        // Browser-reported order ids are not trusted as merge keys (the public key is spoofable);
        // the answer links to the order through the same-browser visitor id instead.
        transactionId: null,
        formId: r.formId ?? null,
        formName: r.formName ?? null,
        pageUrl: e.u ?? null,
        visitorId: e.v,
        metadata: {
          trigger: r.trigger ?? (r.mode === "form" ? "form_submit" : null),
          question: r.mode === "form" ? (r.question ?? null) : null,
          clientTransactionId: r.transactionId ?? null,
          origin,
        },
      },
      {
        sourceType: r.mode === "form" ? "form" : "snippet",
        provider: r.mode === "form" ? "form_detect" : "website_widget",
        customChannels: settings.survey.channels,
      },
    );
    return { status: 204 };
  }

  if (e.t === "conversion" && e.c) {
    const c = e.c;
    const source: ConversionSourceType = c.via === "ga" ? "snippet_ga" : c.via === "meta" ? "snippet_meta" : c.via === "shopify" ? "shopify" : "snippet_api";
    await ingestConversion(
      projectId,
      {
        transactionId: c.transactionId ?? null,
        kind: c.kind,
        value: c.value ?? null,
        currency: c.currency ?? null,
        email: c.email ?? null,
        emailHash: c.emailHash ?? null,
        emailMask: c.emailMask ?? null,
        visitorId: e.v,
        pageUrl: e.u ?? null,
        items: c.items ?? null,
        metadata: { via: c.via, origin },
      },
      source,
    );
    if (c.via === "shopify") await touchPixelSource(projectId, "shopify");
    return { status: 204 };
  }
  return { status: 400, error: "Missing event body" };
}
