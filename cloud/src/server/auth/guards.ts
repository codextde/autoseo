import "server-only";
import { redirect } from "next/navigation";
import { getCurrentSession, type CurrentSession } from "./session";

/** Pages: redirect to /login (keeping the current path) when signed out. */
export async function requireUser(nextPath = "/dashboard"): Promise<CurrentSession> {
  const current = await getCurrentSession();
  if (!current) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  return current;
}

/** Pages: admins only; everyone else is sent to their dashboard. */
export async function requireAdmin(): Promise<CurrentSession> {
  const current = await requireUser("/admin");
  if (!current.user.isAdmin) redirect("/dashboard?error=forbidden");
  return current;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
  ) {
    super(message);
  }
}

/** Server actions / route handlers: throws instead of redirecting. */
export async function assertUser(): Promise<CurrentSession> {
  const current = await getCurrentSession();
  if (!current) throw new AuthError("You are signed out. Please sign in again.", 401);
  return current;
}

export async function assertAdmin(): Promise<CurrentSession> {
  const current = await assertUser();
  if (!current.user.isAdmin) throw new AuthError("Admins only.", 403);
  return current;
}
