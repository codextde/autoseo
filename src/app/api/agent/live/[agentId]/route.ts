import type { NextRequest } from "next/server";
import { getUserContext } from "@/server/auth/context";
import { getManageableAgent } from "@/server/agents/service";
import { createLiveStream } from "@/server/agents/live";

export const dynamic = "force-dynamic";

/**
 * Live terminal (Server-Sent Events): streams the agent's log lines and job output in real time.
 * Session-authenticated; requires `agents.manage` in the agent's workspace (or instance admin).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  const ctx = await getUserContext();
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { agentId } = await params;
  const agent = await getManageableAgent(ctx, agentId);
  if (!agent) return Response.json({ error: "not_found" }, { status: 404 });

  const sp = req.nextUrl.searchParams;
  const jobId = sp.get("jobId");
  const lastEventId = req.headers.get("last-event-id") ?? sp.get("after");
  const after = lastEventId && /^\d+$/.test(lastEventId) ? Number(lastEventId) : null;
  const backlog = Number(sp.get("backlog") ?? 300);

  const stream = createLiveStream({
    agentId: agent.id,
    jobId: jobId && /^ajb_[a-z0-9]+$/.test(jobId) ? jobId : null,
    after,
    backlog: Number.isFinite(backlog) ? backlog : 300,
    signal: req.signal,
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
