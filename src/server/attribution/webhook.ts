import "server-only";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { attributionWebhookLogs, attributionWorkflows, projects } from "@/server/db/schema";
import { decryptJson, encryptJson, sha256 } from "@/server/crypto";
import { getSourceById, getSourceRow, recordSourceEvent, sourceSecretsOf } from "./sources";
import { rateLimit } from "@/server/rate-limit";
import { enqueueJob } from "@/server/jobs/queue";
import { ingestConversion, ingestResponse } from "./ingest";
import {
  applyMapping,
  detectProvider,
  getPath,
  isMappingUsable,
  payloadFingerprint,
  preprocessPayload,
  redactPayload,
  suggestMapping,
} from "./mapping";
import { mappedToInput, parseDefaultPayload } from "./payloads";
import { getProvider } from "./providers";
import { getAttributionSettings, verifyWebhookToken } from "./settings";
import { parseStripeEvent, verifyStripeSignature } from "./stripe";
import { parseWooOrder, verifyWooSignature } from "./woocommerce";
import type { ConversionInput, FieldMapping, ResponseInput, WebhookLogStatus } from "./types";

export const WEBHOOK_MAX_BYTES = 256 * 1024;
export const WEBHOOK_RATE_LIMIT_PER_MIN = 120;

type LogStatus = WebhookLogStatus | "ignored";

export type WebhookResult = { status: number; body: Record<string, unknown> };

type LogInput = {
  projectId: string;
  status: LogStatus;
  provider?: string | null;
  workflowId?: string | null;
  responseId?: string | null;
  conversionId?: string | null;
  message?: string | null;
  payloadBytes: number;
  payloadKeys?: string[];
  pendingPayload?: unknown;
};

async function writeLog(l: LogInput) {
  try {
    const [row] = await db
      .insert(attributionWebhookLogs)
      .values({
        projectId: l.projectId,
        status: l.status,
        provider: l.provider ?? null,
        workflowId: l.workflowId ?? null,
        responseId: l.responseId ?? null,
        conversionId: l.conversionId ?? null,
        message: l.message?.slice(0, 500) ?? null,
        payloadBytes: l.payloadBytes,
        payloadKeys: (l.payloadKeys ?? []).slice(0, 40).map((k) => k.slice(0, 80)),
        pendingPayload: l.pendingPayload !== undefined ? encryptJson(l.pendingPayload) : null,
      })
      .returning({ id: attributionWebhookLogs.id });
    return row?.id ?? null;
  } catch (err) {
    console.error("[attribution] failed to write webhook log", err instanceof Error ? err.message : err);
    return null;
  }
}

function topKeys(payload: unknown): string[] {
  if (Array.isArray(payload)) return ["[array]", ...topKeys(payload[0])];
  return payload && typeof payload === "object" ? Object.keys(payload as object) : [];
}

async function bumpSource(sourceId: string | null) {
  if (!sourceId) return;
  await recordSourceEvent(await getSourceById(sourceId));
}

async function sourceSecretsFor(sourceId: string | null, projectId: string, provider: string) {
  const row = sourceId ? await getSourceById(sourceId) : await getSourceRow(projectId, provider);
  const usable = row && row.projectId === projectId && row.status !== "disconnected" ? row : null;
  return { row: usable, secrets: sourceSecretsOf(usable) };
}

export type WebhookRequest = {
  projectId: string;
  token: string | null;
  source: string | null;
  workflowId: string | null;
  rawBody: string;
  /** Parsed body for form-encoded / multipart requests. */
  formBody: Record<string, unknown> | null;
  contentType: string;
  headers: Headers;
  /** Client IP (for the rate limit of failed attempts). */
  ip?: string | null;
  /** In-app "send test payload" (already authorized via attribution.manage): skips token + signatures. */
  trusted?: boolean;
};

