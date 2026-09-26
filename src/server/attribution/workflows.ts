import "server-only";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { attributionWebhookLogs, attributionWorkflows } from "@/server/db/schema";
import { applyMapping, flattenPaths, isMappingUsable, type FlatField } from "./mapping";
import { mappedToInput } from "./payloads";
import { normalizeChannel } from "./channels";
import { enqueueReprocess } from "./webhook";
import type { FieldMapping, WorkflowKind, WorkflowStatus } from "./types";

export type WorkflowDTO = {
  id: string;
  name: string;
  provider: string;
  kind: WorkflowKind;
  status: WorkflowStatus;
  mapping: FieldMapping;
  fields: FlatField[];
  sampleReceivedAt: string | null;
  lastPayloadAt: string | null;
  processedCount: number;
  failedCount: number;
  pendingCount: number;
  createdAt: string;
};

export async function listWorkflows(projectId: string): Promise<WorkflowDTO[]> {
  const [rows, pending] = await Promise.all([
    db.select().from(attributionWorkflows).where(eq(attributionWorkflows.projectId, projectId)).orderBy(desc(attributionWorkflows.createdAt)),
    db
      .select({ workflowId: attributionWebhookLogs.workflowId, n: sql<number>`count(*)::int` })
      .from(attributionWebhookLogs)
      .where(and(eq(attributionWebhookLogs.projectId, projectId), isNotNull(attributionWebhookLogs.pendingPayload)))
      .groupBy(attributionWebhookLogs.workflowId),
  ]);
  const pend = new Map(pending.map((p) => [p.workflowId, p.n]));
  return rows.map((w) => ({
    id: w.id,
    name: w.name,
    provider: w.provider,
    kind: w.kind,
    status: w.status,
    mapping: w.mapping,
    fields: w.samplePayload ? flattenPaths(w.samplePayload, 300) : [],
    sampleReceivedAt: w.sampleReceivedAt?.toISOString() ?? null,
    lastPayloadAt: w.lastPayloadAt?.toISOString() ?? null,
    processedCount: w.processedCount,
    failedCount: w.failedCount,
    pendingCount: pend.get(w.id) ?? 0,
    createdAt: w.createdAt.toISOString(),
  }));
}

/** Preview of how the stored (redacted) sample parses with a mapping. */
export function previewMapping(sample: unknown, mapping: FieldMapping, kind: WorkflowKind) {
  const mapped = applyMapping(sample, mapping);
  const input = mappedToInput(mapped, kind);
  const channel = mapped.channel ? normalizeChannel(mapped.channel) : null;
  return { mapped, result: input.type, error: input.type === "invalid" ? input.error : null, channel };
}

export async function getWorkflowSample(projectId: string, id: string) {
  const [w] = await db
    .select()
    .from(attributionWorkflows)
    .where(and(eq(attributionWorkflows.id, id), eq(attributionWorkflows.projectId, projectId)))
    .limit(1);
  return w ?? null;
}

export async function saveWorkflow(
  projectId: string,
  id: string,
  patch: { name?: string; kind?: WorkflowKind; mapping?: FieldMapping; status?: WorkflowStatus },
): Promise<{ status: WorkflowStatus; reprocessing: boolean }> {
  const w = await getWorkflowSample(projectId, id);
  if (!w) throw new Error("Workflow not found");
  const mapping = patch.mapping ?? w.mapping;
  const kind = patch.kind ?? w.kind;
  let status: WorkflowStatus = patch.status ?? w.status;
  if (status === "active" && !isMappingUsable(mapping, kind)) {
    throw new Error(kind === "conversion" ? "Map at least the order id or deal value" : "Map the channel (answer) field first");
  }
  if (patch.mapping && status === "needs_mapping" && isMappingUsable(mapping, kind)) status = "active";
  await db
    .update(attributionWorkflows)
    .set({ name: patch.name?.trim().slice(0, 120) || w.name, kind, mapping, status, updatedAt: new Date() })
    .where(and(eq(attributionWorkflows.id, id), eq(attributionWorkflows.projectId, projectId)));
  let reprocessing = false;
  if (status === "active") {
    const [p] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(attributionWebhookLogs)
      .where(and(eq(attributionWebhookLogs.workflowId, id), isNotNull(attributionWebhookLogs.pendingPayload)));
    if ((p?.n ?? 0) > 0) {
      await enqueueReprocess(projectId, id);
      reprocessing = true;
    }
  }
  return { status, reprocessing };
}

export async function deleteWorkflow(projectId: string, id: string) {
  await db
    .update(attributionWebhookLogs)
    .set({ pendingPayload: null })
    .where(and(eq(attributionWebhookLogs.projectId, projectId), eq(attributionWebhookLogs.workflowId, id)));
  await db.delete(attributionWorkflows).where(and(eq(attributionWorkflows.id, id), eq(attributionWorkflows.projectId, projectId)));
}

export type WebhookLogDTO = {
  id: string;
  status: string;
  provider: string | null;
  workflowId: string | null;
  responseId: string | null;
  conversionId: string | null;
  message: string | null;
  payloadBytes: number;
  payloadKeys: string[];
  pending: boolean;
  createdAt: string;
};

export async function listWebhookLogs(projectId: string, opts: { status?: string; limit?: number } = {}): Promise<WebhookLogDTO[]> {
  const rows = await db
    .select({
      id: attributionWebhookLogs.id,
      status: attributionWebhookLogs.status,
      provider: attributionWebhookLogs.provider,
      workflowId: attributionWebhookLogs.workflowId,
      responseId: attributionWebhookLogs.responseId,
      conversionId: attributionWebhookLogs.conversionId,
      message: attributionWebhookLogs.message,
      payloadBytes: attributionWebhookLogs.payloadBytes,
      payloadKeys: attributionWebhookLogs.payloadKeys,
      pending: sql<boolean>`${attributionWebhookLogs.pendingPayload} is not null`,
      createdAt: attributionWebhookLogs.createdAt,
    })
    .from(attributionWebhookLogs)
    .where(
      and(
        eq(attributionWebhookLogs.projectId, projectId),
        opts.status && opts.status !== "all" ? eq(attributionWebhookLogs.status, opts.status as never) : undefined,
      ),
    )
    .orderBy(desc(attributionWebhookLogs.createdAt))
    .limit(Math.min(500, opts.limit ?? 200));
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}
