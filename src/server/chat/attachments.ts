import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import { db } from "@/server/db/client";
import { chatAttachments } from "@/server/db/schema";
import { randomToken } from "@/server/crypto";
import { env } from "@/server/env";
import type { ChatAttachmentKind, ChatAttachmentRef } from "@/features/chat/types";
import { ATTACHMENT_LIMITS, MAX_ATTACHMENTS_PER_MESSAGE } from "@/features/chat/lib/limits";

/**
 * Chat attachments: validated by content (magic bytes / strict UTF-8), stored under
 * `DATA_DIR/chat/<projectId>/<random>.<ext>` and served only to their uploader.
 */

export class AttachmentError extends Error {}

export type AttachmentRow = typeof chatAttachments.$inferSelect;

const STORAGE_NAME_RE = /^[A-Za-z0-9_-]{16,64}\.(png|jpg|gif|webp|pdf|csv|txt|md|json|tsv)$/;
const PROJECT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function projectDir(projectId: string) {
  if (!PROJECT_ID_RE.test(projectId)) throw new AttachmentError("Invalid project.");
  return path.join(env.dataDir, "chat", projectId);
}

type Sniffed = { kind: ChatAttachmentKind; mimeType: string; ext: string };

const IMAGE_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
const TEXT_EXT: Record<string, { kind: ChatAttachmentKind; mimeType: string }> = {
  csv: { kind: "csv", mimeType: "text/csv" },
  tsv: { kind: "csv", mimeType: "text/tab-separated-values" },
  txt: { kind: "text", mimeType: "text/plain" },
  md: { kind: "text", mimeType: "text/markdown" },
  markdown: { kind: "text", mimeType: "text/markdown" },
  json: { kind: "text", mimeType: "application/json" },
};

function sniffImage(buf: Buffer): string | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString("ascii"))) return "gif";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}

