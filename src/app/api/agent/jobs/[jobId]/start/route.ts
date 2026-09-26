import { z } from "zod";
import { agentJson, authenticateAgent, readJsonBody } from "@/server/agents/agent-api";
import { markJobStarted } from "@/server/agents/jobs";

export const dynamic = "force-dynamic";

const startSchema = z.object({
  runtime: z.enum(["claude", "codex"]),
  cliVersion: z.string().max(120).nullish(),
  workDir: z.string().max(1000).nullish(),
  cliMode: z.enum(["lean", "full"]).nullish(),
});

export async function POST(req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const auth = await authenticateAgent(req);
  if (auth instanceof Response) return auth;
  const { jobId } = await params;
  const body = await readJsonBody(req, startSchema, 16_000);
  if (body instanceof Response) return body;
  const res = await markJobStarted(auth.agent, jobId, body);
  return agentJson(res, res.ok ? 200 : 409);
}
