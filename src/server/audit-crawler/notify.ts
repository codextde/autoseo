import "server-only";
/**
 * Score-drop alerts for scheduled audits / crawlability checks (in-app notification + email).
 */
import { and, desc, eq, lt, ne } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditSchedules, crawlabilityChecks, notifications, projects, siteAudits, users } from "@/server/db/schema";
import { appUrl, sendMail } from "@/server/email";
import { simpleEmail } from "@/server/email/templates";

type AuditRow = typeof siteAudits.$inferSelect;
type CheckRow = typeof crawlabilityChecks.$inferSelect;

const DEFAULT_DROP_THRESHOLD = 5;

async function notifyDrop(opts: {
  scheduleId: string | null;
  projectId: string;
  kind: "audit.score_drop" | "crawlability.score_drop";
  title: string;
  body: string;
  href: string;
  previous: number;
  current: number;
}) {
  const [schedule] = opts.scheduleId
    ? await db.select().from(auditSchedules).where(eq(auditSchedules.id, opts.scheduleId)).limit(1)
    : [];
  const threshold = schedule?.config.dropThreshold ?? DEFAULT_DROP_THRESHOLD;
  if (threshold <= 0 || opts.previous - opts.current < threshold) return false;

  const recipients = new Map<string, string | null>(); // email → userId
  if (schedule?.createdBy) {
    const [u] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, schedule.createdBy)).limit(1);
    if (u) recipients.set(u.email.toLowerCase(), u.id);
  }
  for (const email of schedule?.config.emails ?? []) {
    const e = email.trim().toLowerCase();
    if (e && !recipients.has(e)) recipients.set(e, null);
  }
  const url = appUrl(opts.href);
  for (const [email, userId] of recipients) {
    if (userId) {
      await db.insert(notifications).values({ userId, projectId: opts.projectId, kind: opts.kind, title: opts.title, body: opts.body, href: opts.href });
    }
    const mail = await simpleEmail({ subject: opts.title, heading: opts.title, body: opts.body, cta: { label: "Open report", url } });
    await sendMail({ to: email, ...mail });
  }
  return true;
}

export async function afterAuditCompleted(audit: AuditRow) {
  if (audit.score == null || audit.trigger !== "scheduled") return;
  const [previous] = await db
    .select({ id: siteAudits.id, score: siteAudits.score })
    .from(siteAudits)
    .where(and(eq(siteAudits.projectId, audit.projectId), eq(siteAudits.status, "completed"), ne(siteAudits.id, audit.id), lt(siteAudits.startedAt, audit.startedAt)))
    .orderBy(desc(siteAudits.startedAt))
    .limit(1);
  if (!previous || previous.score == null) return;
  const [project] = await db.select({ name: projects.name, domain: projects.domain }).from(projects).where(eq(projects.id, audit.projectId)).limit(1);
  const drop = previous.score - audit.score;
  await notifyDrop({
    scheduleId: audit.scheduleId,
    projectId: audit.projectId,
    kind: "audit.score_drop",
    title: `Site health dropped to ${audit.score} (−${drop}) · ${project?.name ?? project?.domain ?? "project"}`,
    body: `The scheduled site audit of ${audit.startUrl} scored ${audit.score}/100, down from ${previous.score}. ${audit.issueCounts?.critical ?? 0} critical, ${audit.issueCounts?.warning ?? 0} warnings across ${audit.pagesCrawled} pages.`,
    href: `/p/${audit.projectId}/seo/audit/${audit.id}`,
    previous: previous.score,
    current: audit.score,
  });
}

export async function afterCrawlabilityCompleted(check: CheckRow) {
  if (check.score == null || check.trigger !== "scheduled") return;
  const [previous] = await db
    .select({ id: crawlabilityChecks.id, score: crawlabilityChecks.score })
    .from(crawlabilityChecks)
    .where(
      and(
        eq(crawlabilityChecks.projectId, check.projectId),
        eq(crawlabilityChecks.status, "completed"),
        ne(crawlabilityChecks.id, check.id),
        lt(crawlabilityChecks.createdAt, check.createdAt),
      ),
    )
    .orderBy(desc(crawlabilityChecks.createdAt))
    .limit(1);
  if (!previous || previous.score == null) return;
  const [project] = await db.select({ name: projects.name, domain: projects.domain }).from(projects).where(eq(projects.id, check.projectId)).limit(1);
  await notifyDrop({
    scheduleId: check.scheduleId,
    projectId: check.projectId,
    kind: "crawlability.score_drop",
    title: `AI crawlability dropped to ${check.score} (−${previous.score - check.score}) · ${project?.name ?? project?.domain ?? "project"}`,
    body: `The scheduled AI crawler access check of ${check.origin} scored ${check.score}/100, down from ${previous.score}. Open the report to see which bots or pages are affected.`,
    href: `/p/${check.projectId}/crawlability/${check.id}`,
    previous: previous.score,
    current: check.score,
  });
}
