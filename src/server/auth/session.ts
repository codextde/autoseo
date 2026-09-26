import "server-only";
import { cookies, headers } from "next/headers";
import { and, eq, gt, isNull, desc, sql } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/server/db/client";
import { sessions, users } from "@/server/db/schema";
import { randomToken, sha256 } from "@/server/crypto";
import { env } from "@/server/env";
import { getSetting } from "@/server/settings";
import { clientIp } from "@/server/http/request";

export const SESSION_COOKIE = env.isLocal ? "autoseo_session" : "__Host-autoseo_session";

export type SessionUser = typeof users.$inferSelect;
export type CurrentSession = { session: typeof sessions.$inferSelect; user: SessionUser };

export async function getRequestMeta() {
  const h = await headers();
  return { ip: await clientIp(h), userAgent: h.get("user-agent") ?? null };
}

function describeDevice(ua: string | null): string {
  if (!ua) return "Unknown device";
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "Unknown OS";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  return `${browser} on ${os}`;
}

/** Creates a new device session (multiple concurrent sessions are allowed) and sets the cookie. */
export async function createSession(userId: string): Promise<string> {
  const authSettings = await getSetting("auth");
  const { ip, userAgent } = await getRequestMeta();
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + authSettings.sessionDays * 24 * 60 * 60 * 1000);

  await db.insert(sessions).values({
    userId,
    tokenHash: sha256(token),
    ip,
    userAgent,
    deviceLabel: describeDevice(userAgent),
    expiresAt,
  });

  if (authSettings.maxSessionsPerUser > 0) {
    const active = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
      .orderBy(desc(sessions.lastSeenAt));
    const excess = active.slice(authSettings.maxSessionsPerUser);
    for (const s of excess) {
      await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, s.id));
    }
  }

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: !env.isLocal,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return token;
}

async function lookupSession(token: string): Promise<CurrentSession | null> {
  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, sha256(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row || row.user.status !== "active") return null;
  // Touch lastSeenAt at most every 5 minutes.
  if (Date.now() - row.session.lastSeenAt.getTime() > 5 * 60 * 1000) {
    const { ip } = await getRequestMeta().catch(() => ({ ip: null }));
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date(), ...(ip ? { ip } : {}) })
      .where(eq(sessions.id, row.session.id));
  }
  return row;
}

/** Current session for this request (memoized per request). */
export const getCurrentSession = cache(async (): Promise<CurrentSession | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return lookupSession(token);
});

export async function destroyCurrentSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, sha256(token)));
  }
  jar.delete(SESSION_COOKIE);
}

export async function listUserSessions(userId: string) {
  return db
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .orderBy(desc(sessions.lastSeenAt));
}

export async function revokeSession(userId: string, sessionId: string) {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string) {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        exceptSessionId ? sql`${sessions.id} <> ${exceptSessionId}` : sql`true`,
      ),
    );
}
