import { agentJson, authenticateAgent, checkinSchema, handleCheckin, readJsonBody } from "@/server/agents/agent-api";

export const dynamic = "force-dynamic";

/** Agent check-in: reports environment + running jobs, receives settings, updates, cancels, commands. */
export async function POST(req: Request) {
  const auth = await authenticateAgent(req);
  if (auth instanceof Response) return auth;
  const body = await readJsonBody(req, checkinSchema, 256_000);
  if (body instanceof Response) return body;
  return agentJson(await handleCheckin(auth.agent, body, auth.ip));
}
