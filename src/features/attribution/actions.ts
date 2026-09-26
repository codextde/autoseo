"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { actionProject, ActionError, runAction } from "@/server/auth/guards";
import { logAudit } from "@/server/audit";
import { enqueueJob } from "@/server/jobs/queue";
import { CHANNEL_IDS, AI_DETAIL_IDS, CONVERSION_SOURCES, FORMS_MODES, MAPPING_TARGETS, PLATFORM_IDS } from "@/server/attribution/types";
import { getProvider } from "@/server/attribution/providers";
import { getAttributionSettings, rotateWebhookToken, updateAttributionSettings, webhookUrl } from "@/server/attribution/settings";
import { getAttribution, getLiveStatus, setAttributionStatus } from "@/server/attribution/service";
import { connectSource, disconnectSource, getSourceRow } from "@/server/attribution/sources";
import { importCsv, isImportProvider } from "@/server/attribution/imports";
import { deleteWorkflow, getWorkflowSample, previewMapping, saveWorkflow } from "@/server/attribution/workflows";
import { processWebhook } from "@/server/attribution/webhook";

const projectIdSchema = z.string().regex(/^prj_[a-z0-9]{6,40}$/);

/* ─────────────────────────────── Setup wizard ─────────────────────────────── */

const setupSchema = z.object({
  trackMode: z.enum(["purchases", "leads", "both"]).optional(),
  platform: z.enum(PLATFORM_IDS).nullable().optional(),
  formsMode: z.enum(FORMS_MODES).nullable().optional(),
  conversionSource: z.enum(CONVERSION_SOURCES).nullable().optional(),
  wizardStep: z.number().int().min(1).max(7).optional(),
  complete: z.boolean().optional(),
});

export async function saveSetupAction(projectId: string, input: z.input<typeof setupSchema>) {
  return runAction(async () => {
    const ctx = await actionProject(projectIdSchema.parse(projectId), "attribution.manage");
    const d = setupSchema.parse(input);
    const { complete, ...rest } = d;
    await updateAttributionSettings(ctx.project.id, { ...rest, ...(complete ? { setupCompletedAt: new Date() } : {}) }, ctx.user.id);
    if (complete) await logAudit("attribution.setup.completed", { actor: ctx.user, projectId: ctx.project.id, workspaceId: ctx.project.workspaceId });
    refresh();
    return { ok: true };
  });
}

/* ─────────────────────────────── Survey ─────────────────────────────── */

const hex = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Use a hex color like #111111");
const text = (max: number) => z.string().trim().min(1).max(max);

