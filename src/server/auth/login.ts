import "server-only";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { invitations, loginTokens, users } from "@/server/db/schema";
import { hmac, randomDigits, randomToken, sha256, timingSafeEqualStr } from "@/server/crypto";
import { getSetting } from "@/server/settings";
import { sendMail, appUrl } from "@/server/email";
import { magicLinkEmail } from "@/server/email/templates";
import { rateLimit } from "@/server/rate-limit";
import { logAudit } from "@/server/audit";
import { createSession, getRequestMeta } from "./session";
import { isEmailDomainAllowed, isValidEmail, normalizeEmail } from "./domains";
import { acceptInvitationForUser, ensureDomainSignupUser } from "./membership";

export type LoginRequestResult =
  | { ok: true; generic: boolean; transport: "smtp" | "log"; email: string }
  | { ok: false; error: string };

/** Only same-origin relative paths ("/p/…"). Rejects protocol-relative, backslash and control-char tricks. */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || typeof next !== "string") return null;
  if (!next.startsWith("/") || next.startsWith("//") || /[\\\s\x00-\x1f]/.test(next)) return null;
  try {
    const url = new URL(next, "http://internal.invalid");
    if (url.origin !== "http://internal.invalid") return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}

/** Step 1: send a magic link + one-time code to an invited / allowed email. */
export async function requestLogin(rawEmail: string, next?: string | null): Promise<LoginRequestResult> {
  const email = normalizeEmail(rawEmail);
  const authSettings = await getSetting("auth");
  if (!isValidEmail(email)) return { ok: false, error: "Please enter a valid email address." };

  const { ip, userAgent } = await getRequestMeta();
  if (
    !rateLimit(`login:email:${email}`, authSettings.loginRateLimitPerHour, 60 * 60 * 1000) ||
    !rateLimit(`login:ip:${ip ?? "unknown"}`, authSettings.loginRateLimitPerHour * 3, 60 * 60 * 1000)
  ) {
    return { ok: false, error: "Too many sign-in attempts. Please wait a while and try again." };
  }

  const generic = authSettings.genericLoginResponse;
  const denied = (reason: string): LoginRequestResult => {
    void logAudit("auth.login_denied", { meta: { email, reason } });
    return generic ? { ok: true, generic: true, transport: "log", email } : { ok: false, error: reason };
  };

  if (!(await isEmailDomainAllowed(email))) {
    return denied("This email domain is not allowed to sign in.");
  }

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  let eligible = false;
  if (user) {
    if (user.status !== "active") return denied("This account is disabled. Contact your administrator.");
    eligible = true;
  } else {
    const [invite] = await db
      .select()
      .from(invitations)
      .where(and(eq(invitations.email, email), eq(invitations.status, "pending"), gt(invitations.expiresAt, new Date())))
      .limit(1);
    if (invite) eligible = true;
    else if (!authSettings.requireInvitation || authSettings.allowDomainSignup) eligible = true;
  }
  if (!eligible) return denied("No invitation found for this email. Ask an admin to invite you.");

  const token = randomToken(32);
  const code = randomDigits(6);
  const expiresAt = new Date(Date.now() + authSettings.magicLinkMinutes * 60 * 1000);
  await db.insert(loginTokens).values({
    email,
    userId: user?.id ?? null,
    tokenHash: sha256(token),
    codeHash: hmac(`${email}:${code}`, "login-code"),
    purpose: "login",
    redirectTo: safeNext(next),
    requestIp: ip,
    requestUserAgent: userAgent,
    expiresAt,
  });

  const mail = await magicLinkEmail({
    url: appUrl(`/auth/verify?token=${encodeURIComponent(token)}`),
    code,
    minutes: authSettings.magicLinkMinutes,
    ip,
    userAgent,
  });
  const result = await sendMail({ to: email, ...mail });
  void logAudit("auth.login_requested", { actor: user ? { id: user.id, email } : null, meta: { transport: result.transport } });
  return { ok: true, generic: false, transport: result.transport, email };
}

