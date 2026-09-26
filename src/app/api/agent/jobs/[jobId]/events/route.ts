import { z } from "zod";
import { agentJson, authenticateAgent, readJsonBody } from "@/server/agents/agent-api";
import { appendChatEvents } from "@/server/agents/jobs";

export const dynamic = "force-dynamic";

const eventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), delta: z.string().max(64_000) }),
  z.object({ type: z.literal("thinking"), delta: z.string().max(64_000) }),
  z.object({ type: z.literal("tool_call"), id: z.string().max(200), name: z.string().max(200), input: z.unknown().optional() }),
  z.object({ type: z.literal("tool_result"), id: z.string().max(200), output: z.string().max(20_000), isError: z.boolean().optional() }),
]);

const bodySchema = z.object({ events: z.array(eventSchema).max(500) });

/** Structured chat events (text/thinking deltas, tool calls & results) of a running `chat` job. */
export async function POST(req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const auth = await authenticateAgent(req);
  if (auth instanceof Response) return auth;
  const { jobId } = await params;
  const body = await readJsonBody(req, bodySchema, 2_000_000);
  if (body instanceof Response) return body;
  const res = await appendChatEvents(auth.agent, jobId, body.events);
  return agentJson(res, res.ok ? 200 : 409);
}