/** Full webhook pipeline: auth → rate limit → parse → provider parser / field mapping / default schema → ingest → log. */
export async function processWebhook(req: WebhookRequest): Promise<WebhookResult> {
  const { projectId } = req;
  const bytes = Buffer.byteLength(req.rawBody, "utf8");
  if (!/^prj_[a-z0-9]{6,40}$/.test(projectId)) return { status: 404, body: { error: "Unknown project" } };
  const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return { status: 404, body: { error: "Unknown project" } };

  const auth = req.trusted ? ({ ok: true, sourceId: null, provider: null } as const) : await verifyWebhookToken(projectId, req.token);
  if (!auth.ok) {
    // Failed attempts use a separate per-IP bucket, so they can't exhaust the project's budget.
    if (!rateLimit(`attr:webhook-denied:${sha256(req.ip ?? "unknown").slice(0, 24)}`, 30, 60_000)) {
      return { status: 429, body: { error: "Too many invalid requests" } };
    }
    await writeLog({ projectId, status: "invalid_token", provider: req.source, message: "Missing or invalid token", payloadBytes: bytes });
    return { status: 401, body: { error: "Invalid token" } };
  }

  if (!req.trusted && !rateLimit(`attr:webhook:${projectId}`, WEBHOOK_RATE_LIMIT_PER_MIN, 60_000)) {
    return { status: 429, body: { error: "Rate limit exceeded (120 requests per minute per project)" } };
  }

  if (bytes > WEBHOOK_MAX_BYTES) {
    await writeLog({ projectId, status: "error", provider: auth.provider ?? req.source, message: "Payload too large (max 256 KB)", payloadBytes: bytes });
    return { status: 413, body: { error: "Payload too large" } };
  }

  // Parse body
  let payload: unknown = req.formBody;
  if (!payload) {
    const text = req.rawBody.trim();
    if (!text) {
      await writeLog({ projectId, status: "parse_failed", provider: auth.provider ?? req.source, message: "Empty body", payloadBytes: bytes });
      return { status: 400, body: { error: "Empty body" } };
    }
    try {
      payload = JSON.parse(text);
    } catch {
      await writeLog({ projectId, status: "parse_failed", provider: auth.provider ?? req.source, message: "Body is not valid JSON", payloadBytes: bytes });
      return { status: 400, body: { error: "Body must be JSON" } };
    }
  }
  const keys = topKeys(payload);
  const explicitProvider = auth.provider ?? (req.source && getProvider(req.source) ? req.source : null);
  const provider = explicitProvider ?? detectProvider(payload);
  const log = (l: Omit<LogInput, "projectId" | "payloadBytes" | "payloadKeys">) =>
    writeLog({
      projectId,
      payloadBytes: bytes,
      payloadKeys: keys,
      provider,
      ...l,
      message: req.trusted ? `Test payload${l.message ? ` · ${l.message}` : ""}` : l.message,
    });

  try {
    const settings = await getAttributionSettings(projectId);
    const customChannels = settings.survey.channels;

    /* ───── Stripe (signed) ───── */
    if (provider === "stripe") {
      const { row, secrets } = await sourceSecretsFor(auth.sourceId, projectId, "stripe");
      if (!req.trusted && !secrets.signingSecret) {
        await log({ status: "error", message: "Stripe signing secret not configured (Integrations → Stripe)" });
        return { status: 400, body: { error: "Stripe signing secret not configured" } };
      }
      const v = req.trusted ? ({ ok: true } as const) : verifyStripeSignature(req.rawBody, req.headers.get("stripe-signature"), secrets.signingSecret!);
      if (!v.ok) {
        await log({ status: "invalid_token", message: `Stripe signature: ${v.reason}` });
        return { status: 400, body: { error: v.reason } };
      }
      const parsed = parseStripeEvent(payload);
      if (parsed.type === "ignored") {
        await log({ status: "ignored", message: `${parsed.event}: ${parsed.reason}` });
        await bumpSource(row?.id ?? null);
        return { status: 200, body: { ok: true, ignored: parsed.reason } };
      }
      const r = await ingestConversion(projectId, parsed.conversion, "stripe");
      await log({ status: "stored_conversion", conversionId: r.conversion.id, responseId: r.mergedResponseId, message: `${parsed.event} → ${parsed.conversion.kind}${r.created ? "" : " (deduplicated)"}` });
      await bumpSource(row?.id ?? null);
      return { status: 200, body: { ok: true, conversionId: r.conversion.id, merged: !!r.mergedResponseId } };
    }

    /* ───── WooCommerce (signed) ───── */
    if (provider === "woocommerce" || req.headers.get("x-wc-webhook-topic")) {
      const p = payload as Record<string, unknown>;
      if (p && typeof p === "object" && "webhook_id" in p && Object.keys(p).length <= 2) {
        await log({ status: "ignored", message: "WooCommerce ping" });
        return { status: 200, body: { ok: true, ping: true } };
      }
      const { row, secrets } = await sourceSecretsFor(auth.sourceId, projectId, "woocommerce");
      if (!req.trusted) {
        if (!secrets.signingSecret) {
          await log({ status: "error", message: "WooCommerce payloads need the connected WooCommerce integration (signed with its secret)" });
          return { status: 400, body: { error: "Connect WooCommerce under Integrations and use its webhook URL + secret" } };
        }
        if (!verifyWooSignature(req.rawBody, req.headers.get("x-wc-webhook-signature"), secrets.signingSecret)) {
          await log({ status: "invalid_token", message: "WooCommerce signature mismatch" });
          return { status: 401, body: { error: "Invalid signature" } };
        }
      }
      const parsed = parseWooOrder(payload);
      if (parsed.type === "ignored") {
        await log({ status: "ignored", message: parsed.reason });
        return { status: 200, body: { ok: true, ignored: parsed.reason } };
      }
      const c = await ingestConversion(projectId, parsed.conversion, "woocommerce");
      let responseId: string | null = c.mergedResponseId;
      let note = "Order";
      if (parsed.response) {
        if (c.mergedResponseId) {
          note = "Order (checkout answer already captured on the website)";
        } else {
          // No deal value on the answer itself: the merge fills it from the order (never counted twice).
          const r = await ingestResponse(projectId, { ...parsed.response, dealValue: null, dealCurrency: null }, {
            sourceType: "integration",
            provider: "woocommerce",
            customChannels,
          });
          responseId = r.response.id;
          note = "Order + checkout answer";
        }
      }
      await log({ status: "stored_conversion", conversionId: c.conversion.id, responseId, message: note });
      await bumpSource(row?.id ?? null);
      return { status: 200, body: { ok: true, conversionId: c.conversion.id, responseId } };
    }

    /* ───── Generic: workflow mapping / default schema ───── */
    const processed = preprocessPayload(payload);
    let workflow: typeof attributionWorkflows.$inferSelect | null = null;
    if (req.workflowId) {
      const [w] = await db
        .select()
        .from(attributionWorkflows)
        .where(and(eq(attributionWorkflows.id, req.workflowId), eq(attributionWorkflows.projectId, projectId)))
        .limit(1);
      workflow = w ?? null;
    }
    const fingerprint = payloadFingerprint(processed, provider);
    if (!workflow) {
      const [w] = await db
        .select()
        .from(attributionWorkflows)
        .where(and(eq(attributionWorkflows.projectId, projectId), eq(attributionWorkflows.fingerprint, fingerprint)))
        .limit(1);
      workflow = w ?? null;
    }

    if (workflow && workflow.status === "active" && isMappingUsable(workflow.mapping, workflow.kind)) {
      const result = await ingestMapped(projectId, processed, workflow.mapping, workflow.kind, {
        provider: workflow.provider,
        workflowId: workflow.id,
        customChannels,
        sourceId: auth.sourceId,
      });
      await db
        .update(attributionWorkflows)
        .set(
          result.ok
            ? { processedCount: sql`${attributionWorkflows.processedCount} + 1`, lastPayloadAt: new Date() }
            : { failedCount: sql`${attributionWorkflows.failedCount} + 1`, lastPayloadAt: new Date() },
        )
        .where(eq(attributionWorkflows.id, workflow.id));
      if (!result.ok) {
        await log({ status: "parse_failed", workflowId: workflow.id, message: result.error });
        return { status: 422, body: { error: result.error } };
      }
      await log({ status: result.status, workflowId: workflow.id, responseId: result.responseId, conversionId: result.conversionId });
      await bumpSource(auth.sourceId);
      return { status: 200, body: { ok: true, responseId: result.responseId, conversionId: result.conversionId } };
    }

    if (workflow && workflow.status === "paused") {
      await log({ status: "ignored", workflowId: workflow.id, message: "Workflow paused" });
      return { status: 202, body: { ok: true, ignored: "Workflow paused" } };
    }

    if (!workflow) {
      const def = parseDefaultPayload(processed);
      if (def.type === "response" || def.type === "conversion") {
        const r = await ingestParsed(projectId, def, { provider: provider ?? "custom_webhook", customChannels });
        await log({ status: r.status, responseId: r.responseId, conversionId: r.conversionId });
        await bumpSource(auth.sourceId);
        return { status: 200, body: { ok: true, responseId: r.responseId, conversionId: r.conversionId } };
      }
      if (def.type === "invalid") {
        await log({ status: "parse_failed", message: def.error });
        return { status: 422, body: { error: def.error } };
      }
    }

    // Unknown shape → create (or reuse) a field-mapping workflow and keep the payload encrypted for replay.
    if (!workflow) {
      // Preset rules win over suggestions, but only when they resolve in this payload.
      const preset = Object.fromEntries(
        Object.entries(getProvider(provider)?.presetMapping ?? {}).filter(([k, rule]) => {
          if (k === "metadata") return false;
          const r = rule as { path?: string; constant?: string };
          return !!r.constant || (!!r.path && getPath(processed, r.path) !== undefined);
        }),
      ) as FieldMapping;
      const suggested = suggestMapping(processed);
      const mapping: FieldMapping = { ...suggested, ...preset };
      if (suggested.channel) mapping.channel = suggested.channel;
      const name = `${getProvider(provider)?.name ?? "Custom webhook"} · ${new Date().toISOString().slice(0, 10)}`;
      const [w] = await db
        .insert(attributionWorkflows)
        .values({
          projectId,
          name,
          provider: provider ?? "custom",
          fingerprint,
          kind: "auto",
          status: "needs_mapping",
          mapping,
          samplePayload: redactPayload(processed),
          sampleReceivedAt: new Date(),
          lastPayloadAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [attributionWorkflows.projectId, attributionWorkflows.fingerprint],
          set: { lastPayloadAt: new Date() },
        })
        .returning();
      workflow = w!;
    } else {
      await db
        .update(attributionWorkflows)
        .set({ lastPayloadAt: new Date(), samplePayload: workflow.samplePayload ?? redactPayload(processed) })
        .where(eq(attributionWorkflows.id, workflow.id));
    }
    const pendingCount = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(attributionWebhookLogs)
      .where(and(eq(attributionWebhookLogs.workflowId, workflow.id), isNotNull(attributionWebhookLogs.pendingPayload)));
    await log({
      status: "parse_failed",
      workflowId: workflow.id,
      message: "Needs field mapping — open the workflow under Field Mapping",
      pendingPayload: (pendingCount[0]?.n ?? 0) < 200 ? payload : undefined,
    });
    await bumpSource(auth.sourceId);
    return { status: 202, body: { ok: true, status: "needs_mapping", workflowId: workflow.id } };
  } catch (err) {
    console.error("[attribution] webhook error", err instanceof Error ? err.message : err);
    await log({ status: "error", message: "Internal error while processing the payload" });
    return { status: 500, body: { error: "Internal error" } };
  }
}

