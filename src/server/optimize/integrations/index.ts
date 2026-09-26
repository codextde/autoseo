import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { contentPieces, optimizeSettings, optimizeTasks, projects } from "@/server/db/schema";
import type { TaskExternalLink } from "@/server/db/schema";
import { deleteIntegration, saveIntegration } from "@/server/integrations";
import { enqueueJob } from "@/server/jobs/queue";
import { env } from "@/server/env";
import { TASK_CATEGORY_META, type TaskCategoryKey } from "@/features/optimize/constants";
import { markdownToHtml, markdownToText, slugify, escapeHtml } from "../markdown";
import { HttpError, UnsafeUrlError } from "../net";
import { toCsv } from "../csv";
import { addTaskActivity } from "../tasks/activity";
import { safeHttpUrl } from "@/features/optimize/shared/safe-url";
import {
  CMS_PROVIDERS,
  PM_PROVIDERS,
  createCmsClient,
  createPmClient,
  getProviderMeta,
  resolveProviderKey,
} from "./registry";
import {
  getIntegrationRow,
  listIntegrationRows,
  readConfig,
  readCreds,
  readSecrets,
  readTarget,
  toConnected,
  type IntegrationRow,
  type OptimizeIntegrationConfig,
} from "./store";
import { deliverWebhook, type WebhookEvent } from "./providers/webhook";
import { generateSigningSecret } from "./signature";
import { destinationChanged as hasDestinationChanged, isDestinationField } from "./destination";
import type { CmsDocument, ConnectedIntegration, ExternalStatus, PmTaskPayload, ProviderMeta } from "./types";

export { PM_PROVIDERS, CMS_PROVIDERS, getProviderMeta, resolveProviderKey };
export type { ConnectedIntegration, ProviderMeta };

type TaskRow = typeof optimizeTasks.$inferSelect;
type ContentRow = typeof contentPieces.$inferSelect;

function errMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 500);
}

/** Maps raw provider errors to actionable messages for the connect dialog. */
function friendlyError(meta: ProviderMeta, err: unknown): Error {
  if (err instanceof HttpError) {
    if (err.status === 401 || err.status === 403)
      return new Error(`${meta.name} rejected the credentials (HTTP ${err.status}). Check the token and its permissions.`);
    if (err.status === 404 && meta.fields.some((f) => /site|shop|url/i.test(f.key)))
      return new Error(`${meta.name} site not found (HTTP 404). Check the ${meta.fields.find((f) => /site|shop|url/i.test(f.key))?.label ?? "URL"}.`);
    if (err.status === 429) return new Error(`${meta.name} rate limit reached — try again in a minute.`);
  }
  if (err instanceof UnsafeUrlError) return new Error(`${err.message} Use the public address of your ${meta.name} site.`);
  return err instanceof Error ? err : new Error(String(err));
}

/* ─────────────────────────── Connections ─────────────────────────── */

export async function listConnectedIntegrations(projectId: string, kind?: "pm" | "cms"): Promise<ConnectedIntegration[]> {
  const rows = await listIntegrationRows(projectId, kind);
  const order = [...PM_PROVIDERS, ...CMS_PROVIDERS].map((p) => p.key);
  return rows
    .filter((r) => r.status !== "disconnected")
    .map(toConnected)
    .sort((a, b) => order.indexOf(a.provider) - order.indexOf(b.provider));
}

function requireMeta(provider: string, kind?: "pm" | "cms"): ProviderMeta {
  const meta = getProviderMeta(provider);
  if (!meta || (kind && meta.kind !== kind)) throw new Error(`Unknown integration "${provider}".`);
  return meta;
}

function clientFor(meta: ProviderMeta, creds: Record<string, string>, target: OptimizeIntegrationConfig["target"]) {
  return meta.kind === "pm" ? createPmClient(meta.key, creds, target) : createCmsClient(meta.key, creds, target);
}

export type ConnectResult = {
  integration: ConnectedIntegration;
  /** Targets to choose from (team / project / list / board / database / collection / blog) */
  targets: { id: string; name: string }[] | null;
  /** Webhook signing secret — returned once, right after connecting/rotating. */
  signingSecret?: string;
};

/**
 * Validates credentials against the provider (test call), stores them (secrets encrypted) and returns
 * the available targets. Secret fields left blank keep the stored value (credential updates).
 */
