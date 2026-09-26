import { NextResponse } from "next/server";
import { getCurrentSession } from "@/server/auth/session";
import { appUrl } from "@/server/http";
import { instanceSsoRedirect } from "@/server/instance-access";

/**
 * One-click sign-in link used in emails: signs a short-lived SSO token for the signed-in owner and
 * redirects to their instance. Signed-out visitors go through /login first.
 */
export async function GET() {
  const current = await getCurrentSession();
  if (!current) return NextResponse.redirect(appUrl(`/login?next=${encodeURIComponent("/api/instance/open")}`), 303);
  const target = await instanceSsoRedirect(current.user);
  return NextResponse.redirect(target ?? appUrl("/dashboard"), 303);
}
