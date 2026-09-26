import { chatContext, idSchema, jsonError } from "@/server/chat/http";
import { stopRun } from "@/server/chat/runs";
import { rejectCrossSite } from "@/server/http/request";

export const dynamic = "force-dynamic";

/** Stops a running answer (the partial answer is kept and marked as stopped). */
export async function POST(req: Request, ctx: RouteContext<"/api/chat/runs/[messageId]/stop">) {
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;
  const { messageId } = await ctx.params;
  if (!idSchema.safeParse(messageId).success) return jsonError(400, "Invalid message id.");
  const pctx = await chatContext(new URL(req.url).searchParams.get("projectId"));
  if (pctx instanceof Response) return pctx;
  const stopped = stopRun(messageId, pctx.user.id);
  return Response.json({ stopped }, { headers: { "Cache-Control": "no-store" } });
}
