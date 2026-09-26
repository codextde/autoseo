import type { NextRequest } from "next/server";
import { collectUrl, findSettingsByPublicKey, snippetNamespace } from "@/server/attribution/settings";
import { buildSnippetJs, invalidKeySnippet, snippetConfig } from "@/server/attribution/snippet";

export const dynamic = "force-dynamic";

/** Public attribution snippet: GET /api/public/attribution/snippet.js?k=<publicKey> */
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("k") ?? "";
  const headers = {
    "Content-Type": "application/javascript; charset=utf-8",
    "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
  };
  const settings = key ? await findSettingsByPublicKey(key) : null;
  if (!settings) {
    return new Response(invalidKeySnippet("Unknown or missing project key — copy the install code again from the Attribution setup."), {
      status: 200,
      headers: { ...headers, "Cache-Control": "public, max-age=60" },
    });
  }
  const js = buildSnippetJs(
    snippetConfig({ publicKey: settings.publicKey, endpoint: collectUrl(), ns: await snippetNamespace(), survey: settings.survey }),
  );
  return new Response(js, { status: 200, headers });
}
