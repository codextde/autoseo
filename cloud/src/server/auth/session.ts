import "server-only";
import { cookies } from "next/headers";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/server/db/client";
import { sessions, users, type User } from "@/server/db/schema";
import { randomToken, sha256, timingSafeEqualStr } from "@/server/crypto";
import { env, isAdminEmail } from "@/server/env";
import { getRequestMeta } from "@/server/http";

/** `__Host-` prefix (Secure, no Domain, Path=/) in production; plain name on http://localhost. */
export const SESSION_COOKIE = env.isLocal ? "cloud_session" : "__Host-cloud_session";
const SESSION_DAYS = 365;

export type CurrentSession = { sessionId: string; user: User };

/** Creates a new device session (any number of devices may be signed in) and sets the cookie. */
export async function createSession(userId: string): Promise<void> {
  const { ip, userAgent } = await getRequestMeta();
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ userId, tokenHash: sha256(token), ip, userAgent, expiresAt });
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: !env.isLocal,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

async function lookupSession(token: string): Promise<CurrentSession | null> {
  // Only the SHA-256 of the 256-bit token is stored; the raw token is never compared.
  const hash = sha256(token);
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hash), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!row || !timingSafeEqualStr(row.session.tokenHash, hash)) return null;
  let user = row.user;
  // ADMIN_EMAILS is the source of truth for admin rights; keep the column in sync.
  const admin = isAdminEmail(user.email);
  if (admin !== user.isAdmin) {
    await db.update(users).set({ isAdmin: admin }).where(eq(users.id, user.id));
    user = { ...user, isAdmin: admin };
  }
  if (Date.now() - row.session.lastSeenAt.getTime() > 5 * 60 * 1000) {
    await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, row.session.id));
  }
  return { sessionId: row.session.id, user };
}

/** Current session for this request (memoized per request). */
export const getCurrentSession = cache(async (): Promise<CurrentSession | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token || token.length > 200) return null;
  return lookupSession(token);
});

export async function destroyCurrentSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, sha256(token)));
  // Browsers only accept clearing a `__Host-` cookie with the same Secure/Path attributes.
  jar.delete({ name: SESSION_COOKIE, path: "/", secure: !env.isLocal, httpOnly: true, sameSite: "lax" });
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

export async function countActiveSessions(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())));
  return row?.n ?? 0;
}
