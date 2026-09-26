import "server-only";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { feedback, projects, users } from "@/server/db/schema";
import { env } from "@/server/env";
import "@/server/jobs/registry";
import { getHandlers, getSchedules } from "@/server/jobs/define";
import { Cron } from "croner";

function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "unknown";
  }
}

/** Recursive directory size with a file-count cap so huge data dirs don't block the request. */
async function dirSize(dir: string, cap = 50_000): Promise<{ bytes: number; files: number; truncated: boolean }> {
  let bytes = 0;
  let files = 0;
  let truncated = false;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (files >= cap) {
        truncated = true;
        return { bytes, files, truncated };
      }
      const p = path.join(current, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) {
        try {
          bytes += (await fsp.stat(p)).size;
          files++;
        } catch {
          /* ignore */
        }
      }
    }
  }
  return { bytes, files, truncated };
}

async function dataDirBreakdown() {
  const top: { name: string; bytes: number; files: number }[] = [];
  let entries: fs.Dirent[] = [];
  try {
    entries = await fsp.readdir(env.dataDir, { withFileTypes: true });
  } catch {
    return { exists: false, total: { bytes: 0, files: 0, truncated: false }, top };
  }
  let bytes = 0;
  let files = 0;
  let truncated = false;
  for (const e of entries) {
    const p = path.join(env.dataDir, e.name);
    if (e.isDirectory()) {
      const s = await dirSize(p);
      top.push({ name: `${e.name}/`, bytes: s.bytes, files: s.files });
      bytes += s.bytes;
      files += s.files;
      truncated ||= s.truncated;
    } else if (e.isFile()) {
      const st = await fsp.stat(p).catch(() => null);
      // Never expose the name/size of the master key file beyond "present".
      top.push({ name: e.name, bytes: st?.size ?? 0, files: 1 });
      bytes += st?.size ?? 0;
      files++;
    }
  }
  top.sort((a, b) => b.bytes - a.bytes);
  return { exists: true, total: { bytes, files, truncated }, top };
}

type JournalEntry = { idx: number; tag: string; when: number };

async function migrationStatus() {
  let journal: JournalEntry[] = [];
  try {
    const raw = await fsp.readFile(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8");
    journal = (JSON.parse(raw) as { entries?: JournalEntry[] }).entries ?? [];
  } catch {
    journal = [];
  }
  const reg = (await db.execute(sql`select to_regclass('drizzle.__drizzle_migrations')::text as t`)) as unknown as Array<{ t: string | null }>;
  let applied: { hash: string; createdAt: number }[] = [];
  if (reg[0]?.t) {
    const rows = (await db.execute(
      sql`select hash, created_at from drizzle.__drizzle_migrations order by created_at asc`,
    )) as unknown as Array<{ hash: string; created_at: string | number }>;
    applied = rows.map((r) => ({ hash: r.hash, createdAt: Number(r.created_at) }));
  }
  const lastApplied = applied.at(-1) ?? null;
  const pending = journal.filter((j) => !lastApplied || j.when > lastApplied.createdAt);
  const mode: "migrations" | "push" = applied.length > 0 || env.isProduction ? "migrations" : "push";
  return {
    mode,
    journalCount: journal.length,
    appliedCount: applied.length,
    lastAppliedAt: lastApplied ? new Date(lastApplied.createdAt).toISOString() : null,
    lastJournalTag: journal.at(-1)?.tag ?? null,
    pending: mode === "migrations" ? pending.map((p) => p.tag) : [],
  };
}

export async function getSystemInfo() {
  const [dbInfo, tables, migrations, data] = await Promise.all([
    db.execute(sql`select pg_database_size(current_database())::bigint as size, current_database() as name, version() as version, now() as now`) as unknown as Promise<
      Array<{ size: string | number; name: string; version: string; now: string }>
    >,
    db.execute(
      sql`select relname as name, n_live_tup::bigint as rows, pg_total_relation_size(relid)::bigint as bytes from pg_stat_user_tables where schemaname = 'public' order by n_live_tup desc, relname asc`,
    ) as unknown as Promise<Array<{ name: string; rows: string | number; bytes: string | number }>>,
    migrationStatus(),
    dataDirBreakdown(),
  ]);
  const d = dbInfo[0];
  const handlers = [...getHandlers().values()].map((h) => ({
    type: h.type,
    concurrency: h.concurrency ?? 2,
    timeoutMs: h.timeoutMs ?? 15 * 60_000,
    retryable: h.retryable !== false,
  }));
  handlers.sort((a, b) => a.type.localeCompare(b.type));
  const schedules = [...getSchedules().values()].map((s) => {
    let nextRun: string | null = null;
    try {
      const c = new Cron(s.cron, { timezone: "UTC", paused: true });
      nextRun = c.nextRun()?.toISOString() ?? null;
      c.stop();
    } catch {
      nextRun = null;
    }
    return { name: s.name, cron: s.cron, nextRun };
  });
  schedules.sort((a, b) => a.name.localeCompare(b.name));
  return {
    app: {
      version: readPackageVersion(),
      commit: env.buildCommit,
      buildDate: env.buildDate,
      appUrl: env.appUrl,
      domain: env.domain,
      nodeEnv: process.env.NODE_ENV ?? "development",
      nodeVersion: process.version,
      platform: `${os.type()} ${os.release()} (${os.arch()})`,
      hostname: os.hostname(),
      uptimeSeconds: Math.round(process.uptime()),
      memoryRss: process.memoryUsage().rss,
    },
    database: {
      name: d?.name ?? "",
      version: (d?.version ?? "").split(" on ")[0] ?? "",
      sizeBytes: Number(d?.size ?? 0),
      tables: tables.map((t) => ({ name: t.name, rows: Number(t.rows), bytes: Number(t.bytes) })),
    },
    migrations,
    dataDir: { path: env.dataDir, ...data },
    worker: { handlers, schedules },
  };
}

export type SystemInfo = Awaited<ReturnType<typeof getSystemInfo>>;

export async function listFeedback(limit = 200) {
  const rows = await db
    .select({ fb: feedback, email: users.email, name: users.name, projectName: projects.name })
    .from(feedback)
    .leftJoin(users, eq(users.id, feedback.userId))
    .leftJoin(projects, eq(projects.id, feedback.projectId))
    .orderBy(desc(feedback.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.fb.id,
    kind: r.fb.kind,
    message: r.fb.message,
    path: r.fb.path,
    projectId: r.fb.projectId,
    projectName: r.projectName,
    userEmail: r.email,
    userName: r.name,
    createdAt: r.fb.createdAt.toISOString(),
  }));
}

export type FeedbackRow = Awaited<ReturnType<typeof listFeedback>>[number];

/** Removes the favicon cache (re-fetched lazily). Returns number of files deleted. */
export async function clearFaviconCache(): Promise<number> {
  const dir = path.join(env.dataDir, "favicons");
  let n = 0;
  try {
    const entries = await fsp.readdir(dir);
    for (const e of entries) {
      await fsp.rm(path.join(dir, e), { force: true, recursive: true });
      n++;
    }
  } catch {
    /* no cache yet */
  }
  return n;
}
