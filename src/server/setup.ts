import "server-only";
import { count, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { appSettings, users, workspaceMembers } from "@/server/db/schema";
import { randomDigits, sha256, timingSafeEqualStr } from "@/server/crypto";
import { updateSetting } from "@/server/settings";
import { env } from "@/server/env";
import { createSession } from "@/server/auth/session";
import { createWorkspace, ensureBuiltinRoles } from "@/server/auth/membership";
import { isValidEmail, normalizeEmail } from "@/server/auth/domains";
import { logAudit } from "@/server/audit";
import { rateLimit } from "@/server/rate-limit";

const SETUP_KEY = "__setup";

export async function needsSetup(): Promise<boolean> {
  const [row] = await db.select({ n: count() }).from(users);
  return (row?.n ?? 0) === 0;
}

/**
 * Generates a one-time setup code printed to the server log. Required to claim the instance so
 * a freshly deployed public instance cannot be hijacked by the first visitor.
 */
export async function ensureSetupCode(forceNew = false): Promise<void> {
  if (!(await needsSetup())) return;
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, SETUP_KEY)).limit(1);
  if (row && !forceNew) return;
  // Only the hash is stored; a fresh code is printed on every boot while setup is pending.
  const code = `${randomDigits(4)}-${randomDigits(4)}`;
  await db
    .insert(appSettings)
    .values({ key: SETUP_KEY, value: { codeHash: sha256(code) } })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: { codeHash: sha256(code) } } });
  printCode(code);
}

function printCode(code: string) {
  const lines = ["AutoSEO first-run setup", `Open ${env.appUrl}/setup`, `Setup code: ${code}`];
  const width = Math.max(...lines.map((l) => l.length)) + 4;
  const bar = "═".repeat(width);
  console.info(`\n╔${bar}╗\n${lines.map((l) => `║  ${l.padEnd(width - 2)}║`).join("\n")}\n╚${bar}╝\n`);
}

export async function verifySetupCode(code: string): Promise<boolean> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, SETUP_KEY)).limit(1);
  const v = row?.value as { codeHash?: string } | null;
  if (!v?.codeHash) return false;
  return timingSafeEqualStr(v.codeHash, sha256(code.trim()));
}

export async function completeSetup(input: {
  code: string;
  appName: string;
  workspaceName: string;
  name: string;
  email: string;
  allowedDomains: string[];
}) {
  if (!(await needsSetup())) throw new Error("Setup was already completed.");
  if (!rateLimit("setup:attempts", 20, 60 * 60 * 1000)) throw new Error("Too many attempts. Restart the server to get a new setup code.");
  if (!(await verifySetupCode(input.code))) throw new Error("The setup code is incorrect. Check the server logs.");
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) throw new Error("Please enter a valid email address.");
  const domains = input.allowedDomains
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
  if (domains.length && !domains.some((d) => email.endsWith(`@${d}`) || email.split("@")[1]?.endsWith(`.${d}`))) {
    throw new Error("Your own email must belong to one of the allowed domains.");
  }

  await ensureBuiltinRoles();
  const ws = await createWorkspace(input.workspaceName.trim() || "My Workspace");
  const [user] = await db
    .insert(users)
    .values({ email, name: input.name.trim() || email.split("@")[0], isInstanceAdmin: true })
    .returning();
  await db.insert(workspaceMembers).values({ workspaceId: ws.id, userId: user!.id, roleKey: "owner" });
  await updateSetting("auth", { allowedDomains: domains }, user!.id);
  await updateSetting("general", { appName: input.appName.trim() || "AutoSEO" }, user!.id);
  await db.delete(appSettings).where(eq(appSettings.key, SETUP_KEY));
  await createSession(user!.id);
  void logAudit("setup.completed", { actor: { id: user!.id, email }, workspaceId: ws.id });
  return { user: user!, workspace: ws };
}
