"use server";

import { z } from "zod";
import { ActionError, actionUser, runAction } from "@/server/auth/guards";
import { getAccessibleProjects } from "@/server/auth/context";
import { logAudit } from "@/server/audit";
import {
  AUTHORIZE_PARAM_KEYS,
  approveAuthorization,
  denyAuthorization,
  pickAuthorizeParams,
  validateAuthorizeRequest,
} from "@/server/api/oauth/authorize";
import { API_SCOPES } from "./scopes";
import { API_CREDENTIALS_PERMISSION } from "@/server/api/auth";

const paramsSchema = z.object(Object.fromEntries(AUTHORIZE_PARAM_KEYS.map((k) => [k, z.string().max(4096).optional()])));

const approveSchema = z.object({
  params: paramsSchema,
  workspaceId: z.string().min(1).max(64),
  projectIds: z.array(z.string().max(64)).max(500).nullable(),
  scopes: z.array(z.enum(API_SCOPES)).max(API_SCOPES.length),
});

/** Consent approved: records the grant and returns the client redirect URL (with the code). */
export async function approveOAuthAction(input: z.input<typeof approveSchema>) {
  return runAction(async () => {
    const ctx = await actionUser();
    const data = approveSchema.parse(input);
    const v = await validateAuthorizeRequest(pickAuthorizeParams(data.params));
    if (!v.ok) {
      if (v.fatal) throw new ActionError(v.description, "invalid");
      return { redirectTo: v.redirectTo };
    }
    const membership = ctx.memberships.find((m) => m.workspace.id === data.workspaceId);
    if (!membership) throw new ActionError("You are not a member of this workspace.", "forbidden");
    if (!membership.permissions.has(API_CREDENTIALS_PERMISSION)) {
      throw new ActionError("Connecting apps requires the “Integrations, API keys” permission in this workspace.", "forbidden");
    }
    let projectIds: string[] | null = null;
    if (data.projectIds) {
      if (data.projectIds.length === 0) throw new ActionError("Select at least one project or choose all projects.", "invalid");
      const accessible = new Set(
        (await getAccessibleProjects()).filter((p) => p.workspaceId === data.workspaceId).map((p) => p.id),
      );
      const bad = data.projectIds.filter((id) => !accessible.has(id));
      if (bad.length) throw new ActionError("You don't have access to one of the selected projects.", "forbidden");
      projectIds = [...new Set(data.projectIds)];
    }
    const redirectTo = await approveAuthorization({
      request: v.request,
      userId: ctx.user.id,
      workspaceId: data.workspaceId,
      scopes: data.scopes,
      projectIds,
    });
    void logAudit("oauth.authorized", {
      actor: { id: ctx.user.id, email: ctx.user.email },
      targetType: "oauth_client",
      targetId: v.request.client.id,
      workspaceId: data.workspaceId,
      meta: { client: v.request.client.name, scopes: data.scopes, projectIds },
    });
    return { redirectTo };
  });
}

/** Consent denied: returns the client redirect URL with error=access_denied. */
export async function denyOAuthAction(input: { params: Record<string, string | undefined> }) {
  return runAction(async () => {
    await actionUser();
    const params = paramsSchema.parse(input.params);
    const v = await validateAuthorizeRequest(pickAuthorizeParams(params));
    if (!v.ok) {
      if (v.fatal) throw new ActionError(v.description, "invalid");
      return { redirectTo: v.redirectTo };
    }
    return { redirectTo: denyAuthorization(v.request) };
  });
}
