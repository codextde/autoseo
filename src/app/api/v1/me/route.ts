import { accessibleProjects, credentialKindLabel } from "@/server/api/auth";
import { apiRoute } from "@/server/api/handler";
import { corsPreflight } from "@/server/api/urls";

/** GET /api/v1/me — the authenticated user, workspace and credential. */
export const GET = apiRoute({ scope: "read" }, async ({ principal: p }) => {
  const projects = await accessibleProjects(p);
  return {
    data: {
      user: p.user,
      workspace: p.workspace,
      role: p.roleKey,
      credential: { id: p.credentialId, kind: credentialKindLabel(p), name: p.name, clientId: p.clientId },
      scopes: [...p.scopes],
      projectAccess: p.restrictedProjectIds ? { type: "selected", projectIds: p.restrictedProjectIds } : { type: "all" },
      projects: projects.map((x) => ({ id: x.id, name: x.name, domain: x.domain })),
    },
  };
});

export const OPTIONS = corsPreflight;
