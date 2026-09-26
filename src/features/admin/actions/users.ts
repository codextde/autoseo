"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { rateLimit } from "@/server/rate-limit";
import { eraseUser, ErasureError, getErasureInventory } from "@/server/admin/erasure";
import { actionAdmin, ActionError, runAction } from "@/server/auth/guards";
import { MemberError, removeMember, setMemberRole, setProjectAccess } from "@/server/admin/members";
import {
  getAdminUserDetail,
  revokeAllUserSessions,
  revokeUserSession,
  updateAdminUser,
} from "@/server/admin/users";

const id = z.string().min(3).max(64);

/** Maps domain errors of the admin services to user-facing action errors. */
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof MemberError) throw new ActionError(err.message, "invalid");
    throw err;
  }
}

export async function getUserDetailAction(userId: string) {
  return runAction(async () => {
    await actionAdmin();
    return guarded(() => getAdminUserDetail(id.parse(userId)));
  });
}

const updateSchema = z.object({
  name: z.string().trim().max(120).nullable().optional(),
  status: z.enum(["active", "disabled"]).optional(),
  isInstanceAdmin: z.boolean().optional(),
});

export async function updateUserAction(userId: string, patch: z.input<typeof updateSchema>) {
  return runAction(async () => {
    const ctx = await actionAdmin();
    await guarded(() => updateAdminUser(id.parse(userId), updateSchema.parse(patch), ctx.user));
    refresh();
    return true;
  });
}

export async function setUserMembershipAction(userId: string, workspaceId: string, roleKey: string | null) {
  return runAction(async () => {
    const ctx = await actionAdmin();
    const uid = id.parse(userId);
    const wid = id.parse(workspaceId);
    await guarded(() =>
      roleKey ? setMemberRole(wid, uid, z.string().min(1).max(64).parse(roleKey), ctx.user) : removeMember(wid, uid, ctx.user),
    );
    refresh();
    return true;
  });
}

export async function setUserProjectAccessAction(userId: string, workspaceId: string, projectIds: string[]) {
  return runAction(async () => {
    const ctx = await actionAdmin();
    const ids = await guarded(() =>
      setProjectAccess(id.parse(workspaceId), id.parse(userId), z.array(id).max(1000).parse(projectIds), ctx.user),
    );
    refresh();
    return ids;
  });
}

export async function revokeUserSessionAction(userId: string, sessionId: string) {
  return runAction(async () => {
    const ctx = await actionAdmin();
    await guarded(() => revokeUserSession(id.parse(userId), id.parse(sessionId), ctx.user));
    refresh();
    return true;
  });
}

export async function revokeAllUserSessionsAction(userId: string) {
  return runAction(async () => {
    const ctx = await actionAdmin();
    const uid = id.parse(userId);
    // Never kill the admin's own current session from here — they'd be signed out mid-action.
    const count = await revokeAllUserSessions(uid, ctx.user, uid === ctx.user.id ? ctx.sessionId : undefined);
    refresh();
    return count;
  });
}

/** Dry run: what "Erase user" deletes, revokes, anonymizes or keeps, plus blockers. */
export async function getUserErasureInventoryAction(userId: string) {
  return runAction(async () => {
    await actionAdmin();
    try {
      const inv = await getErasureInventory(id.parse(userId));
      return { items: inv.items, blockers: inv.blockers.map((b) => ({ code: b.code, message: b.message })) };
    } catch (err) {
      if (err instanceof ErasureError) throw new ActionError(err.message, "invalid");
      throw err;
    }
  });
}

/** GDPR erasure of another user (same routine as self-service account deletion). */
export async function eraseUserAction(userId: string, confirmEmail: string) {
  return runAction(async () => {
    const ctx = await actionAdmin();
    const uid = id.parse(userId);
    if (uid === ctx.user.id) throw new ActionError("To delete your own account use Settings → Account.", "invalid");
    if (!rateLimit(`admin-erase:${ctx.user.id}`, 30, 60 * 60_000)) throw new ActionError("Too many erasures in a short time.", "invalid");
    try {
      const res = await eraseUser(uid, {
        confirmEmail: z.string().max(320).parse(confirmEmail),
        actor: { id: ctx.user.id, email: ctx.user.email },
        initiatedBy: "admin",
      });
      refresh();
      return res;
    } catch (err) {
      if (err instanceof ErasureError) throw new ActionError(err.message, "invalid");
      throw err;
    }
  });
}
