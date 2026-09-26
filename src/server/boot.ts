import "server-only";
import path from "node:path";
import fs from "node:fs";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "@/server/db/client";
import { env } from "@/server/env";
import { getMasterKey } from "@/server/crypto";
import { ensureBuiltinRoles } from "@/server/auth/membership";
import { ensureSetupCode } from "@/server/setup";
import { bootstrapOwnerFromEnv } from "@/server/bootstrap";

declare global {
  var __autoseoBooted: Promise<void> | undefined;
}

async function waitForDatabase(maxAttempts = 30) {
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      await db.execute("select 1");
      return;
    } catch (err) {
      if (i === maxAttempts) throw err;
      console.info(`[boot] waiting for database (${i}/${maxAttempts})…`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function boot() {
  console.info(`[boot] AutoSEO ${env.buildCommit} starting — ${env.appUrl}`);
  if (env.isProduction && env.isLocal) {
    console.warn(
      "[boot] ⚠ Running in production with a local domain (" +
        env.domain +
        "). Set DOMAIN=your.domain in .env so cookies are Secure and email links point to the right host.",
    );
  }
  fs.mkdirSync(env.dataDir, { recursive: true });
  getMasterKey();
  await waitForDatabase();
  const migrationsFolder = path.join(process.cwd(), "drizzle");
  // In development the schema is synced with `pnpm db:push`; production applies SQL migrations.
  const runMigrations = env.isProduction || process.env.AUTOSEO_MIGRATE === "1";
  if (!runMigrations) {
    console.info("[boot] development mode — skipping migrations (use `pnpm db:push`)");
  } else if (fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
    await migrate(db, { migrationsFolder });
    console.info("[boot] database migrations applied");
  } else {
    console.warn("[boot] no migrations found in", migrationsFolder);
  }
  await ensureBuiltinRoles();
  await bootstrapOwnerFromEnv();
  await ensureSetupCode(true);
  const { startWorker } = await import("@/server/jobs/worker");
  await startWorker();
}

/** Idempotent boot (migrations, roles, setup code, job worker). */
export function ensureBooted(): Promise<void> {
  globalThis.__autoseoBooted ??= boot().catch((err) => {
    console.error("[boot] failed", err);
    globalThis.__autoseoBooted = undefined;
    throw err;
  });
  return globalThis.__autoseoBooted;
}
