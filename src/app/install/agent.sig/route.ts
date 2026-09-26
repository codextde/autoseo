import { getAgentRuntime } from "@/server/agents/runtime";

export const dynamic = "force-dynamic";

/** Ed25519 signature (base64) of `/install/agent.mjs`, made with this instance's release key. */
export async function GET() {
  const rt = getAgentRuntime();
  return new Response(`${rt.signature}\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Agent-Version": rt.version },
  });
}
