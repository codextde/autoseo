import { z } from "zod";
import { rateLimit } from "@/server/rate-limit";
import { hasContentType, rejectCrossSite } from "@/server/http/request";
import { AttachmentError } from "@/server/chat/attachments";
import { chatContext, idSchema, jsonError } from "@/server/chat/http";
import { isValidSelection } from "@/server/chat/models";
import { ChatError, sendChatMessage } from "@/server/chat/orchestrator";
import { MAX_ATTACHMENTS_PER_MESSAGE, MAX_MESSAGE_CHARS } from "@/features/chat/lib/limits";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  projectId: z.string(),
  chatId: idSchema.nullish(),
  mode: z.enum(["send", "regenerate", "edit"]).default("send"),
  text: z.string().max(MAX_MESSAGE_CHARS, `Messages can be at most ${MAX_MESSAGE_CHARS} characters.`).default(""),
  attachmentIds: z.array(idSchema).max(MAX_ATTACHMENTS_PER_MESSAGE).default([]),
  model: z.string().max(40).default("auto"),
  targetMessageId: idSchema.nullish(),
});

/**
 * Sends a chat message (or regenerates / edits the last turn). Persists the user message and an
 * assistant placeholder, starts the answer in the background and returns their ids; the client
 * then streams the answer from `/api/chat/runs/<assistantMessageId>`.
 */
export async function POST(req: Request) {
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;
  if (!hasContentType(req, "application/json")) return jsonError(415, "Send JSON.");
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (err) {
    const msg = err instanceof z.ZodError ? (err.issues[0]?.message ?? "Invalid request.") : "Invalid request.";
    return jsonError(400, msg);
  }
  const ctx = await chatContext(body.projectId);
  if (ctx instanceof Response) return ctx;
  if (!ctx.permissions.has("prompts.manage")) return jsonError(403, "You have read-only access to this project.");
  if (!rateLimit(`chat:msg:${ctx.user.id}`, 20, 60_000) || !rateLimit(`chat:msg-day:${ctx.user.id}`, 600, 24 * 3600_000)) {
    return jsonError(429, "You are sending messages too quickly. Wait a moment and try again.");
  }
  const selection = isValidSelection(body.model) ? body.model : "auto";
  try {
    const result = await sendChatMessage({
      ctx,
      chatId: body.chatId ?? null,
      mode: body.mode,
      text: body.text,
      attachmentIds: body.attachmentIds,
      selection,
      targetMessageId: body.targetMessageId ?? null,
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof ChatError) return jsonError(err.status, err.message);
    if (err instanceof AttachmentError) return jsonError(400, err.message);
    console.error("[chat] send failed", err);
    return jsonError(500, "Could not send the message. Please try again.");
  }
}
