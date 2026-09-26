import "server-only";
import { and, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { auditLogs, projects, workspaces } from "@/server/db/schema";

/** Action categories = the prefix before the first dot (e.g. "settings.updated" → "settings"). */
export const auditFiltersSchema = z.object({
  category: z.string().trim().max(60).optional().nullable(),
  actor: z.string().trim().max(200).optional().nullable(),
  targetType: z.string().trim().max(60).optional().nullable(),
  q: z.string().trim().max(200).optional().nullable(),
  from: z.iso.datetime().optional().nullable(),
  to: z.iso.datetime().optional().nullable(),
  page: z.number().int().min(0).max(100_000).optional(),
  pageSize: z.number().int().min(10).max(200).optional(),
});
export type AuditFilters = z.infer<typeof auditFiltersSchema>;

function escapeLike(s: string) {
  return s.replace(/[%_\\]/g, (c) => `\\${c}`);
}

export function auditWhere(f: AuditFilters): SQL | undefined {
  const conds: SQL[] = [];
  if (f.category) conds.push(or(eq(auditLogs.action, f.category), ilike(auditLogs.action, `${escapeLike(f.category)}.%`))!);
  if (f.actor) conds.push(ilike(auditLogs.actorEmail, `%${escapeLike(f.actor)}%`));
  if (f.targetType) conds.push(eq(auditLogs.targetType, f.targetType));
  if (f.q) {
    const q = `%${escapeLike(f.q)}%`;
    conds.push(
      or(
        ilike(auditLogs.action, q),
        ilike(auditLogs.targetId, q),
        ilike(auditLogs.actorEmail, q),
        ilike(auditLogs.ip, q),
        sql`${auditLogs.meta}::text ilike ${q}`,
      )!,
    );
  }
  if (f.from) conds.push(gte(auditLogs.createdAt, new Date(f.from)));
  if (f.to) conds.push(lte(auditLogs.createdAt, new Date(f.to)));
  return conds.length ? and(...conds) : undefined;
}

export type AuditRow = {
  id: string;
  action: string;
  actorId: string | null;
  actorEmail: string | null;
  targetType: string | null;
  targetId: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  projectId: string | null;
  projectName: string | null;
  ip: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
};

export async function listAuditLogs(raw: AuditFilters) {
  const f = auditFiltersSchema.parse(raw);
  const pageSize = f.pageSize ?? 50;
  const page = f.page ?? 0;
  const where = auditWhere(f);
  const [rows, total] = await Promise.all([
    db
      .select({ log: auditLogs, workspaceName: workspaces.name, projectName: projects.name })
      .from(auditLogs)
      .leftJoin(workspaces, eq(workspaces.id, auditLogs.workspaceId))
      .leftJoin(projects, eq(projects.id, auditLogs.projectId))
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(pageSize)
      .offset(page * pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(auditLogs).where(where),
  ]);
  return {
    items: rows.map(({ log, workspaceName, projectName }) => ({
      id: log.id,
      action: log.action,
      actorId: log.actorId,
      actorEmail: log.actorEmail,
      targetType: log.targetType,
      targetId: log.targetId,
      workspaceId: log.workspaceId,
      workspaceName,
      projectId: log.projectId,
      projectName,
      ip: log.ip,
      meta: log.meta ?? {},
      createdAt: log.createdAt.toISOString(),
    })) satisfies AuditRow[],
    total: Number(total[0]?.n ?? 0),
    page,
    pageSize,
  };
}

/** Distinct categories / target types for the filter dropdowns. */
export async function auditFacets() {
  const [cats, targets, oldest] = await Promise.all([
    db
      .select({ category: sql<string>`split_part(${auditLogs.action}, '.', 1)`, n: sql<number>`count(*)::int` })
      .from(auditLogs)
      .groupBy(sql`1`)
      .orderBy(sql`1`),
    db
      .select({ targetType: auditLogs.targetType, n: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(sql`${auditLogs.targetType} is not null`)
      .groupBy(auditLogs.targetType)
      .orderBy(auditLogs.targetType),
    db.select({ at: sql<Date | null>`min(${auditLogs.createdAt})`, n: sql<number>`count(*)::int` }).from(auditLogs),
  ]);
  return {
    categories: cats.map((c) => ({ value: c.category, count: Number(c.n) })),
    targetTypes: targets.filter((t) => t.targetType).map((t) => ({ value: t.targetType!, count: Number(t.n) })),
    oldest: oldest[0]?.at ? new Date(oldest[0].at).toISOString() : null,
    total: Number(oldest[0]?.n ?? 0),
  };
}

/** Iterates matching audit rows in batches (for CSV export). */
export async function* iterateAuditLogs(raw: AuditFilters, batch = 1000, max = 100_000) {
  const f = auditFiltersSchema.parse({ ...raw, page: undefined, pageSize: undefined });
  const where = auditWhere(f);
  let offset = 0;
  while (offset < max) {
    const rows = await db
      .select({ log: auditLogs, workspaceName: workspaces.name, projectName: projects.name })
      .from(auditLogs)
      .leftJoin(workspaces, eq(workspaces.id, auditLogs.workspaceId))
      .leftJoin(projects, eq(projects.id, auditLogs.projectId))
      .where(where)
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(batch)
      .offset(offset);
    if (!rows.length) return;
    yield rows;
    if (rows.length < batch) return;
    offset += batch;
  }
}

/** CSV cell escaping incl. spreadsheet formula-injection protection. */
export function csvCell(value: unknown): string {
  let s = value == null ? "" : typeof value === "string" ? value : value instanceof Date ? value.toISOString() : JSON.stringify(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export const AUDIT_PERIODS = [
  { key: "1d", label: "24h", days: 1 },
  { key: "7d", label: "7d", days: 7 },
  { key: "30d", label: "30d", days: 30 },
  { key: "90d", label: "90d", days: 90 },
  { key: "all", label: "All", days: 0 },
] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Builds audit filters from URL params (shared by the page and the CSV export route). */
export function auditFiltersFromParams(get: (key: string) => string | null | undefined): AuditFilters & { period: string } {
  const period = get("period") ?? "30d";
  let from: string | null = null;
  let to: string | null = null;
  const f = get("from");
  const t = get("to");
  if (period === "custom" && f && DATE_RE.test(f)) {
    from = new Date(`${f}T00:00:00.000Z`).toISOString();
    if (t && DATE_RE.test(t)) to = new Date(`${t}T23:59:59.999Z`).toISOString();
  } else {
    const preset = AUDIT_PERIODS.find((p) => p.key === period) ?? AUDIT_PERIODS[2];
    if (preset.days > 0) from = new Date(Date.now() - preset.days * 86_400_000).toISOString();
  }
  const clip = (v: string | null | undefined, n: number) => (v ? v.slice(0, n) : null);
  const page = Math.max(0, Math.min(100_000, Number(get("page")) || 0));
  return {
    period,
    category: clip(get("cat"), 60),
    actor: clip(get("actor"), 200),
    targetType: clip(get("target"), 60),
    q: clip(get("q"), 200),
    from,
    to,
    page,
  };
}
