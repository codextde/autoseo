import { getInstallScript } from "@/server/agents/runtime";

export const dynamic = "force-dynamic";

/** `curl -fsSL <host>/install.sh | bash -s -- --token … --host …` (macOS / Linux). */
export async function GET() {
  return new Response(getInstallScript("sh"), {
    headers: { "Content-Type": "text/x-shellscript; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
