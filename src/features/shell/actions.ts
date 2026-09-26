"use server";

import { and, desc, eq, or } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/server/db/client";
import { bookmarks, feedback, notifications, users } from "@/server/db/schema";
import { actionUser, runAction } from "@/server/auth/guards";
import { destroyCurrentSession } from "@/server/auth/session";
import { getProjectContext } from "@/server/auth/context";
import { safeNext } from "@/server/auth/login";

export async function logoutAction() {
  await destroyCurrentSession();
  redirect("/login");
}

export async function listBookmarksAction(projectId: string | null) {
  return runAction(async () => {
    const ctx = await actionUser();
    const rows = await db
      .select()
      .from(bookmarks)
      .where(
        projectId
          ? and(eq(bookmarks.projectId, projectId), or(eq(bookmarks.userId, ctx.user.id), eq(bookmarks.shared, true)))
          : eq(bookmarks.userId, ctx.user.id),
      )
      .orderBy(desc(bookmarks.createdAt))
      .limit(100);
    if (projectId && !(await getProjectContext(projectId))) return [];
    return rows.map((r) => ({ ...r, own: r.userId === ctx.user.id }));
  });
}

const bookmarkInput = z.object({
  name: z.string().trim().min(1).max(120),
  path: z
    .string()
    .max(2000)
    .refine((p) => safeNext(p) === p || safeNext(p) !== null, "Invalid path")
    .transform((p) => safeNext(p) ?? "/"),
  projectId: z.string().nullable(),
  shared: z.boolean().default(false),
});

export async function saveBookmarkAction(input: z.input<typeof bookmarkInput>) {
  return runAction(async () => {
    const ctx = await actionUser();
    const data = bookmarkInput.parse(input);
    if (data.projectId && !(await getProjectContext(data.projectId))) throw new Error("Project not found");
    const [row] = await db
      .insert(bookmarks)
      .values({ ...data, userId: ctx.user.id })
      .returning();
    return row!;
  });
}

export async function deleteBookmarkAction(id: string) {
  return runAction(async () => {
    const ctx = await actionUser();
    await db.delete(bookmarks).where(and(eq(bookmarks.id, id), eq(bookmarks.userId, ctx.user.id)));
    return true;
  });
}

export async function sendFeedbackAction(input: { message: string; kind: string; path: string; projectId: string | null }) {
  return runAction(async () => {
    const ctx = await actionUser();
    const message = z.string().trim().min(3).max(5000).parse(input.message);
    await db.insert(feedback).values({
      userId: ctx.user.id,
      message,
      kind: z.enum(["feedback", "bug", "idea"]).catch("feedback").parse(input.kind),
      path: (safeNext(input.path) ?? "/").slice(0, 500),
      projectId: input.projectId,
    });
    return true;
  });
}

export async function listNotificationsAction() {
  return runAction(async () => {
    const ctx = await actionUser();
    return db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, ctx.user.id))
      .orderBy(desc(notifications.createdAt))
      .limit(30);
  });
}

export async function markNotificationsReadAction() {
  return runAction(async () => {
    const ctx = await actionUser();
    await db.update(notifications).set({ readAt: new Date() }).where(eq(notifications.userId, ctx.user.id));
    return true;
  });
}

export async function setLocaleAction(locale: "en" | "de") {
  return runAction(async () => {
    const ctx = await actionUser();
    await db.update(users).set({ locale }).where(eq(users.id, ctx.user.id));
    return true;
  });
}
