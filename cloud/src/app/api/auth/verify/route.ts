import { NextResponse } from "next/server";
import { verifyLoginToken } from "@/server/auth/login";
import { appUrl, isSameOrigin } from "@/server/http";

/**
 * Magic-link confirmation (a plain form POST from /auth/verify, so it works without JavaScript).
 * The extra click keeps email security scanners that pre-fetch links from using the token.
 */
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return Response.json({ error: "Cross-site request blocked" }, { status: 403 });
  const form = await req.formData().catch(() => null);
  const token = String(form?.get("token") ?? "");
  const res = await verifyLoginToken(token);
  if (!res.ok) return NextResponse.redirect(appUrl("/auth/verify?error=invalid"), 303);
  return NextResponse.redirect(appUrl(res.redirectTo), 303);
}