export async function connectIntegration(
  projectId: string,
  providerKey: string,
  values: Record<string, string>,
  userId: string | null,
): Promise<ConnectResult> {
  const meta = requireMeta(resolveProviderKey(providerKey));
  const existing = await getIntegrationRow(projectId, meta.key);
  const oldSecrets = existing ? readSecrets(existing) : {};
  const oldConfig = existing ? readConfig(existing) : null;

  // Stored secrets are only re-used while every destination-determining field (site URL, shop
  // domain, webhook URL, host/port) is unchanged — never send saved credentials to a new host.
  const oldValues: Record<string, string> = { ...(oldConfig?.fields ?? {}), ...oldSecrets };
  const destinationChanged = !!existing && hasDestinationChanged(meta.fields, values, oldValues);

  const fields: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  for (const f of meta.fields) {
    let v = (values[f.key] ?? "").trim();
    if (!v && f.secret && oldSecrets[f.key]) {
      if (destinationChanged && !isDestinationField(f))
        throw new Error(`Re-enter the ${f.label} — the destination changed, so stored credentials are not re-used.`);
      v = oldSecrets[f.key]!;
    }
    if (!v && f.required) throw new Error(`${f.label} is required.`);
    if (!v) continue;
    if (f.type === "url") {
      if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
      try {
        new URL(v);
      } catch {
        throw new Error(`${f.label} is not a valid URL.`);
      }
    }
    if (f.secret) secrets[f.key] = v;
    else fields[f.key] = v;
  }
  let signingSecret: string | undefined;
  if (meta.key === "webhook") {
    // A new destination always gets a fresh signing secret.
    if (oldSecrets.signingSecret && !destinationChanged) secrets.signingSecret = oldSecrets.signingSecret;
    else secrets.signingSecret = signingSecret = generateSigningSecret();
  }

  const credsChanged =
    !oldConfig ||
    JSON.stringify(oldConfig.fields) !== JSON.stringify(fields) ||
    Object.keys(secrets).some((k) => secrets[k] !== oldSecrets[k]);
  const keepTarget = !credsChanged ? (oldConfig?.target ?? null) : null;

  const client = clientFor(meta, { ...fields, ...secrets }, keepTarget);
  let account: string;
  let targets: { id: string; name: string }[] | null = null;
  try {
    ({ account } = await client.test());
    if (meta.targetLabel && client.listTargets) targets = await client.listTargets();
  } catch (err) {
    throw friendlyError(meta, err);
  }
  if (targets) {
    if (!targets.length)
      throw new Error(`Connected as ${account}, but no ${meta.targetLabel?.toLowerCase() ?? "target"} is accessible with these credentials.`);
  }
  const target = keepTarget ?? (targets?.length === 1 ? targets[0]! : null);
  const needsTarget = !!meta.targetLabel && !target;
  const config: OptimizeIntegrationConfig = { kind: meta.kind, account, target, fields };
  const row = await saveIntegration({
    projectId,
    provider: meta.key,
    status: needsTarget ? "pending" : "connected",
    config,
    secret: secrets,
    connectedBy: userId,
    lastError: null,
  });
  return { integration: toConnected(row), targets, signingSecret };
}

async function requireRow(projectId: string, provider: string, kind?: "pm" | "cms") {
  const meta = requireMeta(resolveProviderKey(provider), kind);
  const row = await getIntegrationRow(projectId, meta.key);
  if (!row || row.status === "disconnected") throw new Error(`${meta.name} is not connected for this project.`);
  return { meta, row };
}

export async function listIntegrationTargets(projectId: string, provider: string) {
  const { meta, row } = await requireRow(projectId, provider);
  const client = clientFor(meta, readCreds(row), readTarget(row));
  if (!meta.targetLabel || !client.listTargets) return { label: null, targets: [], current: null };
  return { label: meta.targetLabel, targets: await client.listTargets(), current: readTarget(row) };
}

