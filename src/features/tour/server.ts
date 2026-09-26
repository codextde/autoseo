import "server-only";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { DEFAULT_TOUR_STATE, TOUR_STEPS, type TourState } from "./steps";

const STEP_IDS = new Set(TOUR_STEPS.map((s) => s.id));

export const tourStateSchema = z.object({
  track: z.enum(["business", "agency"]).catch("business"),
  active: z.boolean().catch(false),
  stepIndex: z.number().int().min(0).max(500).catch(0),
  completed: z
    .array(z.string().max(64))
    .max(200)
    .catch([])
    .transform((ids) => [...new Set(ids.filter((id) => STEP_IDS.has(id)))]),
  projectId: z.string().max(64).regex(/^[a-z]+_[a-z0-9]+$/).nullable().optional().catch(null),
  updatedAt: z.string().max(40).optional().catch(undefined),
});

/** Reads the tour state from `users.preferences.tour` (tolerant to missing/invalid data). */
export function readTourState(preferences: Record<string, unknown> | null | undefined): TourState {
  const raw = preferences?.tour;
  if (!raw || typeof raw !== "object") return { ...DEFAULT_TOUR_STATE };
  const parsed = tourStateSchema.safeParse(raw);
  return parsed.success ? parsed.data : { ...DEFAULT_TOUR_STATE };
}

/** Writes the tour state into `users.preferences.tour` without touching other preferences. */
export async function writeTourState(userId: string, state: TourState): Promise<TourState> {
  const next = tourStateSchema.parse({ ...state, updatedAt: new Date().toISOString() });
  await db
    .update(users)
    .set({ preferences: sql`coalesce(${users.preferences}, '{}'::jsonb) || jsonb_build_object('tour', ${JSON.stringify(next)}::jsonb)` })
    .where(eq(users.id, userId));
  return next;
}
