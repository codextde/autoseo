import { z } from "zod";
import { agentJson, authenticateAgent, readJsonBody } from "@/server/agents/agent-api";
import { completeAgentJob } from "@/server/agents/jobs";

export const dynamic = "force-dynamic";

const completeSchema = z.object({
  status: z.enum(["succeeded", "failed", "cancelled", "timeout"]),
  text: z.string().max(2_000_000).nullish(),
  json: z.unknown().optional(),
  citations: z
    .array(z.object({ url: z.string().max(2000), title: z.string().max(500).optional() }))
    .max(200)
    .optional(),
  model: z.string().max(120).nullish(),
  runtime: z.enum(["claude", "codex"]).nullish(),
  cliVersion: z.string().max(120).nullish(),
  exitCode: z.number().int().nullish(),
  error: z.string().max(8000).nullish(),
  durationMs: z.number().int().min(0).nullish(),
  usage: z.record(z.string(), z.unknown()).nullish(),
  retryable: z.boolean().optional(),
});

/** Final result of a job (success, failure, cancellation or timeout). */
export async function POST(req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const auth = await authenticateAgent(req);
  if (auth instanceof Response) return auth;
  const { jobId } = await params;
  const body = await readJsonBody(req, completeSchema, 5_000_000);
  if (body instanceof Response) return body;
  const res = await completeAgentJob(auth.agent, jobId, body);
  return agentJson(res, res.accepted ? 200 : 409);
}
