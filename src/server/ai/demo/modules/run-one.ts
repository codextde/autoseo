/**
 * Dev runner for a single demo module against an existing demo project (clear + insert in one
 * transaction, then its post-commit steps):
 *
 *   pnpm tsx --conditions=react-server src/server/ai/demo/modules/run-one.ts <module> <projectId>
 *
 * <module> is a file name in this folder (e.g. "analytics"); it must `export default` a DemoModule and
 * may export `postSteps: DemoPostStep[]`. Refuses non-demo projects and production.
 */
import "server-only";
import { asc, eq } from "drizzle-orm";
import { db, rawSql } from "@/server/db/client";
import { competitors, projects, prompts } from "@/server/db/schema";
import { DEMO_DEFAULT_SEED } from "../generate";
import { makeRng, type DemoModule, type DemoModuleCtx, type DemoPostStep } from "./context";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run in production.");
  const [name, projectId] = process.argv.slice(2);
  if (!name || !projectId || !/^[a-z-]+$/.test(name)) throw new Error("Usage: run-one.ts <module> <projectId>");
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new Error("Project not found");
  const settings = (project.settings ?? {}) as Record<string, unknown>;
  if (settings.demo !== true) throw new Error("Not a demo project");
  const mod = (await import(`./${name}`)) as { default: DemoModule; postSteps?: DemoPostStep[] };
  const seed = typeof settings.demoSeed === "string" ? settings.demoSeed : DEMO_DEFAULT_SEED;
  const days = typeof settings.demoDays === "number" ? settings.demoDays : 90;
  const now = new Date();
  const [cmp, prm] = await Promise.all([
    db.select({ id: competitors.id, name: competitors.name, domain: competitors.domain }).from(competitors).where(eq(competitors.projectId, projectId)).orderBy(asc(competitors.createdAt)),
    db
      .select({ id: prompts.id, text: prompts.text, topic: prompts.topic, funnelStage: prompts.funnelStage })
      .from(prompts)
      .where(eq(prompts.projectId, projectId)),
  ]);
  const t0 = Date.now();
  const stats = await db.transaction(async (tx) => {
    const ctx: DemoModuleCtx = {
      tx,
      projectId,
      workspaceId: project.workspaceId,
      userId: project.createdBy,
      seed,
      days,
      now,
      brandName: project.name.replace(/^Demo · /, ""),
      domain: project.domain,
      country: project.country,
      language: project.language,
      competitors: cmp,
      prompts: prm,
      rng: makeRng(seed),
    };
    await mod.default.clear(ctx);
    return mod.default.insert(ctx);
  });
  const post: Record<string, unknown> = {};
  for (const step of mod.postSteps ?? []) {
    post[step.name] = await step.run({ projectId, workspaceId: project.workspaceId, userId: project.createdBy, seed, now });
  }
  console.log(JSON.stringify({ module: mod.default.name, stats, post, ms: Date.now() - t0 }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await rawSql.end({ timeout: 5 });
  });
