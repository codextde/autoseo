import type { NextRequest } from "next/server";
import { getShareAccess } from "@/server/reports/share-access";
import { reportDocumentResponse } from "@/server/reports/document";

const NOT_SHARED = () => new Response("This report isn't shared.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex, nofollow" } });

/** Public sandboxed document of a shared AI HTML report. */
export async function GET(req: NextRequest, ctx: RouteContext<"/share/r/[token]/raw">) {
  const { token } = await ctx.params;
  const print = req.nextUrl.searchParams.get("print") === "1";
  // Never render the raw document top-level on the app origin. The only exception is print mode
  // opened from our own share page (same-origin navigation); direct links go to the framed viewer.
  const dest = req.headers.get("sec-fetch-dest");
  const site = req.headers.get("sec-fetch-site");
  const topLevel = !!dest && dest !== "iframe";
  if (topLevel && !(print && site === "same-origin")) return Response.redirect(new URL(`/share/r/${token}`, req.url), 302);
  const access = await getShareAccess(token);
  if (access.state !== "ok") return NOT_SHARED();
  const { r } = access.found;
  if (r.kind !== "html" || !r.html) return NOT_SHARED();
  return reportDocumentResponse(r.html, { print, shared: true });
}
