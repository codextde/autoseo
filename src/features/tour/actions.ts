"use server";

import { actionUser, runAction } from "@/server/auth/guards";
import { getProjectContext } from "@/server/auth/context";
import { getBranding } from "@/server/branding";
import { readTourState, tourStateSchema, writeTourState } from "./server";
import type { TourState } from "./steps";

/** Current user's tour progress + whether the tour is enabled (Admin → Branding). */
export async function getTourStateAction() {
  return runAction(async () => {
    const ctx = await actionUser();
    const branding = await getBranding();
    return { enabled: branding.showProductTour, state: readTourState(ctx.user.preferences) };
  });
}

export async function saveTourStateAction(input: TourState) {
  return runAction(async () => {
    const ctx = await actionUser();
    const state = tourStateSchema.parse(input);
    if (state.projectId && !(await getProjectContext(state.projectId))) state.projectId = null;
    return writeTourState(ctx.user.id, state);
  });
}
