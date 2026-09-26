import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { getAccessibleProjects, getUserContext } from "@/server/auth/context";
import { getBranding } from "@/server/branding";
import { countOpenTasks } from "@/server/optimize/counts";
import type { ShellData } from "@/components/app/shell-context";

export async function getShellData(currentProjectId: string | null): Promise<ShellData | null> {
  const ctx = await getUserContext();
  if (!ctx) return null;
  const [projects, branding] = await Promise.all([getAccessibleProjects(), getBranding()]);
  const current = projects.find((p) => p.id === currentProjectId) ?? null;
  const membership =
    ctx.memberships.find((m) => m.workspace.id === current?.workspaceId) ?? ctx.memberships[0] ?? null;

  if (current && ctx.user.lastProjectId !== current.id) {
    await db.update(users).set({ lastProjectId: current.id }).where(eq(users.id, ctx.user.id));
  }

  return {
    user: {
      id: ctx.user.id,
      name: ctx.user.name,
      email: ctx.user.email,
      avatarUrl: ctx.user.avatarUrl,
      isInstanceAdmin: ctx.isInstanceAdmin,
    },
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      domain: p.domain,
      logoUrl: p.logoUrl,
      workspaceId: p.workspaceId,
      isPitch: p.isPitch,
    })),
    currentProjectId: current?.id ?? null,
    permissions: membership ? [...membership.permissions] : [],
    workspace: membership ? { id: membership.workspace.id, name: membership.workspace.name } : null,
    branding: {
      appName: branding.appName,
      logoUrl: branding.logoUrl,
      docsUrl: branding.docsUrl,
      demoBookingUrl: branding.demoBookingUrl,
      showProductTour: branding.showProductTour,
    },
    openTaskCount: current ? await countOpenTasks(current.id).catch(() => 0) : 0,
  };
}
