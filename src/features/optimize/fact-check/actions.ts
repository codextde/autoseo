"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { fcAssets, fcDocuments, fcStatements, jobs } from "@/server/db/schema";
import { ActionError, actionProject, runAction } from "@/server/auth/guards";
import { logAudit } from "@/server/audit";
import { enqueueJob } from "@/server/jobs/queue";
import { parsePublicUrl, UnsafeUrlError } from "@/server/optimize/net";
import { MAX_PDF_BYTES, removeStoredFile, saveDocumentText, storePdf } from "@/server/optimize/fact-check/documents";
import { enqueueDocumentProcessing, enqueueFactCheck, FC_JOBS } from "@/server/optimize/fact-check/enqueue";
import { resetAssetVerdicts } from "@/server/optimize/fact-check/run";
import { defaultRegulator } from "@/features/optimize/constants";
import { getRunState } from "./queries";
import type { DiscoverResult } from "./types";

const PERM = "prompts.manage" as const;

const marketSchema = z.object({
  country: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/)
    .transform((c) => (c.toUpperCase() === "GB" ? "UK" : c.toUpperCase())),
  regulator: z.string().trim().max(40).optional().default(""),
});

const marketsSchema = z
  .array(marketSchema)
  .max(60)
  .transform((list) => {
    const seen = new Map<string, { country: string; regulator: string }>();
    for (const m of list) seen.set(m.country, { country: m.country, regulator: m.regulator || defaultRegulator(m.country) });
    return [...seen.values()];
  });

const aliasesSchema = z
  .array(z.string().trim().max(120))
  .max(50)
  .transform((a) => [...new Set(a.filter((x) => x.length >= 2))]);

const assetInput = z.object({
  name: z.string().trim().min(2).max(120),
  aliases: aliasesSchema.default([]),
  activeIngredient: z.string().trim().max(200).optional().nullable(),
});

/* ───────────────────────────── Assets ───────────────────────────── */

const createAssetsInput = z.object({
  assets: z.array(assetInput).min(1).max(200),
  markets: marketsSchema.refine((m) => m.length > 0, "Select at least one market"),
  sourceUrl: z.string().trim().max(2000).optional().nullable(),
  attachUrlAsDocument: z.boolean().optional().default(false),
});

export async function createAssetsAction(projectId: string, input: z.input<typeof createAssetsInput>) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, PERM);
    const data = createAssetsInput.parse(input);
    let sourceUrl: string | null = null;
    if (data.sourceUrl) {
      try {
        sourceUrl = parsePublicUrl(data.sourceUrl).toString();
      } catch (err) {
        throw new ActionError(err instanceof UnsafeUrlError ? err.message : "Invalid URL.", "invalid");
      }
    }
    const created: string[] = [];
    const skipped: string[] = [];
    for (const a of data.assets) {
      const [row] = await db
        .insert(fcAssets)
        .values({
          projectId,
          name: a.name,
          aliases: a.aliases.filter((x) => x.toLowerCase() !== a.name.toLowerCase()),
          activeIngredient: a.activeIngredient || null,
          markets: data.markets,
          sourceUrl,
          createdBy: ctx.user.id,
        })
        .onConflictDoNothing()
        .returning({ id: fcAssets.id });
      if (!row) {
        skipped.push(a.name);
        continue;
      }
      created.push(row.id);
      if (sourceUrl && data.attachUrlAsDocument) {
        const [doc] = await db
          .insert(fcDocuments)
          .values({
            projectId,
            assetId: row.id,
            title: new URL(sourceUrl).hostname + new URL(sourceUrl).pathname.replace(/\/$/, ""),
            kind: "url",
            sourceUrl,
            status: "processing",
            createdBy: ctx.user.id,
          })
          .returning();
        if (doc) await enqueueDocumentProcessing(doc, ctx.user.id);
      }
    }
    await logAudit("factcheck.assets.create", {
      actor: ctx.user,
      projectId,
      workspaceId: ctx.project.workspaceId,
      meta: { created: created.length, skipped },
    });
    return { created: created.length, ids: created, skipped };
  });
}

const updateAssetInput = z.object({
  name: z.string().trim().min(2).max(120),
  aliases: aliasesSchema,
  activeIngredient: z.string().trim().max(200).nullable().optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  markets: marketsSchema,
  status: z.enum(["active", "paused"]),
});

