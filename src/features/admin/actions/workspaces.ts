"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { actionAdmin, ActionError, runAction } from "@/server/auth/guards";
import { MemberError } from "@/server/admin/members";
import { createWorkspaceAdmin, deleteWorkspaceAdmin, renameWorkspace } from "@/server/admin/workspaces";
import { deleteProject, getProject, moveProject, ProjectAdminError, setProjectArchived, setProjectPitch } from "@/server/admin/projects";

const id = z.string().min(3).max(64);

async function guarded<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof MemberError || err instanceof ProjectAdminError) throw new ActionError(err.message, "invalid");
    throw err;
  }
}

export async function createWorkspaceAction(name: string, ownerUserId?: string | null) {
  return runAction(async () => {
    const ctx = await actionAdmin();
    const ws = await guarded(() =>
      createWorkspaceAdmin(z.string().trim().min(1).max(80).parse(name), ownerUserId ? id.parse(ownerUserId) : ctx.user.id, ctx.user),
    );
    refresh();
    return { id: ws.id };
  });
}

export async function renameWorkspaceAction(workspaceId: string, name: string) {
  return runAction(async () => {
    const ctx = await actionAdmin();
    await guarded(() => renameWorkspace(id.parse(workspaceId), z.string().trim().min(1).max(80).parse(name), ctx.user));
    refresh();
    return true;
  });
}

export async function deleteWorkspaceAction(workspaceId: string, confirmName: string) {
  return runAction(async () => {
    const ctx = await actionAdmin();
    await guarded(() => deleteWorkspaceAdmin(id.parse(workspaceId), z.string().max(200).parse(confirmName), ctx.user));
    refresh();
    return true;
  });
}

export async function moveProjectAction(projectId: string, workspaceId: string) {
  return runAction(async () => {
    const ctx = await actionAdmin();
    await guarded(() => moveProject(id.parse(projectId), id.parse(workspaceId), ctx.user));
    refresh();
    return true;
  });
}

export async function setProjectArchivedAction(projectId: string, archived: boolean) {
  return runAction(async () => {
    const ctx = await actionAdmin();
    await guarded(() => setProjectArchived(id.parse(projectId), z.boolean().parse(archived), ctx.user));
    refresh();
    return true;
  });
}

export async function setProjectPitchAction(projectId: string, isPitch: boolean, days?: number | null) {
  return runAction(async () => {
    const ctx = await actionAdmin();
    const expires = await guarded(() =>
      setProjectPitch(id.parse(projectId), { isPitch: z.boolean().parse(isPitch), days: days == null ? null : z.number().int().min(1).max(365).parse(days) }, ctx.user),
    );
    refresh();
    return { pitchExpiresAt: expires?.toISOString() ?? null };
  });
}

export async function deleteProjectAction(projectId: string, confirmDomain: string) {
  return runAction(async () => {
    const ctx = await actionAdmin();
    const pid = id.parse(projectId);
    const project = await guarded(() => getProject(pid));
    if (confirmDomain.trim().toLowerCase() !== project.domain) throw new ActionError("Type the project's domain to confirm.", "invalid");
    await guarded(() => deleteProject(pid, ctx.user));
    refresh();
    return true;
  });
}
