import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { env } from "@/server/env";
import { createSession, getRequestMeta } from "@/server/auth/session";
import { normalizeEmail } from "@/server/auth/domains";
import { claimSsoNonce, verifySsoToken } from "@/server/auth/sso";
import { rateLimit } from "@/server/rate-limit";
import { logAudit } from "@/server/audit";

/** One-click sign-in from the AutoSEO Cloud dashboard (only when AUTOSEO_SSO_SECRET is set). */
export async function GET(request: NextRequest) {
  const fail = () => NextResponse.redirect(new URL("/login?error=sso", env.appUrl));
  const secret = env.bootstrap.ssoSecret;
  if (!secret || secret.length < 32) return fail();
  const { ip } = await getRequestMeta();
  if (!rateLimit(`sso:${ip ?? "unknown"}`, 30, 60 * 60 * 1000)) return fail();

  const claims = verifySsoToken(secret, request.nextUrl.searchParams.get("token") ?? "");
  if (!claims || !claimSsoNonce(claims.nonce, claims.exp)) return fail();

  const email = normalizeEmail(claims.email);
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || user.status !== "active") return fail();

  await createSession(user.id);
  void logAudit("auth.login", { actor: { id: user.id, email }, meta: { via: "cloud-sso" } });
  return NextResponse.redirect(new URL("/", env.appUrl));
}