export async function updateAssetAction(projectId: string, assetId: string, input: z.input<typeof updateAssetInput>) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, PERM);
    const data = updateAssetInput.parse(input);
    const [before] = await db
      .select()
      .from(fcAssets)
      .where(and(eq(fcAssets.projectId, projectId), eq(fcAssets.id, assetId)))
      .limit(1);
    if (!before) throw new ActionError("Asset not found.", "not_found");
    const clash = await db
      .select({ id: fcAssets.id })
      .from(fcAssets)
      .where(and(eq(fcAssets.projectId, projectId), eq(fcAssets.name, data.name), sql`${fcAssets.id} <> ${assetId}`))
      .limit(1);
    if (clash.length) throw new ActionError("Another asset already uses this name.", "conflict");
    await db
      .update(fcAssets)
      .set({
        name: data.name,
        aliases: data.aliases.filter((x) => x.toLowerCase() !== data.name.toLowerCase()),
        activeIngredient: data.activeIngredient || null,
        description: data.description || null,
        markets: data.markets,
        status: data.status,
      })
      .where(eq(fcAssets.id, assetId));
    const namesChanged =
      before.name !== data.name || JSON.stringify([...before.aliases].sort()) !== JSON.stringify([...data.aliases].sort());
    const marketsChanged = JSON.stringify(before.markets.map((m) => m.country).sort()) !== JSON.stringify(data.markets.map((m) => m.country).sort());
    if (data.status === "active" && (namesChanged || marketsChanged)) {
      // New spellings / markets: rescan all answers for this asset.
      await db.execute(sql`DELETE FROM fc_answer_checks WHERE asset_id = ${assetId}`);
      await enqueueFactCheck({ projectId, assetId, trigger: "manual" }, { createdBy: ctx.user.id });
    }
    return { ok: true };
  });
}

export async function deleteAssetAction(projectId: string, assetId: string) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, PERM);
    const docs = await db
      .select({ filePath: fcDocuments.filePath })
      .from(fcDocuments)
      .where(and(eq(fcDocuments.projectId, projectId), eq(fcDocuments.assetId, assetId)));
    const [row] = await db
      .delete(fcAssets)
      .where(and(eq(fcAssets.projectId, projectId), eq(fcAssets.id, assetId)))
      .returning({ name: fcAssets.name });
    if (!row) throw new ActionError("Asset not found.", "not_found");
    for (const d of docs) await removeStoredFile(d.filePath);
    await logAudit("factcheck.assets.delete", { actor: ctx.user, projectId, workspaceId: ctx.project.workspaceId, targetId: assetId, meta: { name: row.name } });
    return { ok: true };
  });
}

/* ───────────────────────────── Documents ───────────────────────────── */

async function loadAsset(projectId: string, assetId: string) {
  const [asset] = await db
    .select({ id: fcAssets.id })
    .from(fcAssets)
    .where(and(eq(fcAssets.projectId, projectId), eq(fcAssets.id, assetId)))
    .limit(1);
  if (!asset) throw new ActionError("Asset not found.", "not_found");
  return asset;
}

const docMeta = z.object({
  title: z.string().trim().max(200).optional().default(""),
  market: z
    .string()
    .trim()
    .max(2)
    .optional()
    .nullable()
    .transform((m) => (m ? (m.toUpperCase() === "GB" ? "UK" : m.toUpperCase()) : null)),
  version: z.string().trim().max(60).optional().nullable(),
  effectiveDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
});

const textDocInput = docMeta.extend({ text: z.string().min(20, "Paste at least a few sentences").max(600_000) });

export async function addTextDocumentAction(projectId: string, assetId: string, input: z.input<typeof textDocInput>) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, PERM);
    await loadAsset(projectId, assetId);
    const data = textDocInput.parse(input);
    const [doc] = await db
      .insert(fcDocuments)
      .values({
        projectId,
        assetId,
        title: data.title || "Pasted label text",
        kind: "text",
        market: data.market,
        version: data.version || null,
        effectiveDate: data.effectiveDate || null,
        status: "processing",
        createdBy: ctx.user.id,
      })
      .returning();
    await saveDocumentText(doc!.id, data.text);
    await resetAssetVerdicts(assetId);
    await enqueueFactCheck({ projectId, assetId, trigger: "manual" }, { createdBy: ctx.user.id });
    return { id: doc!.id };
  });
}

const urlDocInput = docMeta.extend({ url: z.string().trim().min(4).max(2000) });