export async function setIntegrationTarget(projectId: string, provider: string, targetId: string) {
  const { meta, row } = await requireRow(projectId, provider);
  const client = clientFor(meta, readCreds(row), null);
  if (!client.listTargets) throw new Error(`${meta.name} has no target to choose.`);
  const target = (await client.listTargets()).find((t) => t.id === targetId);
  if (!target) throw new Error(`That ${meta.targetLabel?.toLowerCase() ?? "target"} is not accessible anymore.`);
  const cfg = readConfig(row);
  const updated = await saveIntegration({
    projectId,
    provider: meta.key,
    status: "connected",
    config: { ...cfg, target },
    lastError: null,
  });
  return toConnected(updated);
}

export async function testIntegration(projectId: string, provider: string) {
  const { meta, row } = await requireRow(projectId, provider);
  const cfg = readConfig(row);
  try {
    const { account } = await clientFor(meta, readCreds(row), cfg.target).test();
    const updated = await saveIntegration({
      projectId,
      provider: meta.key,
      status: meta.targetLabel && !cfg.target ? "pending" : "connected",
      config: { ...cfg, account },
      lastError: null,
    });
    return { ok: true as const, integration: toConnected(updated) };
  } catch (err) {
    const message = errMessage(friendlyError(meta, err));
    const updated = await saveIntegration({ projectId, provider: meta.key, status: "error", lastError: message });
    return { ok: false as const, error: message, integration: toConnected(updated) };
  }
}

export async function disconnectIntegration(projectId: string, provider: string) {
  const meta = requireMeta(resolveProviderKey(provider));
  const row = await deleteIntegration(projectId, meta.key);
  return row ? toConnected(row) : null;
}

export async function rotateWebhookSecret(projectId: string): Promise<string> {
  const { row } = await requireRow(projectId, "webhook", "pm");
  const secret = generateSigningSecret();
  await saveIntegration({ projectId, provider: "webhook", secret: { ...readSecrets(row), signingSecret: secret } });
  return secret;
}

export async function sendWebhookTest(projectId: string) {
  const { row } = await requireRow(projectId, "webhook", "pm");
  const project = await projectInfo(projectId);
  await deliverWebhook(readCreds(row), "ping", { project, message: "Test event from AutoSEO" });
  await saveIntegration({ projectId, provider: "webhook", status: "connected", lastSyncAt: new Date(), lastError: null });
}

/* ─────────────────────────── Tasks → PM tools ─────────────────────────── */

async function projectInfo(projectId: string) {
  const [p] = await db
    .select({ id: projects.id, name: projects.name, domain: projects.domain })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return p ?? { id: projectId, name: "", domain: "" };
}

export function taskAppUrl(projectId: string, taskId: string) {
  return `${env.appUrl}/p/${projectId}/tasks/${taskId}`;
}

/** Markdown body sent to PM tools. */
export function buildTaskMarkdown(task: TaskRow): string {
  const out: string[] = [];
  const description = task.description?.trim() ?? "";
  if (task.summary && !description.startsWith(task.summary.trim())) out.push(task.summary.trim());
  if (description) out.push(description);
  if (task.steps.length) out.push("## Steps", ...task.steps.map((s, i) => `${i + 1}. ${s.text}${s.done ? " ✓ (done)" : ""}`));
  if (task.acceptanceCriteria.length) out.push("## Acceptance criteria", ...task.acceptanceCriteria.map((c) => `- [ ] ${c}`));
  if (task.contentPlan) {
    const p = task.contentPlan;
    const lines: string[] = [];
    if (p.workingTitle) lines.push(`- **Working title:** ${p.workingTitle}`);
    if (p.format) lines.push(`- **Format:** ${p.format}`);
    if (p.targetPrompt) lines.push(`- **Target prompt:** ${p.targetPrompt}`);
    if (p.targetKeyword) lines.push(`- **Target keyword:** ${p.targetKeyword}`);
    if (p.wordCount) lines.push(`- **Length:** ~${p.wordCount} words`);
    for (const h of p.outline ?? []) lines.push(`- Section: ${h}`);
    for (const q of p.questions ?? []) lines.push(`- Answer: ${q}`);
    if (lines.length) out.push("## Content plan", ...lines);
  }
  if (task.evidence.length) {
    const lines: string[] = [];
    for (const e of task.evidence.slice(0, 8)) {
      lines.push(`- **${e.label}**${e.value ? `: ${e.value}` : ""}${e.description ? ` — ${e.description}` : ""}`);
      for (const item of (e.items ?? []).slice(0, 6)) {
        const label = item.href ? `[${item.label}](${item.href})` : item.label;
        lines.push(`- ${e.label} › ${label}${item.value != null && item.value !== "" ? `: ${item.value}` : ""}${item.detail ? ` (${item.detail})` : ""}`);
      }
    }
    out.push("## Evidence", ...lines);
  }
  if (task.targetUrls.length) out.push("## Target URLs", ...task.targetUrls.map((u) => `- ${u}`));
  if (task.targetPrompts.length) out.push("## Target prompts", ...task.targetPrompts.map((p) => `- ${p}`));
  const category = TASK_CATEGORY_META[task.category as TaskCategoryKey]?.label ?? task.category;
  out.push(
    "---",
    `Impact ${task.impact}/10 · Effort ${task.effort}/10 · Priority ${Math.round(task.priority)} · ${category}`,
    `[Open in AutoSEO](${taskAppUrl(task.projectId, task.id)})`,
  );
  return out.join("\n\n").replace(/\n\n(?=- |\d+\. )/g, "\n");
}

