import { getProjectContext } from "@/server/auth/context";
import { rejectCrossSite } from "@/server/http/request";
import { appendChunk, cancelUpload, CHUNK_BYTES, completeUpload, getUpload, UploadError } from "@/server/analytics/bots/uploads";
import { serializeUpload } from "@/server/analytics/bots/queries";

export const dynamic = "force-dynamic";

async function load(uploadId: string, manage: boolean) {
  if (!/^lup_[a-z0-9]{16}$/.test(uploadId)) return { error: Response.json({ error: "Not found" }, { status: 404 }) } as const;
  const upload = await getUpload(uploadId);
  if (!upload) return { error: Response.json({ error: "Not found" }, { status: 404 }) } as const;
  const ctx = await getProjectContext(upload.projectId);
  if (!ctx) return { error: Response.json({ error: "Not found" }, { status: 404 }) } as const;
  if (manage && !ctx.permissions.has("settings.manage")) return { error: Response.json({ error: "Forbidden" }, { status: 403 }) } as const;
  return { upload, ctx } as const;
}

function fail(err: unknown) {
  if (err instanceof UploadError) return Response.json({ error: err.message }, { status: err.status });
  console.error("[bot-logs] upload error", err);
  return Response.json({ error: err instanceof Error ? err.message : "Upload failed" }, { status: 500 });
}

/** Upload status (polled by the UI while a large file is processed in the background). */
export async function GET(_req: Request, ctx: RouteContext<"/api/integrations/bot-logs/[uploadId]">) {
  const { uploadId } = await ctx.params;
  const res = await load(uploadId, false);
  if ("error" in res) return res.error;
  return Response.json({ upload: serializeUpload(res.upload) });
}

/** Appends a raw chunk: `PUT ?offset=<bytes already sent>` with the bytes as body (≤ 8 MB). */
export async function PUT(req: Request, ctx: RouteContext<"/api/integrations/bot-logs/[uploadId]">) {
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;
  const { uploadId } = await ctx.params;
  const res = await load(uploadId, true);
  if ("error" in res) return res.error;
  const offset = Number(new URL(req.url).searchParams.get("offset"));
  if (!Number.isInteger(offset) || offset < 0) return Response.json({ error: "Invalid offset" }, { status: 400 });
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > CHUNK_BYTES + 1024) return Response.json({ error: "Chunk too large (max 8 MB)." }, { status: 413 });
  try {
    const buf = Buffer.from(await req.arrayBuffer());
    return Response.json(await appendChunk(res.upload, offset, buf));
  } catch (err) {
    return fail(err);
  }
}

/** Completes the upload: parse now (≤ 50 MB) or queue a background job. */
export async function POST(req: Request, ctx: RouteContext<"/api/integrations/bot-logs/[uploadId]">) {
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;
  const { uploadId } = await ctx.params;
  const res = await load(uploadId, true);
  if ("error" in res) return res.error;
  try {
    const outcome = await completeUpload(res.upload);
    return Response.json({ status: outcome.status, upload: serializeUpload(outcome.upload) });
  } catch (err) {
    const latest = await getUpload(uploadId);
    if (err instanceof UploadError) return Response.json({ error: err.message, upload: latest ? serializeUpload(latest) : null }, { status: err.status });
    return Response.json({ error: latest?.error ?? "Processing failed", upload: latest ? serializeUpload(latest) : null }, { status: 422 });
  }
}

/** Cancels an unfinished upload. */
export async function DELETE(req: Request, ctx: RouteContext<"/api/integrations/bot-logs/[uploadId]">) {
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;
  const { uploadId } = await ctx.params;
  const res = await load(uploadId, true);
  if ("error" in res) return res.error;
  await cancelUpload(res.upload);
  return Response.json({ ok: true });
}
