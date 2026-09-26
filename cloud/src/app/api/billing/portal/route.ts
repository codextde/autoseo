import { NextResponse } from "next/server";
import { getCurrentSession } from "@/server/auth/session";
import { appUrl } from "@/server/http";
import { createPortalSession } from "@/server/stripe";

/** Stable link to the Stripe customer portal (used in payment-failed emails). */
export async function GET() {
  const current = await getCurrentSession();
  if (!current) return NextResponse.redirect(appUrl(`/login?next=${encodeURIComponent("/api/billing/portal")}`), 303);
  try {
    return NextResponse.redirect(await createPortalSession(current.user), 303);
  } catch {
    return NextResponse.redirect(appUrl("/dashboard?error=billing"), 303);
  }
}
