import "server-only";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { loginTokens, users } from "@/server/db/schema";
import { hmac, randomDigits, randomToken, sha256, timingSafeEqualStr } from "@/server/crypto";
import { isAdminEmail } from "@/server/env";
import { appUrl, getRequestMeta, safeNext } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { sendMail } from "@/server/email";
import { magicLinkEmail } from "@/server/email/templates";
import { logEvent } from "@/server/events";
import { createSession } from "./session";

const LINK_MINUTES = 20;
const MAX_CODE_ATTEMPTS = 5;
const EMAIL_PATTERN = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

export function normalizeEmail(raw: string): string {
  return String(raw ?? "").trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_PATTERN.test(email);
}

export type LoginRequestResult = { ok: true; email: string; transport: "smtp" | "log" } | { ok: false; error: string };

/** Step 1: email a magic link + 6-digit code. Anyone may sign up; the account is created on first verified sign-in. */
export async function requestLogin(rawEmail: string, next: string | null, mode: "login" | "signup"): Promise<LoginRequestResult> {
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) return { ok: false, error: "Please enter a valid email address." };

  const { ip } = await getRequestMeta();
  if (!rateLimit(`login:email:${email}`, 5, 60 * 60 * 1000) || !rateLimit(`login:ip:${ip ?? "unknown"}`, 20, 60 * 60 * 1000)) {
    return { ok: false, error: "Too many sign-in emails requested. Please wait a while and try again." };
  }

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  const token = randomToken(32);
  const code = randomDigits(6);
  await db.insert(loginTokens).values({
    email,
    tokenHash: sha256(token),
    codeHash: hmac(`${email}:${code}`, "login-code"),
    redirectTo: safeNext(next),
    requestIp: ip,
    expiresAt: new Date(Date.now() + LINK_MINUTES * 60 * 1000),
  });

  const mail = magicLinkEmail({
    url: appUrl(`/auth/verify?token=${encodeURIComponent(token)}`),
    code,
    minutes: LINK_MINUTES,
    signup: mode === "signup" && !existing,
    ip,
  });
  const result = await sendMail({ to: email, ...mail });
  await logEvent("auth.login_requested", { userId: existing?.id, data: { email, transport: result.transport, delivered: result.delivered } });
  if (result.transport === "smtp" && !result.delivered) {
    return { ok: false, error: "We couldn't send the email right now. Please try again in a moment." };
  }
  return { ok: true, email, transport: result.transport };
}

type VerifyResult = { ok: true; redirectTo: string } | { ok: false; error: string };

async function completeLogin(row: typeof loginTokens.$inferSelect): Promise<VerifyResult> {
  // Single use, atomically: two concurrent verifications can't both win.
  const [claimed] = await db
    .update(loginTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(loginTokens.id, row.id), isNull(loginTokens.usedAt)))
    .returning({ id: loginTokens.id });
  if (!claimed) return { ok: false, error: "This sign-in link or code was already used." };

  const admin = isAdminEmail(row.email);
  const [created] = await db
    .insert(users)
    .values({ email: row.email, isAdmin: admin })
    .onConflictDoNothing({ target: users.email })
    .returning();
  const user = created ?? (await db.select().from(users).where(eq(users.email, row.email)).limit(1))[0];
  if (!user) return { ok: false, error: "Sign-in failed. Please try again." };
  if (user.isAdmin !== admin) await db.update(users).set({ isAdmin: admin }).where(eq(users.id, user.id));

  await createSession(user.id);
  await logEvent(created ? "auth.signup" : "auth.login", { userId: user.id, data: { email: user.email } });
  // Invalidate any other outstanding links/codes for this email.
  await db
    .update(loginTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(loginTokens.email, row.email), isNull(loginTokens.usedAt)));
  return { ok: true, redirectTo: safeNext(row.redirectTo) ?? "/dashboard" };
}

/** Step 2a: the magic link was opened and confirmed on this device. */
export async function verifyLoginToken(token: string): Promise<VerifyResult> {
  if (!token || token.length > 200) return { ok: false, error: "This sign-in link is invalid." };
  const hash = sha256(token);
  const [row] = await db.select().from(loginTokens).where(eq(loginTokens.tokenHash, hash)).limit(1);
  if (!row || !timingSafeEqualStr(row.tokenHash, hash) || row.usedAt) {
    return { ok: false, error: "This sign-in link is invalid or was already used." };
  }
  if (row.expiresAt < new Date()) return { ok: false, error: "This sign-in link has expired. Request a new one." };
  return completeLogin(row);
}

/** Step 2b: the 6-digit code was typed on the device that requested it. */
export async function verifyLoginCode(rawEmail: string, rawCode: string): Promise<VerifyResult> {
  const email = normalizeEmail(rawEmail);
  const code = String(rawCode ?? "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code)) return { ok: false, error: "Enter the 6-digit code from the email." };
  const { ip } = await getRequestMeta();
  if (!rateLimit(`code:ip:${ip ?? "unknown"}`, 30, 60 * 60 * 1000) || !rateLimit(`code:email:${email}`, 10, 60 * 60 * 1000)) {
    return { ok: false, error: "Too many attempts. Please request a new sign-in email later." };
  }
  const [row] = await db
    .select()
    .from(loginTokens)
    .where(and(eq(loginTokens.email, email), isNull(loginTokens.usedAt), gt(loginTokens.expiresAt, new Date())))
    .orderBy(desc(loginTokens.createdAt))
    .limit(1);
  if (!row) return { ok: false, error: "The code is invalid or has expired." };
  // Reserve an attempt atomically *before* comparing so parallel guesses can't share one attempt.
  const [reserved] = await db
    .update(loginTokens)
    .set({ attempts: sql`${loginTokens.attempts} + 1` })
    .where(and(eq(loginTokens.id, row.id), lt(loginTokens.attempts, MAX_CODE_ATTEMPTS), isNull(loginTokens.usedAt)))
    .returning({ id: loginTokens.id });
  if (!reserved) return { ok: false, error: "Too many wrong codes. Request a new sign-in email." };
  if (!timingSafeEqualStr(row.codeHash, hmac(`${email}:${code}`, "login-code"))) {
    return { ok: false, error: "That code is incorrect." };
  }
  return completeLogin(row);
}

/** Housekeeping (reconciler): drop sign-in tokens that expired more than a day ago. */
export async function purgeExpiredLoginTokens(): Promise<void> {
  await db.delete(loginTokens).where(lt(loginTokens.expiresAt, new Date(Date.now() - 24 * 60 * 60 * 1000)));
}
