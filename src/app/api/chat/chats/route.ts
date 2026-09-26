import { chatContext, jsonError } from "@/server/chat/http";
import { getUsageMeter, listChats, searchChats } from "@/server/chat/store";

export const dynamic = "force-dynamic";

/**
 * The signed-in user's chats in a project (sidebar list + usage meter), or a search over chat
 * titles and message contents when `q` is given.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const ctx = await chatContext(url.searchParams.get("projectId"));
  if (ctx instanceof Response) return ctx;
  const q = url.searchParams.get("q");
  try {
    if (q !== null) {
      const hits = await searchChats(ctx.project.id, ctx.user.id, q.slice(0, 200));
      return Response.json({ hits }, { headers: { "Cache-Control": "no-store" } });
    }
    // Workspace AI spend is only shown to roles that may see usage.
    const [chats, usage] = await Promise.all([
      listChats(ctx.project.id, ctx.user.id),
      ctx.permissions.has("usage.view") ? getUsageMeter(ctx.project.workspaceId, ctx.user.id) : Promise.resolve(null),
    ]);
    return Response.json({ chats, usage, canChat: ctx.permissions.has("prompts.manage") }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[chat] list failed", err);
    return jsonError(500, "Could not load chats.");
  }
}
