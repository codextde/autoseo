import { getInstallScript } from "@/server/agents/runtime";

export const dynamic = "force-dynamic";

/** `iwr -useb <host>/install.ps1 | iex; Install-AutoSEOAgent -Token … -HostUrl …` (Windows). */
export async function GET() {
  return new Response(getInstallScript("ps1"), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
