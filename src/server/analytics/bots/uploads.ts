import "server-only";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import zlib from "node:zlib";
import { Transform, type Readable } from "node:stream";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { logUploads } from "@/server/db/schema";
import { enqueueJob } from "@/server/jobs/queue";
import { uploadsDir } from "@/server/analytics/scheduling";
import {
  createLineParser,
  detectLogFormat,
  MAX_LINE_LENGTH,
  normalizeFormatOption,
  type LogFormat,
  type ParsedHit,
} from "./log-parser";
import { ingestHits } from "./ingest";

export const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024; // 1 GB
export const CHUNK_BYTES = 8 * 1024 * 1024; // 8 MB (below the proxy's 10 MB body buffer)
export const INLINE_LIMIT_BYTES = 50 * 1024 * 1024; // > 50 MB → background job
/** gzip files expand ~10–20×: compressed uploads above this size are processed in the background too. */
export const INLINE_GZIP_LIMIT_BYTES = 5 * 1024 * 1024;
/** Hard cap on decompressed bytes (and on the expansion ratio) to defuse gzip bombs. */
const MAX_DECOMPRESSED_BYTES = 10 * 1024 * 1024 * 1024;
const MAX_GZIP_RATIO = 200;

/** Splits a byte stream into lines; lines longer than `maxLen` are replaced by a short marker. */
async function* readLines(stream: Readable, maxLen: number): AsyncGenerator<string> {
  const decoder = new StringDecoder("utf8");
  let buf = "";
  let overlong = false;
  for await (const chunk of stream) {
    buf += decoder.write(chunk as Buffer);
    let idx: number;
    while ((idx = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (overlong) {
        overlong = false;
        yield "\u0000overlong-line";
      } else yield line.length > maxLen ? "\u0000overlong-line" : line;
    }
    if (buf.length > maxLen) {
      // No newline within the limit: drop the rest of this line.
      overlong = true;
      buf = "";
    }
  }
  buf += decoder.end();
  if (overlong) yield "\u0000overlong-line";
  else if (buf) yield buf.length > maxLen ? "\u0000overlong-line" : buf;
}

/** Aborts the stream when more than `limit` bytes pass through. */
function byteLimit(limit: number, onExceeded: () => Error) {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      seen += chunk.length;
      if (seen > limit) cb(onExceeded());
      else cb(null, chunk);
    },
  });
}