async function completeLogin(row: typeof loginTokens.$inferSelect): Promise<{ redirectTo: string }> {
  // Single use, atomically: two concurrent verifications can't both win.
  const [claimed] = await db
    .update(loginTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(loginTokens.id, row.id), isNull(loginTokens.usedAt)))
    .returning({ id: loginTokens.id });
  if (!claimed) throw new Error("This sign-in link or code was already used.");

  let [user] = await db.select().from(users).where(eq(users.email, row.email)).limit(1);
  if (!user) {
    // No user yet: accept a pending invitation, or self-register on an allowed domain.
    const accepted = await acceptInvitationForUser(row.email);
    user = accepted ?? (await ensureDomainSignupUser(row.email)) ?? undefined;
    if (!user) throw new Error("This email is not invited.");
  } else {
    // Existing user: also accept any pending invitations to additional workspaces.
    await acceptInvitationForUser(row.email);
  }
  if (user.status !== "active") throw new Error("This account is disabled.");

  await createSession(user.id);
  void logAudit("auth.login", { actor: { id: user.id, email: user.email } });
  return { redirectTo: safeNext(row.redirectTo) ?? "/" };
}

/** Step 2a: user clicked the magic link and confirmed. */
export async function verifyLoginToken(token: string): Promise<{ ok: true; redirectTo: string } | { ok: false; error: string }> {
  const [row] = await db
    .select()
    .from(loginTokens)
    .where(and(eq(loginTokens.tokenHash, sha256(token)), isNull(loginTokens.usedAt)))
    .limit(1);
  if (!row) return { ok: false, error: "This sign-in link is invalid or was already used." };
  if (row.expiresAt < new Date()) return { ok: false, error: "This sign-in link has expired. Request a new one." };
  try {
    const { redirectTo } = await completeLogin(row);
    return { ok: true, redirectTo };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Sign-in failed." };
  }
}

/** Step 2b: user typed the 6-digit code on the device where they requested the link. */
export async function verifyLoginCode(rawEmail: string, code: string): Promise<{ ok: true; redirectTo: string } | { ok: false; error: string }> {
  const email = normalizeEmail(rawEmail);
  const { ip } = await getRequestMeta();
  if (!rateLimit(`code:${ip ?? "?"}`, 30, 60 * 60 * 1000)) return { ok: false, error: "Too many attempts. Try again later." };
  const [row] = await db
    .select()
    .from(loginTokens)
    .where(and(eq(loginTokens.email, email), isNull(loginTokens.usedAt), gt(loginTokens.expiresAt, new Date())))
    .orderBy(desc(loginTokens.createdAt))
    .limit(1);
  if (!row || !row.codeHash) return { ok: false, error: "The code is invalid or expired." };
  // Per-email cap across all tokens (IP-independent), then reserve an attempt atomically
  // *before* comparing so parallel guesses can't share one attempt.
  if (!rateLimit(`code:email:${email}`, 10, 60 * 60 * 1000)) return { ok: false, error: "Too many attempts. Request a new sign-in link later." };
  const [reserved] = await db
    .update(loginTokens)
    .set({ attempts: sql`${loginTokens.attempts} + 1` })
    .where(and(eq(loginTokens.id, row.id), lt(loginTokens.attempts, 5), isNull(loginTokens.usedAt)))
    .returning({ id: loginTokens.id });
  if (!reserved) return { ok: false, error: "Too many wrong codes. Request a new sign-in link." };
  if (!timingSafeEqualStr(row.codeHash, hmac(`${email}:${code.replace(/\s+/g, "")}`, "login-code"))) {
    return { ok: false, error: "The code is incorrect." };
  }
  try {
    const { redirectTo } = await completeLogin(row);
    return { ok: true, redirectTo };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Sign-in failed." };
  }
}
