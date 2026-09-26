import { z } from "zod";
import { agentJson, authenticateAgent, readJsonBody } from "@/server/agents/agent-api";
import { appendAgentLogs } from "@/server/agents/jobs";

export const dynamic = "force-dynamic";

const logsSchema = z.object({
  entries: z
    .array(
      z.object({
        jobId: z.string().max(40).nullish(),
        stream: z.enum(["stdout", "stderr", "agent", "system"]),
        data: z.string().max(64_000),
      }),
    )
    .max(500),
});

/** Streams job output / agent log lines. Responds with job ids the agent should cancel. */
export async function POST(req: Request) {
  const auth = await authenticateAgent(req);
  if (auth instanceof Response) return auth;
  const body = await readJsonBody(req, logsSchema, 1_000_000);
  if (body instanceof Response) return body;
  const cancel = await appendAgentLogs(auth.agent, body.entries);
  return agentJson({ ok: true, cancel });
}