export function buildTaskPayload(task: TaskRow): PmTaskPayload {
  const category = TASK_CATEGORY_META[task.category as TaskCategoryKey]?.label ?? task.category;
  return {
    taskId: task.id,
    title: task.title,
    markdown: buildTaskMarkdown(task),
    category,
    impact: task.impact,
    effort: task.effort,
    priority: Math.round(task.priority),
    status: task.status,
    dueDate: task.dueDate,
    labels: ["autoseo", category.toLowerCase()],
    appUrl: taskAppUrl(task.projectId, task.id),
  };
}

function publicTask(task: TaskRow) {
  return {
    id: task.id,
    title: task.title,
    summary: task.summary,
    category: task.category,
    status: task.status,
    resolution: task.resolution,
    impact: task.impact,
    effort: task.effort,
    priority: Math.round(task.priority),
    steps: task.steps.map((s) => ({ text: s.text, done: s.done })),
    acceptanceCriteria: task.acceptanceCriteria,
    targetUrls: task.targetUrls,
    targetPrompts: task.targetPrompts,
    assigneeId: task.assigneeId,
    dueDate: task.dueDate,
    external: task.external.map((e) => ({ provider: e.provider, url: e.url ?? null })),
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    resolvedAt: task.resolvedAt?.toISOString() ?? null,
    url: taskAppUrl(task.projectId, task.id),
  };
}

export type PushResult = { taskId: string; ok: boolean; url?: string | null; error?: string };

export async function pushTasksToPm(
  projectId: string,
  taskIds: string[],
  providerKey: string,
  userId: string | null,
): Promise<PushResult[]> {
  const { meta, row } = await requireRow(projectId, providerKey, "pm");
  if (row.status === "pending") throw new Error(`Choose a ${meta.targetLabel?.toLowerCase() ?? "target"} for ${meta.name} first.`);
  const ids = [...new Set(taskIds)].slice(0, 500);
  if (!ids.length) return [];
  const tasks = await db
    .select()
    .from(optimizeTasks)
    .where(and(eq(optimizeTasks.projectId, projectId), inArray(optimizeTasks.id, ids)));
  const client = createPmClient(meta.key, readCreds(row), readTarget(row));
  const results: PushResult[] = [];
  let failures = 0;
  for (const id of ids) {
    const task = tasks.find((t) => t.id === id);
    if (!task) {
      results.push({ taskId: id, ok: false, error: "Task not found" });
      continue;
    }
    const existing = task.external.find((e) => e.provider === meta.key);
    if (existing && meta.key !== "webhook") {
      results.push({ taskId: id, ok: true, url: existing.url ?? null });
      continue;
    }
    try {
      const raw = await client.createIssue(buildTaskPayload(task));
      // Provider-returned links are rendered/opened in the UI: keep only absolute http(s) URLs.
      const created = { ...raw, url: safeHttpUrl(raw.url) };
      if (meta.key !== "webhook") {
        const link: TaskExternalLink = {
          provider: meta.key,
          externalId: created.externalId,
          url: created.url,
          status: created.status ?? null,
          pushedAt: new Date().toISOString(),
          syncedAt: null,
        };
        await db
          .update(optimizeTasks)
          .set({ external: sql`${optimizeTasks.external} || ${JSON.stringify([link])}::jsonb` })
          .where(eq(optimizeTasks.id, task.id));
      }
      await addTaskActivity({
        taskId: task.id,
        projectId,
        kind: "pushed",
        body: meta.key === "webhook" ? "Sent to webhook" : `Pushed to ${meta.name}`,
        meta: { provider: meta.key, url: created.url, externalId: created.externalId || null },
        userId,
      });
      results.push({ taskId: id, ok: true, url: created.url });
    } catch (err) {
      failures++;
      results.push({ taskId: id, ok: false, error: errMessage(err) });
    }
  }
  await saveIntegration({
    projectId,
    provider: meta.key,
    ...(failures && failures === results.length
      ? { status: "error" as const, lastError: results.find((r) => r.error)?.error ?? "Push failed" }
      : { lastError: null, status: "connected" as const, lastSyncAt: new Date() }),
  });
  return results;
}

