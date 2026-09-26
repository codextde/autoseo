"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { actionUser, ActionError, runAction } from "@/server/auth/guards";
import { actionWorkspace } from "@/server/admin/access";
import { rateLimit } from "@/server/rate-limit";
import { createDemoProjectWithinLimit } from "@/server/ai/demo/create";
import {
  brandInput,
  competitorsInput,
  createProjectFromWizard,
  promptsInput,
  suggestBrand,
  suggestCompetitorList,
  suggestPromptList,
  type CreateWizardInput,
} from "@/server/admin/onboarding";

/** AI suggestions cost money — only people who can create projects somewhere may request them. */
async function suggestionUser() {
  const ctx = await actionUser();
  if (!ctx.isInstanceAdmin && !ctx.memberships.some((m) => m.permissions.has("projects.manage"))) {
    throw new ActionError("You don't have permission to create projects.", "forbidden");
  }
  return ctx;
}

/** Workspace the AI work belongs to: the requested one if the user may create projects there. */
function suggestionScope(ctx: Awaited<ReturnType<typeof actionUser>>, requested?: unknown) {
  const allowed = ctx.memberships.filter((m) => m.permissions.has("projects.manage")).map((m) => m.workspace.id);
  const workspaceId = typeof requested === "string" && allowed.includes(requested) ? requested : (allowed[0] ?? null);
  return { workspaceId, userId: ctx.user.id };
}

function limitSuggestions(userId: string) {
  if (!rateLimit(`onboarding-suggest:${userId}`, 40, 60 * 60_000)) {
    throw new ActionError("Too many suggestion requests. Please wait a bit or continue manually.", "invalid");
  }
}

export async function suggestBrandAction(input: z.input<typeof brandInput>) {
  return runAction(async () => {
    const ctx = await suggestionUser();
    limitSuggestions(ctx.user.id);
    return suggestBrand(input, suggestionScope(ctx, input?.workspaceId));
  });
}

export async function suggestCompetitorsAction(input: z.input<typeof competitorsInput>) {
  return runAction(async () => {
    const ctx = await suggestionUser();
    limitSuggestions(ctx.user.id);
    return suggestCompetitorList(input, suggestionScope(ctx, input?.workspaceId));
  });
}

export async function suggestPromptsAction(input: z.input<typeof promptsInput>) {
  return runAction(async () => {
    const ctx = await suggestionUser();
    limitSuggestions(ctx.user.id);
    return suggestPromptList(input, suggestionScope(ctx, input?.workspaceId));
  });
}

/** Creates the project (requires projects.manage in the chosen workspace) and sends invitations. */
export async function createOnboardingProjectAction(input: CreateWizardInput) {
  return runAction(async () => {
    const workspaceId = z.string().min(1).parse(input?.workspaceId);
    const access = await actionWorkspace(workspaceId, "projects.manage");
    const ctx = access.ctx;
    if (!rateLimit(`onboarding-create:${ctx.user.id}`, 20, 60 * 60_000)) {
      throw new ActionError("Too many projects created in a short time. Please wait a bit.", "invalid");
    }
    try {
      return await createProjectFromWizard(
        input,
        { id: ctx.user.id, email: ctx.user.email, name: ctx.user.name },
        { canInvite: access.can("members.manage"), access },
      );
    } catch (err) {
      if (err instanceof z.ZodError) throw err;
      throw new ActionError(err instanceof Error ? err.message : "Could not create the project.", "invalid");
    }
  });
}

/** "Just looking around?" — skips the wizard and opens a demo project with generated sample data. */
export async function createOnboardingDemoAction(workspaceId: string) {
  return runAction(async () => {
    const access = await actionWorkspace(z.string().min(1).max(40).parse(workspaceId), "projects.manage");
    if (!rateLimit(`onboarding-demo:${access.ctx.user.id}`, 5, 60 * 60_000)) {
      throw new ActionError("Too many demo projects created in a short time. Please wait a bit.", "invalid");
    }
    return createDemoProjectWithinLimit(access.workspace.id, access.ctx.user);
  });
}

/** Persists the wizard language (EN/DE) as the user's locale. */
export async function setWizardLocaleAction(locale: "en" | "de") {
  return runAction(async () => {
    const ctx = await actionUser();
    const value = z.enum(["en", "de"]).parse(locale);
    await db.update(users).set({ locale: value }).where(eq(users.id, ctx.user.id));
    return value;
  });
}
