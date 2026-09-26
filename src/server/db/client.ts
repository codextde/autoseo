import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/server/env";
import * as schema from "./schema";

declare global {
  var __autoseoSql: ReturnType<typeof postgres> | undefined;
}

const sql =
  globalThis.__autoseoSql ??
  postgres(env.databaseUrl, {
    max: 20,
    idle_timeout: 30,
    connect_timeout: 15,
    onnotice: () => {},
  });

if (!env.isProduction) globalThis.__autoseoSql = sql;

export const db = drizzle(sql, { schema, casing: "snake_case" });
export type DB = typeof db;
export { sql as rawSql };
