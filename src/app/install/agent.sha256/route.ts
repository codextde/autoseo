import { getAgentRuntime } from "@/server/agents/runtime";

export const dynamic = "force-dynamic";

/** SHA-256 of `/install/agent.mjs` (hex), followed by the version on a second line. */
export async function GET() {
  const rt = getAgentRuntime();
  return new Response(`${rt.sha256}\n${rt.version}\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Agent-Version": rt.version },
  });
}
