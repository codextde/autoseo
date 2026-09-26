"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { actionAdmin, ActionError, runAction } from "@/server/auth/guards";
import { createInvitation } from "@/server/auth/membership";
import { MemberError, reissueInvitation, revokeInvitation, userExists } from "@/server/admin/members";
import { rateLimit } from "@/server/rate-limit";

const inviteSchema = z.object({
  emails: z.array(z.string().trim().toLowerCase().max(254)).min(1, "Add at least one email").max(100, "Invite at most 100 people at once"),
  workspaceId: z.string().min(3).max(64),
  roleKey: z.string().min(1).max(64),
  projectIds: z.array(z.string().min(3).max(64)).max(500).default([]),
  makeInstanceAdmin: z.boolean().default(false),
  message: z.string().trim().max(2000).optional().nullable(),
});

export type InviteResult = {
  email: string;
  ok: boolean;
  error?: string;
  /** Accept link — only returned for people without an account (see reissueInvitation). */
  url?: string;
  existingAccount?: boolean;
  transport?: "smtp" | "log";
  delivered?: boolean;
};

/** Bulk invite: one invitation per email; returns a per-address result incl. the accept link. */
export async function createInvitationsAction(input: z.input<typeof inviteSchema>) {
  return runAction(async (): Promise<InviteResult[]> => {
    const ctx = await actionAdmin();
    const data = inviteSchema.parse(input);
    const emails = [...new Set(data.emails.filter(Boolean))];
    if (!rateLimit(`admin-invite:${ctx.user.id}`, 300, 60 * 60_000)) {
      throw new ActionError("Too many invitations in the last hour. Please wait a bit.", "invalid");
    }
    const results: InviteResult[] = [];
    for (const email of emails) {
      try {
        const existingAccount = await userExists(email);
        const res = await createInvitation({
          workspaceId: data.workspaceId,
          email,
          roleKey: data.roleKey,
          projectIds: data.projectIds,
          makeInstanceAdmin: data.makeInstanceAdmin,
          message: data.message || null,
          invitedBy: { id: ctx.user.id, email: ctx.user.email, name: ctx.user.name },
        });
        results.push({
          email,
          ok: true,
          url: existingAccount ? undefined : res.url,
          existingAccount,
          transport: res.delivery.transport,
          delivered: res.delivery.delivered,
        });
      } catch (err) {
        results.push({ email, ok: false, error: err instanceof Error ? err.message : "Could not invite" });
      }
    }
    refresh();
    return results;
  });
}

async function guarded<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof MemberError) throw new ActionError(err.message, "invalid");
    throw err;
  }
}

export async function resendInvitationAction(id: string) {
  return runAction(async () => {
    const ctx = await actionAdmin();
    if (!rateLimit(`admin-invite-resend:${ctx.user.id}`, 60, 60 * 60_000)) throw new ActionError("Too many resends. Please wait a bit.", "invalid");
    const res = await guarded(() => reissueInvitation(z.string().min(3).parse(id), ctx.user, { send: true }));
    refresh();
    return { transport: res.transport, delivered: res.delivered };
  });
}

export async function regenerateInvitationLinkAction(id: string) {
  return runAction(async () => {
    const ctx = await actionAdmin();
    const res = await guarded(() => reissueInvitation(z.string().min(3).parse(id), ctx.user, { send: false, linkForAdmin: true }));
    refresh();
    if (!res.url) throw new ActionError("No shareable link for existing accounts.", "invalid");
    return { url: res.url };
  });
}

export async function revokeInvitationAction(id: string) {
  return runAction(async () => {
    const ctx = await actionAdmin();
    await guarded(() => revokeInvitation(z.string().min(3).parse(id), ctx.user));
    refresh();
    return true;
  });
}
