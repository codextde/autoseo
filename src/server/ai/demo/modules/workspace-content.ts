import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { optimizeRuns, optimizeTasks, reports, users, workspaceMembers } from "@/server/db/schema";
import { getBrandKit } from "@/server/reports/brand";
import { buildLibraryDeck } from "@/features/reports/lib/templates/library";
import { brandDots, themeFromBrandKit } from "@/features/reports/lib/theme";
import { countDeck } from "@/features/reports/lib/types";
import { generateTasks } from "@/server/optimize/tasks/generator";
import { assignTasks, setTaskStatus } from "@/server/optimize/tasks/service";
import type { DemoModule, DemoModuleCtx, DemoPostStep } from "./context";

/**
 * Workspace content for the demo project: report decks (reports module) and optimization tasks
 * (optimize module). Both are created through the modules' own services after the demo data is
 * committed, so they reflect the generated signals exactly like a real project. `clear` removes the
 * previous demo reports/tasks inside the regeneration transaction.
 */

async function clear(ctx: DemoModuleCtx) {
  const { tx, projectId } = ctx;
  await tx.delete(reports).where(eq(reports.projectId, projectId));
  // Task activity cascades with the tasks.
  await tx.delete(optimizeTasks).where(eq(optimizeTasks.projectId, projectId));
  await tx.delete(optimizeRuns).where(and(eq(optimizeRuns.projectId, projectId), eq(optimizeRuns.kind, "tasks")));
}

async function insert(): Promise<Record<string, number>> {
  return {};
}

/** Creator for service calls that need a user: the demo creator, else the workspace owner / first member. */
async function resolveActor(workspaceId: string, userId: string | null): Promise<string | null> {
  if (userId) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
    if (u) return u.id;
  }
  const members = await db
    .select({ userId: workspaceMembers.userId, roleKey: workspaceMembers.roleKey })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(workspaceMembers.createdAt));
  return (members.find((m) => m.roleKey === "owner") ?? members[0])?.userId ?? null;
}

function monthLabel(now: Date): string {
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return prev.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

type DeckSpec = { template: "pitch" | "monthly"; title: string; subtitle: string; preset: string; publish: boolean };

/**
 * Creates a library deck through the reports module's own service (`createDeckReport` + `setPublished`).
 * That service can only be loaded inside the Next.js runtime (it imports the auth guards); the dev CLI
 * falls back to the same insert built from the reports library (template, brand-kit theme, deck meta).
 */
async function createDeck(spec: DeckSpec, info: { projectId: string; workspaceId: string; actor: string }) {
  let service: typeof import("@/server/reports/service") | null = null;
  try {
    service = await import("@/server/reports/service");
  } catch {
    service = null;
  }
  if (service) {
    const row = await service.createDeckReport({
      projectId: info.projectId,
      workspaceId: info.workspaceId,
      userId: info.actor,
      title: spec.title,
      subtitle: spec.subtitle,
      template: spec.template,
      dateRange: { preset: spec.preset },
    });
    if (spec.publish) await service.setPublished(info.projectId, row.id, true, info.actor);
    return;
  }
  const kit = await getBrandKit(info.workspaceId, info.projectId);
  const deck = buildLibraryDeck(spec.template, themeFromBrandKit(kit.effective));
  const { slides, charts } = countDeck(deck);
  await db.insert(reports).values({
    projectId: info.projectId,
    workspaceId: info.workspaceId,
    kind: "deck",
    title: spec.title,
    subtitle: spec.subtitle,
    templateKey: spec.template,
    document: deck as unknown as Record<string, unknown>,
    dateRange: { preset: spec.preset },
    slideCount: slides,
    chartCount: charts,
    brandColors: brandDots(deck.theme),
    status: spec.publish ? "published" : "draft",
    publishedAt: spec.publish ? new Date() : null,
    createdBy: info.actor,
    updatedBy: info.actor,
    createdByLabel: "AutoSEO app",
  });
}

export const postSteps: DemoPostStep[] = [
  {
    /** Runs the real task generator over the demo signals (templated texts — the optional AI rewrite is a job, skipped for demo projects). */
    name: "tasks",
    run: async ({ projectId, workspaceId, userId }) => {
      const stats = await generateTasks(projectId, "manual");
      const actor = await resolveActor(workspaceId, userId);
      // Setup gaps (e.g. "Resume AI tracking" — demo tracking is paused on purpose) don't apply to a demo.
      let dismissed = 0;
      if (actor) {
        const setup = await db
          .select({ id: optimizeTasks.id })
          .from(optimizeTasks)
          .where(and(eq(optimizeTasks.projectId, projectId), eq(optimizeTasks.signal, "setup_gap")));
        if (setup.length) dismissed = (await setTaskStatus(projectId, setup.map((t) => t.id), "dismissed", actor)).length;
      }
      // Deterministic progress mix: highest-priority tasks are being worked on / already done.
      const rows = await db
        .select({ id: optimizeTasks.id, fingerprint: optimizeTasks.fingerprint })
        .from(optimizeTasks)
        .where(and(eq(optimizeTasks.projectId, projectId), eq(optimizeTasks.status, "open")))
        .orderBy(desc(optimizeTasks.priority), asc(optimizeTasks.fingerprint));
      let inProgress = 0;
      let done = 0;
      if (actor && rows.length >= 6) {
        const progressIds = [rows[0]!.id, rows[3]!.id];
        const doneIds = [rows[1]!.id, rows[5]!.id];
        inProgress = (await setTaskStatus(projectId, progressIds, "in_progress", actor)).length;
        done = (await setTaskStatus(projectId, doneIds, "done", actor)).length;
        // Only works when the actor can access the project (always true for admins/owners).
        await assignTasks(projectId, [...progressIds, rows[2]!.id], actor, actor).catch(() => undefined);
      }
      const all = await db.select({ id: optimizeTasks.id }).from(optimizeTasks).where(eq(optimizeTasks.projectId, projectId));
      return { tasks: all.length, created: stats.created, inProgress, done, dismissed };
    },
  },
  {
    /** One Pitch deck (published) and one Monthly Report (draft) from the reports library. */
    name: "reports",
    run: async ({ projectId, workspaceId, userId, now }) => {
      const actor = await resolveActor(workspaceId, userId);
      if (!actor) return { reports: 0 };
      const existing = await db
        .select({ templateKey: reports.templateKey })
        .from(reports)
        .where(and(eq(reports.projectId, projectId), inArray(reports.templateKey, ["pitch", "monthly"])));
      const have = new Set(existing.map((r) => r.templateKey));
      let created = 0;
      const specs: DeckSpec[] = [
        {
          template: "pitch",
          title: "Stridewell × AI Search",
          subtitle: "How AI assistants see Stridewell — visibility, competitor gap and the 90-day plan",
          preset: "90d",
          publish: true,
        },
        {
          template: "monthly",
          title: `Monthly AI Visibility Report — ${monthLabel(now)}`,
          subtitle: "KPIs, trends, competitors and next steps",
          preset: "30d",
          publish: false,
        },
      ];
      for (const spec of specs) {
        if (have.has(spec.template)) continue;
        await createDeck(spec, { projectId, workspaceId, actor });
        created++;
      }
      return { reports: created };
    },
  },
];

export default { name: "workspace-content", clear, insert } satisfies DemoModule;
