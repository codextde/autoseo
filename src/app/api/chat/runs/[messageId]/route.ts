import { chatContext, idSchema, jsonError } from "@/server/chat/http";
import { ownsMessage } from "@/server/chat/orchestrator";
import { getRun, snapshot, subscribe } from "@/server/chat/runs";
import { getMessage, toMessageView, updateMessage } from "@/server/chat/store";
import type { ChatStreamEvent } from "@/features/chat/types";

export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 15_000;

/**
 * Server-sent events for one assistant answer: a `snapshot` of everything produced so far, then
 * live events until `done`. Reconnecting (reload, navigation) resumes from a fresh snapshot.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/chat/runs/[messageId]">) {
  const { messageId } = await ctx.params;
  if (!idSchema.safeParse(messageId).success) return jsonError(400, "Invalid message id.");
  const pctx = await chatContext(new URL(req.url).searchParams.get("projectId"));
  if (pctx instanceof Response) return pctx;
  const owner = await ownsMessage(pctx.user.id, pctx.project.id, messageId);
  if (!owner) return jsonError(404, "Not found.");

  const encoder = new TextEncoder();
  const run = getRun(messageId);
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (ev: ChatStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      if (!run) {
        // Finished (or orphaned by a restart): answer from the database.
        let row = await getMessage(messageId);
        if (row?.status === "streaming") {
          row = await updateMessage(messageId, { status: "error", error: "The answer was interrupted (the server restarted). Retry to generate it again." });
        }
        if (row) send({ type: "done", message: toMessageView(row) });
        close();
        return;
      }

      send({ type: "snapshot", message: snapshot(run) });
      if (run.status && !run.final) send({ type: "status", phase: run.status.phase as "running", text: run.status.text, runtime: run.runtime ?? undefined });
      if (run.final) {
        send({ type: "done", message: run.final });
        close();
        return;
      }
      const unsubscribe = subscribe(run, (ev) => {
        send(ev);
        if (ev.type === "done" || ev.type === "error") close();
      });
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          close();
        }
      }, HEARTBEAT_MS);
      cleanup = () => {
        unsubscribe();
        clearInterval(heartbeat);
      };
      req.signal.addEventListener("abort", close, { once: true });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
