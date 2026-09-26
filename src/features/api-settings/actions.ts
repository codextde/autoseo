"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, actionUser, runAction } from "@/server/auth/guards";
import { getAccessibleProjects, type UserContext } from "@/server/auth/context";
import { logAudit } from "@/server/audit";
import { createApiKey, revokeApiKey, revokeOAuthGrant } from "@/server/api/keys";
import { API_SCOPES } from "./scopes";

async function settingsMembership(ctx: UserContext, workspaceId: string) {
  const m = ctx.memberships.find((x) => x.workspace.id === workspaceId);
  if (!m) throw new ActionError("Workspace not found.", "not_found");
  if (!m.permissions.has("settings.manage")) throw new ActionError("Managing API keys requires the “Integrations, API keys” permission.", "forbidden");
  return m;
}

const createSchema = z.object({
  workspaceId: z.string().min(1).max(64),
  name: z.string().trim().min(1, "Name is required").max(80),
  scopes: z.array(z.enum(API_SCOPES)).max(API_SCOPES.length),
  projectIds: z.array(z.string().max(64)).max(500).nullable(),
});

/** Creates an API key and returns the plaintext token (shown once). */
export async function createApiKeyAction(input: z.input<typeof createSchema>) {
  return runAction(async () => {
    const ctx = await actionUser();
    const data = createSchema.parse(input);
    await settingsMembership(ctx, data.workspaceId);
    let projectIds: string[] | null = null;
    if (data.projectIds) {
      if (!data.projectIds.length) throw new ActionError("Select at least one project or choose all projects.", "invalid");
      const accessible = new Set((await getAccessibleProjects()).filter((p) => p.workspaceId === data.workspaceId).map((p) => p.id));
      if (data.projectIds.some((id) => !accessible.has(id))) throw new ActionError("You don't have access to one of the selected projects.", "forbidden");
      projectIds = [...new Set(data.projectIds)];
    }
    const { key, token } = await createApiKey({
      workspaceId: data.workspaceId,
      userId: ctx.user.id,
      name: data.name,
      scopes: data.scopes,
      projectIds,
    });
    void logAudit("api_key.created", {
      actor: { id: ctx.user.id, email: ctx.user.email },
      targetType: "api_key",
      targetId: key.id,
      workspaceId: data.workspaceId,
      meta: { name: key.name, scopes: key.scopes, projectIds },
    });
    revalidatePath("/settings/api");
    return { id: key.id, token, prefix: key.prefix, name: key.name };
  });
}

const revokeSchema = z.object({ workspaceId: z.string().min(1).max(64), keyId: z.string().min(1).max(64) });

export async function revokeApiKeyAction(input: z.input<typeof revokeSchema>) {
  return runAction(async () => {
    const ctx = await actionUser();
    const data = revokeSchema.parse(input);
    await settingsMembership(ctx, data.workspaceId);
    const row = await revokeApiKey(data.workspaceId, data.keyId);
    if (!row) throw new ActionError("API key not found.", "not_found");
    void logAudit("api_key.revoked", {
      actor: { id: ctx.user.id, email: ctx.user.email },
      targetType: "api_key",
      targetId: row.id,
      workspaceId: data.workspaceId,
      meta: { name: row.name },
    });
    revalidatePath("/settings/api");
    return { id: row.id };
  });
}

const revokeGrantSchema = z.object({ workspaceId: z.string().min(1).max(64), grantId: z.string().min(1).max(64) });

/** Disconnects an OAuth app. Members can disconnect their own apps; admins any app in the workspace. */
export async function revokeOAuthGrantAction(input: z.input<typeof revokeGrantSchema>) {
  return runAction(async () => {
    const ctx = await actionUser();
    const data = revokeGrantSchema.parse(input);
    const m = ctx.memberships.find((x) => x.workspace.id === data.workspaceId);
    if (!m) throw new ActionError("Workspace not found.", "not_found");
    const canManage = m.permissions.has("settings.manage");
    const grant = await revokeOAuthGrant(data.grantId, { workspaceId: data.workspaceId, userId: canManage ? undefined : ctx.user.id });
    if (!grant) throw new ActionError("Connected app not found.", "not_found");
    void logAudit("oauth.revoked", {
      actor: { id: ctx.user.id, email: ctx.user.email },
      targetType: "oauth_grant",
      targetId: grant.id,
      workspaceId: data.workspaceId,
      meta: { clientId: grant.clientId, userId: grant.userId },
    });
    revalidatePath("/settings/api");
    return { id: grant.id };
  });
}
