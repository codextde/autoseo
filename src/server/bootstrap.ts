import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { appSettings, users, workspaceMembers } from "@/server/db/schema";
import { env } from "@/server/env";
import { createWorkspace, ensureBuiltinRoles } from "@/server/auth/membership";
import { isValidEmail, normalizeEmail } from "@/server/auth/domains";
import { logAudit } from "@/server/audit";
import { needsSetup } from "@/server/setup";

/**
 * Unattended first run: when AUTOSEO_OWNER_EMAIL is set and the instance has no users yet, create that
 * user as instance admin + owner of the first workspace instead of waiting for the setup code.
 * Used by AutoSEO Cloud instances and scripted installs; the owner signs in with a magic link or SSO.
 */
export async function bootstrapOwnerFromEnv(): Promise<boolean> {
  const { ownerEmail, ownerName, workspaceName } = env.bootstrap;
  if (!ownerEmail || !(await needsSetup())) return false;
  const email = normalizeEmail(ownerEmail);
  if (!isValidEmail(email)) {
    console.warn(`[boot] AUTOSEO_OWNER_EMAIL is not a valid email address (${ownerEmail}) — falling back to /setup`);
    return false;
  }

  await ensureBuiltinRoles();
  const ws = await createWorkspace(workspaceName || "My Workspace");
  const [user] = await db
    .insert(users)
    .values({ email, name: ownerName || email.split("@")[0], isInstanceAdmin: true })
    .onConflictDoNothing()
    .returning();
  if (!user) return false;
  await db.insert(workspaceMembers).values({ workspaceId: ws.id, userId: user.id, roleKey: "owner" });
  await db.delete(appSettings).where(eq(appSettings.key, "__setup"));
  void logAudit("setup.completed", { actor: { id: user.id, email }, workspaceId: ws.id, meta: { via: "env" } });
  console.info(`[boot] created owner account ${email} from AUTOSEO_OWNER_EMAIL — sign in at ${env.appUrl}/login`);
  return true;
}
