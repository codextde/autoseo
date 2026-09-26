import { rateLimit } from "@/server/rate-limit";
import { hasContentType, rejectCrossSite } from "@/server/http/request";
import { AttachmentError, saveChatAttachment, toAttachmentRef } from "@/server/chat/attachments";
import { chatContext, jsonError } from "@/server/chat/http";

export const dynamic = "force-dynamic";

/** Uploads one chat attachment (multipart: projectId, file). Validated by content, max 20 MB. */
export async function POST(req: Request) {
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;
  if (!hasContentType(req, "multipart/form-data")) return jsonError(415, "Send the file as multipart/form-data.");
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 21 * 1024 * 1024) return jsonError(413, "The file is too large (max 20 MB).");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, "Send the file as multipart/form-data.");
  }
  const ctx = await chatContext(String(form.get("projectId") ?? ""));
  if (ctx instanceof Response) return ctx;
  if (!ctx.permissions.has("prompts.manage")) return jsonError(403, "You have read-only access to this project.");
  if (!rateLimit(`chat:upload:${ctx.user.id}`, 30, 60_000)) return jsonError(429, "Too many uploads. Wait a moment.");
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError(400, "No file received.");
  try {
    const row = await saveChatAttachment({ projectId: ctx.project.id, userId: ctx.user.id, file });
    return Response.json({ attachment: toAttachmentRef(row) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof AttachmentError) return jsonError(400, err.message);
    console.error("[chat] upload failed", err);
    return jsonError(500, "Upload failed.");
  }
}
