import { deleteDraftAttachment, getOwnAttachment, readAttachment } from "@/server/chat/attachments";
import { chatContext, idSchema, jsonError } from "@/server/chat/http";
import { rejectCrossSite } from "@/server/http/request";

export const dynamic = "force-dynamic";

function contentDisposition(kind: "inline" | "attachment", name: string) {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Serves an attachment to its uploader only. Images / PDFs inline (sandboxed), text as download. */
export async function GET(req: Request, ctx: RouteContext<"/api/chat/attachments/[attachmentId]">) {
  const { attachmentId } = await ctx.params;
  if (!idSchema.safeParse(attachmentId).success) return jsonError(400, "Invalid attachment id.");
  const url = new URL(req.url);
  const pctx = await chatContext(url.searchParams.get("projectId"));
  if (pctx instanceof Response) return pctx;
  const row = await getOwnAttachment(pctx.project.id, pctx.user.id, attachmentId);
  if (!row) return jsonError(404, "Not found.");
  try {
    const buf = await readAttachment(row);
    const inline = (row.kind === "image" || row.kind === "pdf") && url.searchParams.get("download") !== "1";
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": row.kind === "csv" || row.kind === "text" ? `${row.mimeType}; charset=utf-8` : row.mimeType,
        "Content-Length": String(buf.length),
        "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", row.name),
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch {
    return jsonError(404, "The file is no longer available.");
  }
}

/** Removes an attachment that has not been sent yet (composer "×"). */
export async function DELETE(req: Request, ctx: RouteContext<"/api/chat/attachments/[attachmentId]">) {
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;
  const { attachmentId } = await ctx.params;
  if (!idSchema.safeParse(attachmentId).success) return jsonError(400, "Invalid attachment id.");
  const pctx = await chatContext(new URL(req.url).searchParams.get("projectId"));
  if (pctx instanceof Response) return pctx;
  const deleted = await deleteDraftAttachment(pctx.project.id, pctx.user.id, attachmentId);
  return Response.json({ deleted }, { headers: { "Cache-Control": "no-store" } });
}