const surveySchema = z.object({
  enabled: z.boolean(),
  questionEn: text(200),
  questionDe: text(200),
  language: z.enum(["auto", "en", "de"]),
  channels: z
    .array(z.object({ id: z.enum(CHANNEL_IDS), label: text(60), labelDe: text(60), enabled: z.boolean() }))
    .min(2)
    .max(12)
    .refine((c) => new Set(c.map((x) => x.id)).size === c.length, "Each channel can only be listed once"),
  aiDetails: z.boolean(),
  aiOptions: z.array(z.enum(AI_DETAIL_IDS)).max(10),
  otherPlaceholderEn: z.string().trim().max(80),
  otherPlaceholderDe: z.string().trim().max(80),
  thankYouEn: text(120),
  thankYouDe: text(120),
  primaryColor: hex,
  backgroundColor: hex,
  textColor: hex,
  position: z.enum(["bottom-right", "bottom-left", "center"]),
  triggers: z.object({
    pageLoad: z.boolean(),
    pageLoadDelaySec: z.number().int().min(0).max(600),
    formSubmit: z.boolean(),
    purchase: z.boolean(),
  }),
  askOnce: z.boolean(),
  detectExistingQuestions: z.boolean(),
  captureConversions: z.boolean(),
  excludePaths: z.array(z.string().trim().regex(/^\/[^\s<>"']{0,200}$/, "Paths must start with /")).max(30),
});
export type SurveyInput = z.input<typeof surveySchema>;

export async function saveSurveyAction(projectId: string, input: SurveyInput) {
  return runAction(async () => {
    const ctx = await actionProject(projectIdSchema.parse(projectId), "attribution.manage");
    const survey = surveySchema.parse(input);
    await updateAttributionSettings(ctx.project.id, { survey }, ctx.user.id);
    refresh();
    return { ok: true };
  });
}

const advancedSchema = z.object({
  reportingCurrency: z.string().regex(/^[A-Za-z]{3}$/).transform((v) => v.toUpperCase()),
  allowedDomains: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^(\*\.)?([a-z0-9-]+\.)+[a-z]{2,63}$/, "Enter hostnames like shop.example.com"),
    )
    .max(20),
});

export async function saveAdvancedAction(projectId: string, input: z.input<typeof advancedSchema>) {
  return runAction(async () => {
    const ctx = await actionProject(projectIdSchema.parse(projectId), "attribution.manage");
    const d = advancedSchema.parse(input);
    await updateAttributionSettings(ctx.project.id, d, ctx.user.id);
    refresh();
    return { ok: true };
  });
}

/* ─────────────────────────────── Tokens ─────────────────────────────── */

export async function generateWebhookTokenAction(projectId: string) {
  return runAction(async () => {
    const ctx = await actionProject(projectIdSchema.parse(projectId), "attribution.manage");
    const token = await rotateWebhookToken(ctx.project.id, ctx.user.id);
    await logAudit("attribution.webhook_token.rotated", { actor: ctx.user, projectId: ctx.project.id, workspaceId: ctx.project.workspaceId });
    refresh();
    return { token, url: webhookUrl(ctx.project.id, token) };
  });
}

/* ─────────────────────────────── Live status / responses ─────────────────────────────── */

export async function getLiveStatusAction(projectId: string, since?: string) {
  return runAction(async () => {
    const ctx = await actionProject(projectIdSchema.parse(projectId));
    const d = since ? new Date(since) : undefined;
    return getLiveStatus(ctx.project.id, d && !Number.isNaN(d.getTime()) ? d : undefined);
  });
}

export async function getResponseDetailAction(projectId: string, id: string) {
  return runAction(async () => {
    const ctx = await actionProject(projectIdSchema.parse(projectId));
    const detail = await getAttribution(ctx.project.id, z.string().regex(/^atr_[a-z0-9]{6,40}$/).parse(id));
    if (!detail) throw new ActionError("Response not found", "not_found");
    return detail;
  });
}

export async function setResponseStatusAction(projectId: string, id: string, status: "active" | "dismissed") {
  return runAction(async () => {
    const ctx = await actionProject(projectIdSchema.parse(projectId), "attribution.manage");
    const ok = await setAttributionStatus(ctx.project.id, z.string().regex(/^atr_[a-z0-9]{6,40}$/).parse(id), z.enum(["active", "dismissed"]).parse(status), ctx.user.id);
    if (!ok) throw new ActionError("Response not found", "not_found");
    refresh();
    return { ok: true };
  });
}

/* ─────────────────────────────── Integrations ─────────────────────────────── */

const connectSchema = z.object({
  provider: z.string().regex(/^[a-z0-9_]{2,40}$/),
  secrets: z.record(z.string().max(60), z.string().max(500)).optional(),
  config: z.record(z.string().max(60), z.string().max(200)).optional(),
  regenerateToken: z.boolean().optional(),
});

export async function connectSourceAction(projectId: string, input: z.input<typeof connectSchema>) {
  return runAction(async () => {
    const ctx = await actionProject(projectIdSchema.parse(projectId), "attribution.manage");
    const d = connectSchema.parse(input);
    const info = getProvider(d.provider);
    if (!info) throw new ActionError("Unknown integration", "invalid");
    const r = await connectSource(ctx.project.id, d.provider, d, ctx.user.id);
    await logAudit("attribution.source.connected", {
      actor: ctx.user,
      projectId: ctx.project.id,
      workspaceId: ctx.project.workspaceId,
      targetType: "attribution_source",
      targetId: r.source.id,
      meta: { provider: d.provider },
    });
    if (isImportProvider(d.provider)) {
      await enqueueJob("attribution.import", { sourceId: r.source.id }, { projectId: ctx.project.id, dedupeKey: `attr-import:${r.source.id}`, createdBy: ctx.user.id });
    }
    refresh();
    return {
      source: r.source,
      token: r.token,
      url: r.token ? webhookUrl(ctx.project.id, r.token, d.provider) : null,
      generatedSecrets: r.generatedSecrets,
    };
  });
}

export async function disconnectSourceAction(projectId: string, provider: string) {
  return runAction(async () => {
    const ctx = await actionProject(projectIdSchema.parse(projectId), "attribution.manage");
    await disconnectSource(ctx.project.id, z.string().regex(/^[a-z0-9_]{2,40}$/).parse(provider));
    await logAudit("attribution.source.disconnected", { actor: ctx.user, projectId: ctx.project.id, workspaceId: ctx.project.workspaceId, meta: { provider } });
    refresh();
    return { ok: true };
  });
}

export async function syncSourceAction(projectId: string, provider: string) {
  return runAction(async () => {
    const ctx = await actionProject(projectIdSchema.parse(projectId), "attribution.manage");
    const row = await getSourceRow(ctx.project.id, z.string().regex(/^[a-z0-9_]{2,40}$/).parse(provider));
    if (!row || row.status === "disconnected") throw new ActionError("Connect the integration first", "invalid");
    if (!isImportProvider(row.provider)) throw new ActionError("This integration receives data via webhook", "invalid");
    await enqueueJob("attribution.import", { sourceId: row.id }, { projectId: ctx.project.id, dedupeKey: `attr-import:${row.id}`, createdBy: ctx.user.id });
    return { queued: true };
  });
}

export async function importCsvAction(projectId: string, provider: string, csv: string) {
  return runAction(async () => {
    const ctx = await actionProject(projectIdSchema.parse(projectId), "attribution.manage");
    const p = z.string().regex(/^[a-z0-9_]{2,40}$/).parse(provider);
    if (csv.length > 5 * 1024 * 1024) throw new ActionError("CSV files are limited to 5 MB", "invalid");
    const result = await importCsv(ctx.project.id, csv, { provider: p });
    await logAudit("attribution.csv.imported", { actor: ctx.user, projectId: ctx.project.id, workspaceId: ctx.project.workspaceId, meta: { provider: p, imported: result.imported } });
    refresh();
    return result;
  });
}

/* ─────────────────────────────── Field mapping ─────────────────────────────── */

const ruleSchema = z.object({ path: z.string().max(300).optional(), constant: z.string().max(200).optional() });
const mappingSchema = z
  .object(Object.fromEntries(MAPPING_TARGETS.map((t) => [t, ruleSchema.optional()])) as Record<(typeof MAPPING_TARGETS)[number], z.ZodOptional<typeof ruleSchema>>)
  .extend({ metadata: z.array(z.string().max(300)).max(30).optional() });

function cleanMapping(m: z.infer<typeof mappingSchema>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(m)) {
    if (k === "metadata") {
      if (Array.isArray(v) && v.length) out.metadata = v.filter(Boolean);
      continue;
    }
    const r = v as { path?: string; constant?: string } | undefined;
    if (r?.path?.trim()) out[k] = { path: r.path.trim() };
    else if (r?.constant?.trim()) out[k] = { constant: r.constant.trim() };
  }
  return out;
}

