import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { brandKnowledge, notifications, users, projects } from "@/server/db/schema";
import { sendMail, appUrl } from "@/server/email";
import { simpleEmail } from "@/server/email/templates";
import type { KnowledgeKind, KnowledgeState } from "@/features/ai-research/types";

export const KNOWLEDGE_LABELS: Record<KnowledgeKind, string> = {
  interest: "Interest",
  sitemap: "Sitemap",
  personas: "Personas",
  products: "Products",
  profile: "Profile",
};

type Row = typeof brandKnowledge.$inferSelect;

function toState<T>(row: Row | undefined): KnowledgeState<T> {
  if (!row) return { status: "idle", data: null, error: null, jobId: null, startedAt: null, finishedAt: null, updatedAt: null };
  const hasData = row.data && Object.keys(row.data).length > 0;
  return {
    status: row.status,
    data: hasData ? (row.data as T) : null,
    error: row.error,
    jobId: row.jobId,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt?.toISOString() ?? null,
  };
}

export async function getKnowledge<T>(projectId: string, kind: KnowledgeKind): Promise<KnowledgeState<T>> {
  const [row] = await db
    .select()
    .from(brandKnowledge)
    .where(and(eq(brandKnowledge.projectId, projectId), eq(brandKnowledge.kind, kind)))
    .limit(1);
  return toState<T>(row);
}

export async function getAllKnowledge(projectId: string): Promise<Record<KnowledgeKind, KnowledgeState<unknown>>> {
  const rows = await db.select().from(brandKnowledge).where(eq(brandKnowledge.projectId, projectId));
  const kinds: KnowledgeKind[] = ["interest", "sitemap", "personas", "products", "profile"];
  return Object.fromEntries(kinds.map((k) => [k, toState(rows.find((r) => r.kind === k))])) as Record<KnowledgeKind, KnowledgeState<unknown>>;
}

/** Marks an analysis as running (called before the job is enqueued). */
export async function markKnowledgeRunning(projectId: string, kind: KnowledgeKind, userId: string | null, jobId: string | null) {
  await db
    .insert(brandKnowledge)
    .values({ projectId, kind, status: "running", requestedBy: userId, jobId, startedAt: new Date(), error: null })
    .onConflictDoUpdate({
      target: [brandKnowledge.projectId, brandKnowledge.kind],
      set: { status: "running", requestedBy: userId, jobId, startedAt: new Date(), error: null, finishedAt: null },
    });
}

export async function setKnowledgeJob(projectId: string, kind: KnowledgeKind, jobId: string) {
  await db
    .update(brandKnowledge)
    .set({ jobId })
    .where(and(eq(brandKnowledge.projectId, projectId), eq(brandKnowledge.kind, kind)));
}

/** Stores analysis results (status ready). */
export async function saveKnowledge(projectId: string, kind: KnowledgeKind, data: Record<string, unknown>, status: "ready" | "idle" = "ready") {
  await db
    .insert(brandKnowledge)
    .values({ projectId, kind, status, data, error: null, finishedAt: new Date() })
    .onConflictDoUpdate({
      target: [brandKnowledge.projectId, brandKnowledge.kind],
      set: { status, data, error: null, finishedAt: new Date() },
    });
}

/** Updates the data blob without touching status (user edits: personas, important sections…). */
export async function patchKnowledgeData(projectId: string, kind: KnowledgeKind, data: Record<string, unknown>) {
  const [row] = await db
    .select({ status: brandKnowledge.status })
    .from(brandKnowledge)
    .where(and(eq(brandKnowledge.projectId, projectId), eq(brandKnowledge.kind, kind)))
    .limit(1);
  if (!row) {
    await db.insert(brandKnowledge).values({ projectId, kind, status: "ready", data });
    return;
  }
  await db
    .update(brandKnowledge)
    .set({ data, status: row.status === "running" ? "running" : "ready" })
    .where(and(eq(brandKnowledge.projectId, projectId), eq(brandKnowledge.kind, kind)));
}

export async function failKnowledge(projectId: string, kind: KnowledgeKind, error: string) {
  await db
    .update(brandKnowledge)
    .set({ status: "failed", error: error.slice(0, 2000), finishedAt: new Date() })
    .where(and(eq(brandKnowledge.projectId, projectId), eq(brandKnowledge.kind, kind)));
}

/**
 * Emails the requesting user and writes an in-app notification when an analysis is ready
 * (or failed). Never throws.
 */
export async function notifyKnowledge(opts: {
  projectId: string;
  userId: string | null;
  kind: KnowledgeKind;
  ok: boolean;
  summary: string;
}) {
  if (!opts.userId) return;
  try {
    const [user] = await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, opts.userId)).limit(1);
    const [project] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, opts.projectId)).limit(1);
    if (!user || !project) return;
    const label = KNOWLEDGE_LABELS[opts.kind];
    const href = `/p/${opts.projectId}/knowledge?tab=${opts.kind}`;
    const title = opts.ok ? `${label} analysis ready — ${project.name}` : `${label} analysis failed — ${project.name}`;
    await db.insert(notifications).values({
      userId: opts.userId,
      projectId: opts.projectId,
      kind: `knowledge.${opts.kind}`,
      title,
      body: opts.summary,
      href,
    });
    const mail = await simpleEmail({
      subject: title,
      heading: opts.ok ? `Your ${label.toLowerCase()} analysis is ready` : `Your ${label.toLowerCase()} analysis failed`,
      body: `${opts.summary}${opts.ok ? "\n\nThe results also appear in Prompt Research." : ""}`,
      cta: { label: "Open Brand Knowledge", url: appUrl(href) },
    });
    await sendMail({ to: user.email, ...mail });
  } catch (err) {
    console.error("[knowledge] notify failed", err);
  }
}

/** Generic in-app notification for other ai-research jobs (prompt sets, lookups). */
export async function notifyUser(opts: { userId: string | null; projectId: string; kind: string; title: string; body: string; href: string; email?: boolean }) {
  if (!opts.userId) return;
  try {
    await db.insert(notifications).values({
      userId: opts.userId,
      projectId: opts.projectId,
      kind: opts.kind,
      title: opts.title,
      body: opts.body,
      href: opts.href,
    });
    if (opts.email) {
      const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, opts.userId)).limit(1);
      if (user) {
        const mail = await simpleEmail({ subject: opts.title, heading: opts.title, body: opts.body, cta: { label: "Open", url: appUrl(opts.href) } });
        await sendMail({ to: user.email, ...mail });
      }
    }
  } catch (err) {
    console.error("[ai-research] notify failed", err);
  }
}