export async function enqueueTaskPush(projectId: string, taskIds: string[], provider: string, userId: string | null) {
  const meta = requireMeta(resolveProviderKey(provider), "pm");
  return enqueueJob(
    "optimize.pm.push",
    { projectId, taskIds: [...new Set(taskIds)], provider: meta.key, userId },
    { projectId, createdBy: userId, maxAttempts: 2 },
  );
}

/* ─────────────────────────── Webhook events ─────────────────────────── */

export type TaskEventName = "task.created" | "task.updated" | "task.resolved";

export async function emitTaskEvents(projectId: string, event: TaskEventName, taskIds: string[]) {
  if (!taskIds.length) return null;
  try {
    const row = await getIntegrationRow(projectId, "webhook");
    if (!row || row.status === "disconnected" || row.status === "pending") return null;
    const [settings] = await db
      .select({ webhookEvents: optimizeSettings.webhookEvents })
      .from(optimizeSettings)
      .where(eq(optimizeSettings.projectId, projectId))
      .limit(1);
    if (settings && settings.webhookEvents === false) return null;
    return await enqueueJob(
      "optimize.webhook.deliver",
      { projectId, event, taskIds: [...new Set(taskIds)].slice(0, 200) },
      { projectId, maxAttempts: 5 },
    );
  } catch (err) {
    console.error("[optimize] failed to enqueue webhook event", err);
    return null;
  }
}

/** Job body: loads tasks and delivers one signed event (throws so the job retries). */
export async function deliverTaskEvent(projectId: string, event: WebhookEvent, taskIds: string[]) {
  const row = await getIntegrationRow(projectId, "webhook");
  if (!row || row.status === "disconnected") return { skipped: true };
  const tasks = taskIds.length
    ? await db
        .select()
        .from(optimizeTasks)
        .where(and(eq(optimizeTasks.projectId, projectId), inArray(optimizeTasks.id, taskIds)))
    : [];
  if (!tasks.length) return { skipped: true };
  try {
    const res = await deliverWebhook(readCreds(row), event, { project: await projectInfo(projectId), tasks: tasks.map(publicTask) });
    await saveIntegration({ projectId, provider: "webhook", lastSyncAt: new Date(), lastError: null, status: "connected" });
    return { delivered: tasks.length, status: res.status };
  } catch (err) {
    await saveIntegration({ projectId, provider: "webhook", lastError: errMessage(err) });
    throw err;
  }
}

/* ─────────────────────────── Status sync ─────────────────────────── */

