"use server";

import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { workspaceMembers } from "@/server/db/schema";
import { actionUser, ActionError, runAction } from "@/server/auth/guards";
import { SESSION_COOKIE } from "@/server/auth/session";
import { rateLimit } from "@/server/rate-limit";
import { logAudit } from "@/server/audit";
import { eraseUser, ErasureError, getErasureInventory, listTransferCandidates } from "@/server/admin/erasure";
import { MemberError, setMemberRole } from "@/server/admin/members";

/** What "Delete my account" will remove, plus anything that blocks it (with transfer options). */
export async function getMyErasureInventoryAction() {
  return runAction(async () => {
    const ctx = await actionUser();
    const inv = await getErasureInventory(ctx.user.id);
    const transfer = [];
    for (const b of inv.blockers) {
      if (b.code !== "sole_owner") continue;
      for (const ws of b.workspaces) {
        transfer.push({ workspace: ws, candidates: await listTransferCandidates(ws.id, ctx.user.id) });
      }
    }
    return { items: inv.items, blockers: inv.blockers.map((b) => ({ code: b.code, message: b.message })), transfer };
  });
}

/** Makes another member of a workspace an owner (the caller must own it). */
export async function transferOwnershipAction(input: { workspaceId: string; userId: string }) {
  return runAction(async () => {
    const ctx = await actionUser();
    const data = z.object({ workspaceId: z.string().min(3).max(64), userId: z.string().min(3).max(64) }).parse(input);
    const [mine] = await db
      .select({ roleKey: workspaceMembers.roleKey })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, data.workspaceId), eq(workspaceMembers.userId, ctx.user.id)))
      .limit(1);
    if (mine?.roleKey !== "owner") throw new ActionError("Only an owner can hand over ownership.", "forbidden");
    const [target] = await db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, data.workspaceId), eq(workspaceMembers.userId, data.userId)))
      .limit(1);
    if (!target || data.userId === ctx.user.id) throw new ActionError("Choose another member of this workspace.", "invalid");
    try {
      await setMemberRole(data.workspaceId, data.userId, "owner", ctx.user);
    } catch (err) {
      if (err instanceof MemberError) throw new ActionError(err.message, "invalid");
      throw err;
    }
    void logAudit("workspace.ownership_transferred", { actor: ctx.user, targetType: "user", targetId: data.userId, workspaceId: data.workspaceId });
    return true;
  });
}

/** Self-service account deletion (GDPR erasure). Signs the user out on success. */
export async function deleteMyAccountAction(confirmEmail: string) {
  return runAction(async () => {
    const ctx = await actionUser();
    if (!rateLimit(`erase-self:${ctx.user.id}`, 5, 60 * 60_000)) throw new ActionError("Too many attempts. Try again later.", "invalid");
    try {
      await eraseUser(ctx.user.id, { confirmEmail: z.string().max(320).parse(confirmEmail), actor: null, initiatedBy: "self" });
    } catch (err) {
      if (err instanceof ErasureError) throw new ActionError(err.message, err.code === "confirm_mismatch" ? "invalid" : "conflict");
      throw err;
    }
    (await cookies()).delete(SESSION_COOKIE);
    return { redirectTo: "/login" };
  });
}
