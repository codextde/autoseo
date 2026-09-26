import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { agents } from "@/server/db/schema";
import { agentJson, authenticateAgent, readJsonBody } from "@/server/agents/agent-api";
import { claimJobsForAgent, pendingCancels, type AgentJobRow } from "@/server/agents/jobs";
import { waitForSignal } from "@/server/agents/notify";
import { getSetting } from "@/server/settings";

export const dynamic = "force-dynamic";

const pollSchema = z.object({
  slots: z.number().int().min(0).max(64),
  running: z.array(z.string().max(40)).max(128).default([]),
  runtimes: z.array(z.enum(["claude", "codex"])).max(2).default([]),
  wait: z.number().int().min(0).max(25).default(25),
});

function toWire(job: AgentJobRow, agentOwnerId: string | null) {
  return {
    id: job.id,
    kind: job.kind,
    purpose: job.purpose,
    runtime: job.runtime,
    payload: job.payload,
    timeoutMs: job.timeoutMs,
    attempt: job.attempts,
    /** Requested by this machine's owner (the agent grants more capabilities only to those jobs). */
    owner: !!job.userId && job.userId === agentOwnerId,
  };
}

/** Long-poll (≤25s) for jobs. Returns early when jobs are assigned or a cancel is requested. */
export async function POST(req: Request) {
  const auth = await authenticateAgent(req);
  if (auth instanceof Response) return auth;
  const body = await readJsonBody(req, pollSchema, 64_000);
  if (body instanceof Response) return body;
  const agentId = auth.agent.id;
  const deadline = Date.now() + body.wait * 1000;
  let lastTouch = Date.now();

  while (!req.signal.aborted) {
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
    // Deleted or reinstalled (token rotated) while this long-poll was open → stop immediately.
    if (!agent || agent.tokenHash !== auth.agent.tokenHash) return agentJson({ error: "unauthorized", message: "This agent token is no longer valid." }, 401);
    const settings = await getSetting("agents");
    if (body.slots > 0 && agent.state !== "updating" && agent.state !== "stopping") {
      const jobs = await claimJobsForAgent(agent, body.slots, body.runtimes, { globalEnabled: settings.enabled });
      if (jobs.length) return agentJson({ jobs: jobs.map((j) => toWire(j, agent.userId)), cancel: [] });
    }
    if (body.running.length) {
      const cancels = (await pendingCancels(agentId)).filter((id) => body.running.includes(id));
      if (cancels.length) return agentJson({ jobs: [], cancel: cancels });
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    if (Date.now() - lastTouch > 10_000) {
      await db.update(agents).set({ lastSeenAt: new Date() }).where(eq(agents.id, agentId));
      lastTouch = Date.now();
    }
    await waitForSignal(
      (s) =>
        s.type === "job-new" ||
        (s.type === "job-cancel" && s.agentId === agentId) ||
        (s.type === "agent-changed" && s.agentId === agentId),
      Math.min(remaining, 3_000),
      req.signal,
    );
  }
  return agentJson({ jobs: [], cancel: [] });
}
