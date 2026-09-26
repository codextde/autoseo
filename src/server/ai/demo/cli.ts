/**
 * Dev runner for the demo data generator.
 *
 *   pnpm tsx --conditions=react-server src/server/ai/demo/cli.ts <workspaceId> [userId] [--seed=<seed>] [--days=<n>]
 *   pnpm tsx --conditions=react-server src/server/ai/demo/cli.ts --regenerate=<projectId> [--seed=<seed>] [--days=<n>]
 *
 * `--conditions=react-server` makes the `server-only` marker package resolve to its empty build.
 * When userId is omitted the first instance admin is used as creator. Refuses to run in production.
 */
import "server-only";
import { asc, eq } from "drizzle-orm";
import { db, rawSql } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { createDemoProject, regenerateDemoProject } from "./generate";

async function main() {
  if (process.env.NODE_ENV === "production" && !process.argv.includes("--force")) {
    console.error("Refusing to run the demo generator CLI in production (pass --force to override).");
    process.exit(1);
  }
  const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const flag = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const regenerate = flag("regenerate");
  if (regenerate) {
    const days = flag("days");
    console.log(JSON.stringify(await regenerateDemoProject(regenerate, { seed: flag("seed"), days: days ? Number(days) : undefined }), null, 2));
    return;
  }
  const [workspaceId, userArg] = positional;
  if (!workspaceId) {
    console.error("Usage: pnpm tsx --conditions=react-server src/server/ai/demo/cli.ts <workspaceId> [userId] [--seed=…] [--days=…]");
    process.exit(1);
  }
  let userId = userArg ?? null;
  if (!userId) {
    const [admin] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.isInstanceAdmin, true))
      .orderBy(asc(users.createdAt))
      .limit(1);
    userId = admin?.id ?? null;
  }
  const days = flag("days");
  const result = await createDemoProject(workspaceId, userId, { seed: flag("seed"), days: days ? Number(days) : undefined });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await rawSql.end({ timeout: 5 });
  });
