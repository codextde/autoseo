import "server-only";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "@/server/db/client";
import { env } from "@/server/env";
import { getMasterKey } from "@/server/crypto";
import { startReconciler } from "@/server/reconciler";

declare global {
  var __cloudBooted: Promise<void> | undefined;
}

async function waitForDatabase(maxAttempts = 30) {
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      await db.execute(sql`select 1`);
      return;
    } catch (err) {
      if (i === maxAttempts) throw err;
      console.info(`[boot] waiting for database (${i}/${maxAttempts})…`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function boot() {
  console.info(`[boot] AutoSEO Cloud starting — ${env.appUrl}`);
  if (!env.adminEmails.length) console.warn("[boot] ADMIN_EMAILS is empty — nobody can open /admin.");
  fs.mkdirSync(env.dataDir, { recursive: true });
  getMasterKey();
  await waitForDatabase();
  // Development syncs the schema with `pnpm db:push`; production applies the SQL migrations in ./drizzle.
  const migrationsFolder = path.join(process.cwd(), "drizzle");
  if (env.isProduction || process.env.CLOUD_MIGRATE === "1") {
    if (fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
      await migrate(db, { migrationsFolder });
      console.info("[boot] database migrations applied");
    } else {
      console.warn("[boot] no migrations found in", migrationsFolder);
    }
  }
  startReconciler();
}

/** Idempotent boot: wait for the database, migrate, start the reconciler. */
export function ensureBooted(): Promise<void> {
  globalThis.__cloudBooted ??= boot().catch((err) => {
    console.error("[boot] failed", err);
    globalThis.__cloudBooted = undefined;
    throw err;
  });
  return globalThis.__cloudBooted;
}