type IngestOutcome =
  | { ok: true; status: "stored" | "stored_conversion"; responseId: string | null; conversionId: string | null }
  | { ok: false; error: string };

async function ingestParsed(
  projectId: string,
  parsed: { type: "response"; response: ResponseInput } | { type: "conversion"; conversion: ConversionInput },
  meta: { provider: string; workflowId?: string | null; customChannels: import("./types").SurveyChannel[] },
): Promise<Extract<IngestOutcome, { ok: true }>> {
  if (parsed.type === "response") {
    const r = await ingestResponse(projectId, parsed.response, {
      sourceType: "webhook",
      provider: meta.provider,
      workflowId: meta.workflowId,
      customChannels: meta.customChannels,
    });
    return { ok: true, status: "stored", responseId: r.response.id, conversionId: r.response.conversionId };
  }
  const c = await ingestConversion(projectId, parsed.conversion, "webhook");
  return { ok: true, status: "stored_conversion", responseId: c.mergedResponseId, conversionId: c.conversion.id };
}

/** Applies a workflow mapping to a (pre-processed) payload and ingests it. */
export async function ingestMapped(
  projectId: string,
  processed: unknown,
  mapping: FieldMapping,
  kind: "auto" | "response" | "conversion",
  meta: { provider: string; workflowId: string; customChannels: import("./types").SurveyChannel[]; sourceId?: string | null },
): Promise<IngestOutcome> {
  const mapped = applyMapping(processed, mapping);
  const input = mappedToInput(mapped, kind);
  if (input.type === "invalid") return { ok: false, error: input.error };
  return ingestParsed(projectId, input, meta);
}