export async function addUrlDocumentAction(projectId: string, assetId: string, input: z.input<typeof urlDocInput>) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, PERM);
    await loadAsset(projectId, assetId);
    const data = urlDocInput.parse(input);
    let url: URL;
    try {
      url = parsePublicUrl(/^https?:\/\//i.test(data.url) ? data.url : `https://${data.url}`);
    } catch (err) {
      throw new ActionError(err instanceof Error ? err.message : "Invalid URL.", "invalid");
    }
    const [doc] = await db
      .insert(fcDocuments)
      .values({
        projectId,
        assetId,
        title: data.title || url.hostname + url.pathname.replace(/\/$/, ""),
        kind: "url",
        sourceUrl: url.toString(),
        market: data.market,
        version: data.version || null,
        effectiveDate: data.effectiveDate || null,
        status: "processing",
        createdBy: ctx.user.id,
      })
      .returning();
    await resetAssetVerdicts(assetId);
    await enqueueDocumentProcessing(doc!, ctx.user.id);
    return { id: doc!.id };
  });
}

export async function uploadPdfDocumentAction(projectId: string, assetId: string, form: FormData) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, PERM);
    await loadAsset(projectId, assetId);
    const file = form.get("file");
    if (!(file instanceof File)) throw new ActionError("Choose a PDF file.", "invalid");
    if (file.size === 0) throw new ActionError("The file is empty.", "invalid");
    if (file.size > MAX_PDF_BYTES) throw new ActionError("PDFs up to 20 MB are supported.", "invalid");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (Buffer.from(bytes.subarray(0, 5)).toString("latin1") !== "%PDF-") throw new ActionError("This is not a PDF file.", "invalid");
    const meta = docMeta.parse({
      title: String(form.get("title") ?? ""),
      market: (form.get("market") as string) || null,
      version: (form.get("version") as string) || null,
      effectiveDate: (form.get("effectiveDate") as string) || null,
    });
    const fileName = file.name.replace(/[^\w.\- ()]/g, "_").slice(0, 200) || "label.pdf";
    const [doc] = await db
      .insert(fcDocuments)
      .values({
        projectId,
        assetId,
        title: meta.title || fileName.replace(/\.pdf$/i, ""),
        kind: "pdf",
        fileName,
        market: meta.market,
        version: meta.version || null,
        effectiveDate: meta.effectiveDate || null,
        status: "processing",
        createdBy: ctx.user.id,
      })
      .returning();
    const rel = await storePdf(projectId, doc!.id, bytes);
    await db.update(fcDocuments).set({ filePath: rel }).where(eq(fcDocuments.id, doc!.id));
    await resetAssetVerdicts(assetId);
    await enqueueDocumentProcessing(doc!, ctx.user.id);
    return { id: doc!.id };
  });
}

export async function deleteDocumentAction(projectId: string, documentId: string) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, PERM);
    const [doc] = await db
      .delete(fcDocuments)
      .where(and(eq(fcDocuments.projectId, projectId), eq(fcDocuments.id, documentId)))
      .returning();
    if (!doc) throw new ActionError("Document not found.", "not_found");
    await removeStoredFile(doc.filePath);
    await resetAssetVerdicts(doc.assetId);
    await enqueueFactCheck({ projectId, assetId: doc.assetId, trigger: "manual" }, { createdBy: ctx.user.id });
    return { ok: true };
  });
}

export async function setDocumentSupersededAction(projectId: string, documentId: string, superseded: boolean) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, PERM);
    const [doc] = await db
      .update(fcDocuments)
      .set({ superseded: z.boolean().parse(superseded) })
      .where(and(eq(fcDocuments.projectId, projectId), eq(fcDocuments.id, documentId)))
      .returning({ assetId: fcDocuments.assetId });
    if (!doc) throw new ActionError("Document not found.", "not_found");
    await resetAssetVerdicts(doc.assetId);
    await enqueueFactCheck({ projectId, assetId: doc.assetId, trigger: "manual" }, { createdBy: ctx.user.id });
    return { ok: true };
  });
}

export async function retryDocumentAction(projectId: string, documentId: string) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, PERM);
    const [doc] = await db
      .update(fcDocuments)
      .set({ status: "processing", error: null })
      .where(and(eq(fcDocuments.projectId, projectId), eq(fcDocuments.id, documentId), inArray(fcDocuments.kind, ["pdf", "url"])))
      .returning();
    if (!doc) throw new ActionError("Document not found.", "not_found");
    await enqueueDocumentProcessing(doc, ctx.user.id);
    return { ok: true };
  });
}