export async function syncExternalStatuses(projectId: string): Promise<{ checked: number; updated: number }> {
  const rows = (await listIntegrationRows(projectId, "pm")).filter((r) => r.status === "connected" || r.status === "error");
  const clients = new Map<string, ReturnType<typeof createPmClient>>();
  const rowByProvider = new Map<string, IntegrationRow>();
  for (const r of rows) {
    const meta = getProviderMeta(r.provider);
    if (!meta?.supportsStatusSync) continue;
    try {
      clients.set(r.provider, createPmClient(r.provider, readCreds(r), readTarget(r)));
      rowByProvider.set(r.provider, r);
    } catch {
      // misconfigured integration — skipped (surfaced via Test in the UI)
    }
  }
  if (!clients.size) return { checked: 0, updated: 0 };
  const tasks = await db
    .select()
    .from(optimizeTasks)
    .where(and(eq(optimizeTasks.projectId, projectId), sql`jsonb_array_length(${optimizeTasks.external}) > 0`, sql`${optimizeTasks.status} <> 'dismissed'`));
  let checked = 0;
  let updated = 0;
  const errors = new Map<string, string>();
  const resolvedIds: string[] = [];
  const progressedIds: string[] = [];
  for (const task of tasks) {
    let nextStatus: TaskRow["status"] = task.status;
    let changed = false;
    const links: TaskExternalLink[] = [];
    for (const link of task.external) {
      const client = clients.get(link.provider);
      if (!client?.getStatus || !link.externalId) {
        links.push(link);
        continue;
      }
      checked++;
      let status: ExternalStatus | null = null;
      try {
        status = await client.getStatus(link.externalId);
      } catch (err) {
        errors.set(link.provider, errMessage(err));
        links.push(link);
        continue;
      }
      links.push({ ...link, status: status ?? link.status ?? null, syncedAt: new Date().toISOString() });
      if (status === "done" && task.status !== "done") nextStatus = "done";
      else if (status === "in_progress" && task.status === "open" && nextStatus === "open") nextStatus = "in_progress";
      if (status && status !== link.status) changed = true;
    }
    const statusChanged = nextStatus !== task.status;
    if (!statusChanged && !changed && links.every((l, i) => l.syncedAt === task.external[i]?.syncedAt)) continue;
    await db
      .update(optimizeTasks)
      .set({
        external: links,
        ...(statusChanged
          ? {
              status: nextStatus,
              ...(nextStatus === "done" ? { resolution: "manual" as const, resolvedAt: new Date() } : {}),
            }
          : {}),
      })
      .where(eq(optimizeTasks.id, task.id));
    if (statusChanged) {
      updated++;
      (nextStatus === "done" ? resolvedIds : progressedIds).push(task.id);
      const source = links.find((l) => l.status === nextStatus || (nextStatus === "done" && l.status === "done"));
      const providerName = getProviderMeta(source?.provider ?? "")?.name ?? "the PM tool";
      await addTaskActivity({
        taskId: task.id,
        projectId,
        kind: "synced",
        body: nextStatus === "done" ? `Marked done — completed in ${providerName}` : `Moved to In Progress — started in ${providerName}`,
        meta: { from: task.status, to: nextStatus, provider: source?.provider ?? null },
      });
    }
  }
  for (const [provider] of rowByProvider) {
    const error = errors.get(provider);
    await saveIntegration({
      projectId,
      provider,
      ...(error ? { lastError: error } : { lastError: null, lastSyncAt: new Date() }),
    });
  }
  await emitTaskEvents(projectId, "task.resolved", resolvedIds);
  await emitTaskEvents(projectId, "task.updated", progressedIds);
  return { checked, updated };
}

/* ─────────────────────────── Content → CMS ─────────────────────────── */

function hasFaqSection(md: string) {
  return /^#{1,3}\s*(faq|frequently asked|häufige fragen|fragen und antworten)/im.test(md);
}

export function buildCmsDocument(row: ContentRow): CmsDocument {
  const title = row.title.trim() || "Untitled";
  const faqs = (row.faqs ?? []).filter((f) => f.question?.trim() && f.answer?.trim());
  let markdown = row.body ?? "";
  if (faqs.length && !hasFaqSection(markdown)) {
    markdown += `\n\n## Frequently asked questions\n\n${faqs.map((f) => `### ${f.question.trim()}\n\n${f.answer.trim()}`).join("\n\n")}`;
  }
  const text = markdownToText(row.body ?? "");
  const excerpt = (row.metaDescription?.trim() || text.slice(0, 300)).replace(/\s+/g, " ").slice(0, 300);
  return {
    contentId: row.id,
    title,
    slug: row.slug?.trim() || slugify(title) || row.id,
    markdown,
    html: markdownToHtml(markdown),
    metaTitle: row.metaTitle?.trim() || null,
    metaDescription: row.metaDescription?.trim() || null,
    excerpt,
    jsonLd: row.schemaJsonLd?.trim() || null,
    faqs,
  };
}

async function loadContent(projectId: string, contentId: string) {
  const [row] = await db
    .select()
    .from(contentPieces)
    .where(and(eq(contentPieces.projectId, projectId), eq(contentPieces.id, contentId)))
    .limit(1);
  if (!row) throw new Error("Content not found.");
  return row;
}