function isUtf8Text(buf: Buffer): boolean {
  if (buf.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

function sniff(buf: Buffer, fileName: string): Sniffed {
  const image = sniffImage(buf);
  if (image) return { kind: "image", mimeType: IMAGE_MIME[image]!, ext: image };
  if (buf.length >= 5 && buf.subarray(0, 5).toString("ascii") === "%PDF-") return { kind: "pdf", mimeType: "application/pdf", ext: "pdf" };
  const ext = (fileName.split(".").pop() ?? "").toLowerCase();
  const text = TEXT_EXT[ext] ?? null;
  if (isUtf8Text(buf)) {
    if (text) return { ...text, ext: ext === "markdown" ? "md" : ext };
    return { kind: "text", mimeType: "text/plain", ext: "txt" };
  }
  throw new AttachmentError("Unsupported file type. Attach images (PNG, JPG, GIF, WebP), PDFs, CSV or text files.");
}

function cleanName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_").trim();
  return (cleaned || "file").slice(0, 160);
}

export function toAttachmentRef(row: AttachmentRow): ChatAttachmentRef {
  return { id: row.id, name: row.name, mimeType: row.mimeType, size: row.size, kind: row.kind };
}

/** Validates and stores an uploaded file. */
export async function saveChatAttachment(input: { projectId: string; userId: string; file: File }): Promise<AttachmentRow> {
  const { file } = input;
  if (!file || typeof file.arrayBuffer !== "function") throw new AttachmentError("No file received.");
  if (file.size <= 0) throw new AttachmentError("The file is empty.");
  if (file.size > ATTACHMENT_LIMITS.maxBytes.pdf) throw new AttachmentError("The file is too large (max 20 MB).");
  const buf = Buffer.from(await file.arrayBuffer());
  const s = sniff(buf, file.name || "file");
  const max = ATTACHMENT_LIMITS.maxBytes[s.kind];
  if (buf.length > max) throw new AttachmentError(`${s.kind === "image" ? "Images" : s.kind === "pdf" ? "PDFs" : "Text files"} can be at most ${Math.round(max / 1024 / 1024)} MB.`);

  const dir = projectDir(input.projectId);
  await fs.mkdir(dir, { recursive: true });
  const storageName = `${randomToken(18)}.${s.ext}`;
  await fs.writeFile(path.join(dir, storageName), buf, { mode: 0o600 });
  const [row] = await db
    .insert(chatAttachments)
    .values({
      projectId: input.projectId,
      userId: input.userId,
      name: cleanName(file.name || `attachment.${s.ext}`),
      mimeType: s.mimeType,
      kind: s.kind,
      size: buf.length,
      storageName,
    })
    .returning();
  return row!;
}

export async function getOwnAttachment(projectId: string, userId: string, id: string): Promise<AttachmentRow | null> {
  const [row] = await db
    .select()
    .from(chatAttachments)
    .where(and(eq(chatAttachments.id, id), eq(chatAttachments.projectId, projectId), eq(chatAttachments.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** Attachments the user uploaded for this project that are not yet bound to another chat. */
export async function claimAttachments(projectId: string, userId: string, chatId: string, ids: string[]): Promise<AttachmentRow[]> {
  const unique = [...new Set(ids)].slice(0, MAX_ATTACHMENTS_PER_MESSAGE);
  if (!unique.length) return [];
  const rows = await db
    .select()
    .from(chatAttachments)
    .where(and(inArray(chatAttachments.id, unique), eq(chatAttachments.projectId, projectId), eq(chatAttachments.userId, userId)));
  const usable = rows.filter((r) => r.chatId === null || r.chatId === chatId);
  if (usable.length !== unique.length) throw new AttachmentError("One of the attachments is no longer available. Please attach it again.");
  await db.update(chatAttachments).set({ chatId }).where(inArray(chatAttachments.id, unique));
  return unique.map((id) => usable.find((r) => r.id === id)!);
}

export async function bindAttachmentsToMessage(ids: string[], messageId: string) {
  if (!ids.length) return;
  await db.update(chatAttachments).set({ messageId }).where(inArray(chatAttachments.id, ids));
}

export async function readAttachment(row: Pick<AttachmentRow, "projectId" | "storageName">): Promise<Buffer> {
  if (!STORAGE_NAME_RE.test(row.storageName)) throw new AttachmentError("Invalid attachment.");
  return fs.readFile(path.join(projectDir(row.projectId), row.storageName));
}

export async function deleteAttachmentFiles(rows: Pick<AttachmentRow, "projectId" | "storageName">[]) {
  for (const r of rows) {
    if (!STORAGE_NAME_RE.test(r.storageName)) continue;
    await fs.rm(path.join(projectDir(r.projectId), r.storageName), { force: true }).catch(() => {});
  }
}

/** Deletes an attachment that has not been sent yet. */
export async function deleteDraftAttachment(projectId: string, userId: string, id: string): Promise<boolean> {
  const row = await getOwnAttachment(projectId, userId, id);
  if (!row || row.messageId) return false;
  await db.delete(chatAttachments).where(eq(chatAttachments.id, row.id));
  await deleteAttachmentFiles([row]);
  return true;
}

/** Removes uploads that were never sent (older than `olderThanMs`). */
export async function cleanupOrphanAttachments(olderThanMs = 24 * 3600_000): Promise<number> {
  const rows = await db
    .select()
    .from(chatAttachments)
    .where(and(isNull(chatAttachments.messageId), lt(chatAttachments.createdAt, new Date(Date.now() - olderThanMs))))
    .limit(500);
  if (!rows.length) return 0;
  await db.delete(chatAttachments).where(inArray(chatAttachments.id, rows.map((r) => r.id)));
  await deleteAttachmentFiles(rows);
  return rows.length;
}

/** Loaded attachment content for model providers. */
export type LoadedAttachment = { ref: ChatAttachmentRef; data: Buffer; text: string | null };

const MAX_TEXT_CHARS = 150_000;

export async function loadAttachments(rows: AttachmentRow[]): Promise<LoadedAttachment[]> {
  const out: LoadedAttachment[] = [];
  for (const row of rows) {
    try {
      const data = await readAttachment(row);
      const text = row.kind === "csv" || row.kind === "text" ? data.toString("utf8").slice(0, MAX_TEXT_CHARS) : null;
      out.push({ ref: toAttachmentRef(row), data, text });
    } catch (err) {
      console.error("[chat] attachment missing", row.id, err);
    }
  }
  return out;
}