const workflowPatchSchema = z.object({
  name: z.string().trim().max(120).optional(),
  kind: z.enum(["auto", "response", "conversion"]).optional(),
  status: z.enum(["needs_mapping", "active", "paused"]).optional(),
  mapping: mappingSchema.optional(),
});

export async function saveWorkflowAction(projectId: string, workflowId: string, input: z.input<typeof workflowPatchSchema>) {
  return runAction(async () => {
    const ctx = await actionProject(projectIdSchema.parse(projectId), "attribution.manage");
    const d = workflowPatchSchema.parse(input);
    const r = await saveWorkflow(ctx.project.id, z.string().regex(/^awf_[a-z0-9]{6,40}$/).parse(workflowId), {
      ...d,
      mapping: d.mapping ? cleanMapping(d.mapping) : undefined,
    });
    refresh();
    return r;
  });
}

export async function previewWorkflowAction(projectId: string, workflowId: string, input: { mapping: z.input<typeof mappingSchema>; kind: "auto" | "response" | "conversion" }) {
  return runAction(async () => {
    const ctx = await actionProject(projectIdSchema.parse(projectId));
    const w = await getWorkflowSample(ctx.project.id, z.string().regex(/^awf_[a-z0-9]{6,40}$/).parse(workflowId));
    if (!w) throw new ActionError("Workflow not found", "not_found");
    return previewMapping(w.samplePayload ?? {}, cleanMapping(mappingSchema.parse(input.mapping)), z.enum(["auto", "response", "conversion"]).parse(input.kind));
  });
}

export async function deleteWorkflowAction(projectId: string, workflowId: string) {
  return runAction(async () => {
    const ctx = await actionProject(projectIdSchema.parse(projectId), "attribution.manage");
    await deleteWorkflow(ctx.project.id, z.string().regex(/^awf_[a-z0-9]{6,40}$/).parse(workflowId));
    refresh();
    return { ok: true };
  });
}

/** "Send a test webhook" from the UI: runs the full pipeline with the pasted JSON (no token needed). */
export async function sendTestPayloadAction(projectId: string, json: string, source?: string | null) {
  return runAction(async () => {
    const ctx = await actionProject(projectIdSchema.parse(projectId), "attribution.manage");
    if (json.length > 256 * 1024) throw new ActionError("Payload too large (max 256 KB)", "invalid");
    try {
      JSON.parse(json);
    } catch {
      throw new ActionError("Paste valid JSON", "invalid");
    }
    const src = source && /^[a-z0-9_]{2,40}$/.test(source) ? source : null;
    const result = await processWebhook({
      projectId: ctx.project.id,
      token: null,
      source: src,
      workflowId: null,
      rawBody: json,
      formBody: null,
      contentType: "application/json",
      headers: new Headers(),
      trusted: true,
    });
    refresh();
    return { status: result.status, body: result.body };
  });
}

export async function getSettingsAction(projectId: string) {
  return runAction(async () => {
    const ctx = await actionProject(projectIdSchema.parse(projectId));
    const s = await getAttributionSettings(ctx.project.id);
    return { survey: s.survey, publicKey: s.publicKey };
  });
}