/* ───────────────────────────── Runs ───────────────────────────── */

export async function runCheckAction(projectId: string, assetId?: string | null) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, PERM);
    const id = assetId ? z.string().max(64).parse(assetId) : null;
    if (id) await loadAsset(projectId, id);
    const job = await enqueueFactCheck({ projectId, assetId: id, trigger: "manual" }, { createdBy: ctx.user.id });
    return { queued: !!job };
  });
}

export async function getRunStateAction(projectId: string) {
  return runAction(async () => {
    await actionProject(projectId);
    return getRunState(projectId);
  });
}

/* ───────────────────────────── Findings ───────────────────────────── */

const idsSchema = z.array(z.string().min(1).max(64)).min(1).max(1000);

export async function setFindingsStatusAction(projectId: string, ids: string[], status: "open" | "resolved" | "ignored") {
  return runAction(async () => {
    const ctx = await actionProject(projectId, PERM);
    const list = idsSchema.parse(ids);
    const next = z.enum(["open", "resolved", "ignored"]).parse(status);
    const rows = await db
      .update(fcStatements)
      .set(
        next === "open"
          ? { status: "open", resolvedAt: null, resolvedBy: null }
          : { status: next, resolvedAt: new Date(), resolvedBy: ctx.user.id },
      )
      .where(and(eq(fcStatements.projectId, projectId), inArray(fcStatements.id, list)))
      .returning({ id: fcStatements.id });
    return { updated: rows.length };
  });
}

/** Human override of a verdict (e.g. "this is actually on-label"). */
export async function setVerdictAction(
  projectId: string,
  id: string,
  verdict: "matched" | "contradicted" | "unsupported" | "outdated" | "off_label" | "needs_review",
  severity?: "critical" | "major" | "minor" | null,
) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, PERM);
    const v = z.enum(["matched", "contradicted", "unsupported", "outdated", "off_label", "needs_review"]).parse(verdict);
    const isDeviation = !["matched", "needs_review"].includes(v);
    const sev = isDeviation ? (z.enum(["critical", "major", "minor"]).nullable().optional().parse(severity) ?? "minor") : null;
    const [row] = await db
      .update(fcStatements)
      .set({
        verdict: v,
        severity: sev,
        judgedBy: "user",
        checkedAt: new Date(),
        ...(v === "matched" ? { status: "resolved" as const, resolvedAt: new Date(), resolvedBy: ctx.user.id } : {}),
      })
      .where(and(eq(fcStatements.projectId, projectId), eq(fcStatements.id, z.string().max(64).parse(id))))
      .returning({ id: fcStatements.id });
    if (!row) throw new ActionError("Statement not found.", "not_found");
    return { ok: true };
  });
}

/* ───────────────────────────── Discover from URL ───────────────────────────── */

export async function startDiscoverAction(projectId: string, rawUrl: string) {
  return runAction(async () => {
    const ctx = await actionProject(projectId, PERM);
    const input = z.string().trim().min(4).max(2000).parse(rawUrl);
    let url: URL;
    try {
      url = parsePublicUrl(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    } catch (err) {
      throw new ActionError(err instanceof Error ? err.message : "Invalid URL.", "invalid");
    }
    const job = await enqueueJob(
      FC_JOBS.discover,
      { projectId, url: url.toString(), userId: ctx.user.id, workspaceId: ctx.project.workspaceId },
      { projectId, priority: 20, maxAttempts: 1, createdBy: ctx.user.id },
    );
    if (!job) throw new ActionError("Discovery isn't available for this project (demo projects don't run background jobs).", "invalid");
    return { jobId: job.id, url: url.toString() };
  });
}

export async function getDiscoverResultAction(projectId: string, jobId: string) {
  return runAction(async () => {
    await actionProject(projectId, PERM);
    const [job] = await db
      .select({ status: jobs.status, result: jobs.result, lastError: jobs.lastError })
      .from(jobs)
      .where(and(eq(jobs.id, z.string().max(64).parse(jobId)), eq(jobs.projectId, projectId), eq(jobs.type, FC_JOBS.discover)))
      .limit(1);
    if (!job) throw new ActionError("Discovery not found.", "not_found");
    if (job.status === "failed" || job.status === "cancelled")
      return { status: "failed" as const, error: job.lastError ?? "Discovery failed.", result: null };
    if (job.status !== "succeeded") return { status: "running" as const, error: null, result: null };
    return { status: "done" as const, error: null, result: job.result as DiscoverResult };
  });
}