export async function publishContentToCms(
  projectId: string,
  contentId: string,
  providerKey: string,
  opts: { draft: boolean },
  userId: string | null,
): Promise<{ url: string | null; externalId: string }> {
  const { meta, row } = await requireRow(projectId, providerKey, "cms");
  if (meta.exportOnly) throw new Error(`${meta.name} has no publishing API — use the export downloads instead.`);
  if (row.status === "pending") throw new Error(`Choose a ${meta.targetLabel?.toLowerCase() ?? "target"} for ${meta.name} first.`);
  const content = await loadContent(projectId, contentId);
  if (content.status === "generating") throw new Error("Wait until generation has finished.");
  if (!content.body.trim()) throw new Error("The content is empty.");
  const doc = buildCmsDocument(content);
  const client = createCmsClient(meta.key, readCreds(row), readTarget(row));
  const existingId = content.publishProvider === meta.key && content.externalId ? content.externalId : null;
  let result: { externalId: string; url: string | null };
  try {
    const raw = await client.publish(doc, { existingId, draft: opts.draft });
    result = { ...raw, url: safeHttpUrl(raw.url) };
  } catch (err) {
    await saveIntegration({ projectId, provider: meta.key, lastError: errMessage(err) });
    throw err;
  }
  await db
    .update(contentPieces)
    .set({
      publishProvider: meta.key,
      externalId: result.externalId,
      slug: content.slug || doc.slug,
      updatedBy: userId,
      ...(opts.draft
        ? { status: content.status === "published" ? "published" : "in_review" }
        : { status: "published", publishedUrl: result.url ?? content.publishedUrl, publishedAt: new Date() }),
    })
    .where(eq(contentPieces.id, content.id));
  await saveIntegration({ projectId, provider: meta.key, lastSyncAt: new Date(), lastError: null, status: "connected" });
  return result;
}

export async function enqueueContentPublish(projectId: string, contentId: string, provider: string, draft: boolean, userId: string | null) {
  const meta = requireMeta(resolveProviderKey(provider), "cms");
  return enqueueJob(
    "optimize.cms.publish",
    { projectId, contentId, provider: meta.key, draft, userId },
    { projectId, createdBy: userId, maxAttempts: 2, dedupeKey: `optimize.cms.publish:${contentId}` },
  );
}

/** Framer: no write API → Markdown, standalone HTML and a Framer-CMS-importable CSV. */
export async function buildFramerExport(projectId: string, contentId: string) {
  const content = await loadContent(projectId, contentId);
  const doc = buildCmsDocument(content);
  const yaml = (v: string) => JSON.stringify(v);
  const markdown = [
    "---",
    `title: ${yaml(doc.title)}`,
    `slug: ${yaml(doc.slug)}`,
    ...(doc.metaTitle ? [`metaTitle: ${yaml(doc.metaTitle)}`] : []),
    ...(doc.metaDescription ? [`description: ${yaml(doc.metaDescription)}`] : []),
    "---",
    "",
    doc.markdown.trim(),
    "",
  ].join("\n");
  const jsonLd = doc.jsonLd ? `\n    <script type="application/ld+json">${doc.jsonLd.replace(/<\//g, "<\\/")}</script>` : "";
  const html = `<!doctype html>
<html lang="${escapeHtml(content.language || "en")}">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(doc.metaTitle ?? doc.title)}</title>
    ${doc.metaDescription ? `<meta name="description" content="${escapeHtml(doc.metaDescription)}" />` : ""}${jsonLd}
  </head>
  <body>
    <article>
      <h1>${escapeHtml(doc.title)}</h1>
${doc.html}
    </article>
  </body>
</html>
`;
  const faqHtml = doc.faqs.length
    ? doc.faqs.map((f) => `<h3>${escapeHtml(f.question)}</h3>${markdownToHtml(f.answer)}`).join("")
    : "";
  const bodyHtml = markdownToHtml(content.body ?? "");
  const csv = toCsv(
    ["Title", "Slug", "Content", "Meta Title", "Meta Description", "FAQ"],
    [[doc.title, doc.slug, bodyHtml, doc.metaTitle ?? doc.title, doc.metaDescription ?? doc.excerpt, faqHtml]],
  );
  return { markdown, html, csv, filename: doc.slug };
}