/** Re-processes payloads that arrived before a workflow was mapped (runs as a job). */
export async function reprocessWorkflow(projectId: string, workflowId: string): Promise<{ stored: number; failed: number }> {
  const [workflow] = await db
    .select()
    .from(attributionWorkflows)
    .where(and(eq(attributionWorkflows.id, workflowId), eq(attributionWorkflows.projectId, projectId)))
    .limit(1);
  if (!workflow || workflow.status !== "active") return { stored: 0, failed: 0 };
  const settings = await getAttributionSettings(projectId);
  const pending = await db
    .select({ id: attributionWebhookLogs.id, pendingPayload: attributionWebhookLogs.pendingPayload })
    .from(attributionWebhookLogs)
    .where(and(eq(attributionWebhookLogs.workflowId, workflowId), eq(attributionWebhookLogs.projectId, projectId), isNotNull(attributionWebhookLogs.pendingPayload)))
    .limit(500);
  let stored = 0;
  let failed = 0;
  for (const p of pending) {
    let payload: unknown;
    try {
      payload = decryptJson(p.pendingPayload!);
    } catch {
      await db.update(attributionWebhookLogs).set({ pendingPayload: null, status: "error", message: "Could not decrypt pending payload" }).where(eq(attributionWebhookLogs.id, p.id));
      failed++;
      continue;
    }
    const result = await ingestMapped(projectId, preprocessPayload(payload), workflow.mapping, workflow.kind, {
      provider: workflow.provider,
      workflowId,
      customChannels: settings.survey.channels,
    });
    if (result.ok) {
      stored++;
      await db
        .update(attributionWebhookLogs)
        .set({ pendingPayload: null, status: result.status, responseId: result.responseId, conversionId: result.conversionId, message: "Processed after field mapping" })
        .where(eq(attributionWebhookLogs.id, p.id));
    } else {
      failed++;
      await db.update(attributionWebhookLogs).set({ pendingPayload: null, message: result.error }).where(eq(attributionWebhookLogs.id, p.id));
    }
  }
  if (stored || failed) {
    await db
      .update(attributionWorkflows)
      .set({ processedCount: sql`${attributionWorkflows.processedCount} + ${stored}`, failedCount: sql`${attributionWorkflows.failedCount} + ${failed}` })
      .where(eq(attributionWorkflows.id, workflowId));
  }
  return { stored, failed };
}

export async function enqueueReprocess(projectId: string, workflowId: string) {
  await enqueueJob("attribution.reprocess-workflow", { projectId, workflowId }, { projectId, dedupeKey: `attr-reprocess:${workflowId}` });
}