const chunkLocks = new Map<string, Promise<unknown>>();
/** Serializes chunk writes per upload (single instance deployment). */
async function withUploadLock<T>(uploadId: string, fn: () => Promise<T>): Promise<T> {
  const prev = chunkLocks.get(uploadId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  chunkLocks.set(uploadId, next);
  try {
    return await next;
  } finally {
    if (chunkLocks.get(uploadId) === next) chunkLocks.delete(uploadId);
  }
}

export type LogUpload = typeof logUploads.$inferSelect;

export class UploadError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

function filePath(uploadId: string) {
  if (!/^lup_[a-z0-9]{16}$/.test(uploadId)) throw new UploadError("Invalid upload id", 400);
  return path.join(uploadsDir(), `${uploadId}.log`);
}

export async function getUpload(uploadId: string): Promise<LogUpload | null> {
  const [row] = await db.select().from(logUploads).where(eq(logUploads.id, uploadId)).limit(1);
  return row ?? null;
}

export async function listUploads(projectId: string, limit = 10): Promise<LogUpload[]> {
  return db.select().from(logUploads).where(eq(logUploads.projectId, projectId)).orderBy(desc(logUploads.createdAt)).limit(limit);
}

export async function initUpload(input: { projectId: string; filename: string; size: number; format: string; userId: string }) {
  if (!Number.isFinite(input.size) || input.size <= 0) throw new UploadError("The file is empty.");
  if (input.size > MAX_UPLOAD_BYTES)
    throw new UploadError("Files up to 1 GB are supported. Split larger logs or use the ingest API.", 413);
  const filename = input.filename.replace(/[^\w.\- ()[\]]+/g, "_").slice(0, 200) || "access.log";
  const format = normalizeFormatOption(input.format);
  const [row] = await db
    .insert(logUploads)
    .values({
      projectId: input.projectId,
      filename,
      sizeBytes: input.size,
      format,
      status: "uploading",
      createdBy: input.userId,
    })
    .returning();
  await fsp.mkdir(uploadsDir(), { recursive: true });
  await fsp.writeFile(filePath(row!.id), Buffer.alloc(0));
  return row!;
}

/** Appends a chunk at `offset` (must equal the bytes received so far — makes retries idempotent). */
export async function appendChunk(uploadRow: LogUpload, offset: number, chunk: Buffer) {
  return withUploadLock(uploadRow.id, async () => {
    const upload = (await getUpload(uploadRow.id)) ?? uploadRow;
    if (upload.status !== "uploading") throw new UploadError("This upload is no longer accepting data.", 409);
    if (chunk.length === 0) throw new UploadError("Empty chunk.");
    if (chunk.length > CHUNK_BYTES + 1024) throw new UploadError("Chunk too large (max 8 MB).", 413);
    const file = filePath(upload.id);
    const stat = await fsp.stat(file).catch(() => null);
    if (!stat) throw new UploadError("Upload expired — please start again.", 410);
    if (offset !== stat.size) {
      // A retried chunk that was already written: acknowledge without writing twice.
      if (offset + chunk.length === stat.size) return { receivedBytes: stat.size };
      throw new UploadError(`Unexpected offset ${offset} (expected ${stat.size}).`, 409);
    }
    if (stat.size + chunk.length > upload.sizeBytes) throw new UploadError("More data than announced.", 413);
    await fsp.appendFile(file, chunk);
    const receivedBytes = stat.size + chunk.length;
    await db.update(logUploads).set({ receivedBytes }).where(eq(logUploads.id, upload.id));
    return { receivedBytes };
  });
}

export type UploadOutcome =
  { status: "completed"; upload: LogUpload } | { status: "queued"; upload: LogUpload; jobId: string | null };

/** Finishes an upload: small files are parsed right away, large files in a background job. */
export async function completeUpload(upload: LogUpload): Promise<UploadOutcome> {
  if (upload.status !== "uploading") throw new UploadError("Upload already completed.", 409);
  const stat = await fsp.stat(filePath(upload.id)).catch(() => null);
  if (!stat) throw new UploadError("Upload expired — please start again.", 410);
  if (stat.size !== upload.sizeBytes)
    throw new UploadError(`Upload incomplete (${stat.size} of ${upload.sizeBytes} bytes).`, 409);
  // Claim the upload atomically so a double "complete" cannot process the file twice.
  const [claimed] = await db
    .update(logUploads)
    .set({ status: "queued", receivedBytes: stat.size })
    .where(and(eq(logUploads.id, upload.id), eq(logUploads.status, "uploading")))
    .returning({ id: logUploads.id });
  if (!claimed) throw new UploadError("Upload already completed.", 409);
  const head = await readHead(filePath(upload.id), 2);
  const gzip = head.length === 2 && head[0] === 0x1f && head[1] === 0x8b;
  if (stat.size > (gzip ? INLINE_GZIP_LIMIT_BYTES : INLINE_LIMIT_BYTES)) {
    const job = await enqueueJob(
      "analytics.logs.process",
      { uploadId: upload.id },
      {
        dedupeKey: `analytics.logs.process:${upload.id}`,
        projectId: upload.projectId,
        createdBy: upload.createdBy,
        priority: 30,
        maxAttempts: 1,
      },
    );
    const [row] = await db
      .update(logUploads)
      .set({
        status: "queued",
        receivedBytes: stat.size,
        jobId: job?.id ?? null,
      })
      .where(eq(logUploads.id, upload.id))
      .returning();
    return { status: "queued", upload: row!, jobId: job?.id ?? null };
  }
  await processUploadFile(upload.id);
  return { status: "completed", upload: (await getUpload(upload.id))! };
}

export async function cancelUpload(upload: LogUpload) {
  if (upload.status === "completed" || upload.status === "failed") return;
  await db
    .update(logUploads)
    .set({ status: "failed", error: "Cancelled.", finishedAt: new Date() })
    .where(and(eq(logUploads.id, upload.id), eq(logUploads.projectId, upload.projectId)));
  await fsp.rm(filePath(upload.id), { force: true });
}

async function readHead(file: string, bytes: number): Promise<Buffer> {
  const fh = await fsp.open(file, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/**
 * Streams the uploaded file through the parser (gzip auto-detected), ingesting bot hits in
 * batches and updating progress on the upload row.
 */
export async function processUploadFile(
  uploadId: string,
  hooks: {
    onProgress?: (p: { percent: number; lines: number }) => Promise<void> | void;
    isCancelled?: () => Promise<boolean>;
  } = {},
) {
  const upload = await getUpload(uploadId);
  if (!upload) throw new UploadError("Upload not found", 404);
  const file = filePath(uploadId);
  const stat = await fsp.stat(file).catch(() => null);
  if (!stat) {
    await db
      .update(logUploads)
      .set({
        status: "failed",
        error: "The uploaded file is no longer available.",
        finishedAt: new Date(),
      })
      .where(eq(logUploads.id, uploadId));
    throw new UploadError("Uploaded file missing", 410);
  }
  await db.update(logUploads).set({ status: "processing", error: null }).where(eq(logUploads.id, uploadId));

  let totalLines = 0;
  let parsedLines = 0;
  let invalidLines = 0;
  let botCount = 0;
  let saved = 0;
  let bytesRead = 0;
  try {
    const head = await readHead(file, 2);
    const gzip = head.length === 2 && head[0] === 0x1f && head[1] === 0x8b;
    const raw = fs.createReadStream(file, { highWaterMark: 1024 * 1024 });
    raw.on("data", (chunk) => (bytesRead += chunk.length));
    let stream: Readable = raw;
    if (gzip) {
      const limit = Math.min(MAX_DECOMPRESSED_BYTES, Math.max(64 * 1024 * 1024, stat.size * MAX_GZIP_RATIO));
      const gunzip = zlib.createGunzip();
      const guard = byteLimit(
        limit,
        () => new UploadError("The decompressed log is too large (possible gzip bomb). Upload it uncompressed or split it."),
      );
      raw.on("error", (e) => gunzip.destroy(e));
      gunzip.on("error", (e) => guard.destroy(e));
      stream = raw.pipe(gunzip).pipe(guard);
    }
    const rl = readLines(stream, MAX_LINE_LENGTH);

    const selected = normalizeFormatOption(upload.format);
    let parser: ReturnType<typeof createLineParser> | null = selected === "auto" ? null : createLineParser(selected);
    const sample: string[] = [];
    let batch: ParsedHit[] = [];
    let batchLines = 0;
    let lastProgress = Date.now();

    const flush = async () => {
      if (!batchLines) return;
      const res = await ingestHits(upload.projectId, "upload", batch, {
        uploadId,
        received: batchLines,
        countRequest: false,
      });
      botCount += res.botVisits;
      saved += res.saved;
      batch = [];
      batchLines = 0;
    };
    const handle = async (line: string) => {
      const res = parser!.parse(line);
      if (res === "skip") return;
      totalLines++;
      batchLines++;
      if (res) {
        parsedLines++;
        batch.push(res);
      } else invalidLines++;
      if (batch.length >= 2000 || batchLines >= 20_000) await flush();
    };

    for await (const line of rl) {
      if (!parser) {
        sample.push(line);
        if (sample.length < 50) continue;
        parser = createLineParser(detectLogFormat(sample));
        await db.update(logUploads).set({ detectedFormat: parser.format }).where(eq(logUploads.id, uploadId));
        for (const l of sample) await handle(l);
        continue;
      }
      await handle(line);
      if (Date.now() - lastProgress > 2000) {
        lastProgress = Date.now();
        const percent = Math.min(99, Math.round((bytesRead / Math.max(1, stat.size)) * 100));
        await db
          .update(logUploads)
          .set({
            totalLines,
            parsedLines,
            invalidLines,
            botVisits: botCount,
            saved,
            receivedBytes: stat.size,
          })
          .where(eq(logUploads.id, uploadId));
        await hooks.onProgress?.({ percent, lines: totalLines });
        if (hooks.isCancelled && (await hooks.isCancelled())) throw new UploadError("Cancelled.");
      }
    }
    if (!parser) {
      const format: LogFormat = detectLogFormat(sample);
      parser = createLineParser(format);
      await db.update(logUploads).set({ detectedFormat: format }).where(eq(logUploads.id, uploadId));
      for (const l of sample) await handle(l);
    }
    await flush();
    if (totalLines > 0 && parsedLines === 0) {
      throw new UploadError("No line could be parsed. Choose the log format manually or check that this is an access log.");
    }
    const [row] = await db
      .update(logUploads)
      .set({
        status: "completed",
        totalLines,
        parsedLines,
        invalidLines,
        botVisits: botCount,
        saved,
        finishedAt: new Date(),
        error: null,
      })
      .where(eq(logUploads.id, uploadId))
      .returning();
    await hooks.onProgress?.({ percent: 100, lines: totalLines });
    return row!;
  } catch (err) {
    const message =
      err instanceof UploadError
        ? err.message
        : (err as NodeJS.ErrnoException)?.code === "Z_DATA_ERROR"
          ? "The gzip file is corrupt."
          : err instanceof Error
            ? err.message
            : String(err);
    await db
      .update(logUploads)
      .set({
        status: "failed",
        error: message.slice(0, 500),
        totalLines,
        parsedLines,
        invalidLines,
        botVisits: botCount,
        saved,
        finishedAt: new Date(),
      })
      .where(eq(logUploads.id, uploadId));
    throw err;
  } finally {
    await fsp.rm(file, { force: true }).catch(() => {});
  }
}
