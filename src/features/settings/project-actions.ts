"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { ActionError, runAction } from "@/server/auth/guards";
import { actionManageProject } from "@/server/admin/access";
import {
  deleteProject,
  ProjectAdminError,
  setProjectArchived,
  setProjectPitch,
  updateProject,
  type ProjectPatch,
} from "@/server/admin/projects";
import { saveImageUpload, UploadError } from "@/server/admin/uploads";

const TRACKING_KEYS = new Set(["engines", "trackingFrequency"]);

function wrap(err: unknown): never {
  if (err instanceof ProjectAdminError || err instanceof UploadError) throw new ActionError(err.message, "invalid");
  throw err;
}

/** Updates general / brand / tracking fields of a project. */
export async function updateProjectSettingsAction(projectId: string, patch: ProjectPatch) {
  return runAction(async () => {
    const id = z.string().min(1).parse(projectId);
    const data = z.record(z.string(), z.unknown()).parse(patch) as ProjectPatch;
    const trackingOnly = Object.keys(data).length > 0 && Object.keys(data).every((k) => TRACKING_KEYS.has(k));
    const access = await actionManageProject(id, "project.view");
    const allowed = access.can("projects.manage") || (trackingOnly && access.can("settings.manage"));
    if (!allowed) throw new ActionError("You don't have permission to change this project's settings.", "forbidden");
    try {
      const p = await updateProject(id, data, { id: access.ctx.user.id, email: access.ctx.user.email });
      refresh();
      return { id: p.id, name: p.name, domain: p.domain, logoUrl: p.logoUrl };
    } catch (err) {
      wrap(err);
    }
  });
}

/** Uploads a project logo (PNG/JPG/WebP/GIF/SVG, max 2 MB) and stores it on the project. */
export async function uploadProjectLogoAction(projectId: string, formData: FormData) {
  return runAction(async () => {
    const access = await actionManageProject(z.string().min(1).parse(projectId), "projects.manage");
    const file = formData.get("file");
    if (!(file instanceof File)) throw new ActionError("No file received.", "invalid");
    try {
      const res = await saveImageUpload("logos", file, { maxBytes: 2 * 1024 * 1024, allowSvg: true });
      await updateProject(access.project.id, { logoUrl: res.url }, { id: access.ctx.user.id, email: access.ctx.user.email }, { uploadedLogoUrl: res.url });
      refresh();
      return { url: res.url };
    } catch (err) {
      wrap(err);
    }
  });
}

export async function setProjectArchivedAction(projectId: string, archived: boolean) {
  return runAction(async () => {
    const access = await actionManageProject(z.string().min(1).parse(projectId), "projects.manage");
    await setProjectArchived(access.project.id, z.boolean().parse(archived), { id: access.ctx.user.id, email: access.ctx.user.email });
    refresh();
    return true;
  });
}

/** Permanently deletes a project. The caller must type the project's domain to confirm. */
export async function deleteProjectAction(projectId: string, confirmation: string) {
  return runAction(async () => {
    const access = await actionManageProject(z.string().min(1).parse(projectId), "projects.manage");
    if (z.string().trim().toLowerCase().parse(confirmation) !== access.project.domain.toLowerCase()) {
      throw new ActionError("Type the project's domain to confirm.", "invalid");
    }
    await deleteProject(access.project.id, { id: access.ctx.user.id, email: access.ctx.user.email });
    return true;
  });
}

const pitchInput = z.object({ isPitch: z.boolean(), days: z.number().int().min(1).max(365).optional() });

/** Converts a pitch project to a regular one, or (re)sets it as pitch expiring after `days`. */
export async function setProjectPitchAction(projectId: string, input: z.input<typeof pitchInput>) {
  return runAction(async () => {
    const access = await actionManageProject(z.string().min(1).parse(projectId), "projects.manage");
    const data = pitchInput.parse(input);
    const expiresAt = await setProjectPitch(access.project.id, { isPitch: data.isPitch, days: data.days }, {
      id: access.ctx.user.id,
      email: access.ctx.user.email,
    });
    refresh();
    return { expiresAt: expiresAt?.toISOString() ?? null };
  });
}
