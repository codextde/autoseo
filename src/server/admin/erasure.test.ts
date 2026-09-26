import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  apiKeys,
  auditLogs,
  bookmarks,
  feedback,
  invitations,
  notifications,
  projects,
  reports,
  sessions,
  users,
  workspaceMembers,
  workspaces,
} from "@/server/db/schema";
import {
  anonymizeJson,
  buildUserExport,
  DELETED_USER_EMAIL,
  DELETED_USER_LABEL,
  eraseUser,
  ErasureError,
  findOwnershipBlockers,
  getErasureInventory,
  omitKeys,
} from "./erasure";

describe("erasure helpers", () => {
  it("anonymizes an email anywhere in nested JSON (case-insensitive)", () => {
    const meta = {
      email: "Jane.Doe@Example.com",
      diff: { invitee: { from: "", to: "jane.doe@example.com" } },
      list: ["x", "cc: JANE.DOE@example.com, other@example.com"],
      n: 3,
      flag: true,
    };
    const out = anonymizeJson(meta, "jane.doe@example.com");
    expect(out.email).toBe(DELETED_USER_EMAIL);
    expect(out.diff.invitee.to).toBe(DELETED_USER_EMAIL);
    expect(out.list[1]).toBe(`cc: ${DELETED_USER_EMAIL}, other@example.com`);
    expect(out.n).toBe(3);
    expect(out.flag).toBe(true);
    // regex metacharacters in the address are treated literally
    expect(anonymizeJson({ a: "a+b@x.io aXbX@xYio" }, "a+b@x.io").a).toBe(`${DELETED_USER_EMAIL} aXbX@xYio`);
  });

  it("only blocks on workspaces that would be left ownerless with other members", () => {
    const blockers = findOwnershipBlockers([
      { id: "w1", name: "Solo", otherOwners: 0, otherMembers: 0 },
      { id: "w2", name: "Team", otherOwners: 0, otherMembers: 3 },
      { id: "w3", name: "Co-owned", otherOwners: 1, otherMembers: 4 },
    ]);
    expect(blockers).toEqual([{ id: "w2", name: "Team", members: 3 }]);
  });

  it("omits secret columns from export rows", () => {
    expect(omitKeys({ id: "s1", tokenHash: "abc", ip: "1.2.3.4" }, ["tokenHash"])).toEqual({ id: "s1", ip: "1.2.3.4" });
  });
});

describe("eraseUser (integration, dev DB)", () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const email = `erasure.${suffix}@autoseo.test`;
  const otherEmail = `erasure.other.${suffix}@autoseo.test`;
  let userId = "";
  let otherId = "";
  let wsId = "";
  let projectId = "";
  let reportId = "";
  const auditIds: string[] = [];

  beforeAll(async () => {
    const [ws] = await db.insert(workspaces).values({ name: `Erasure test ${suffix}`, slug: `erasure-test-${suffix}` }).returning();
    wsId = ws!.id;
    const [u] = await db.insert(users).values({ email, name: "Erase Me" }).returning();
    // The colleague is the instance admin, so erasing the test user never leaves the instance without one.
    const [o] = await db.insert(users).values({ email: otherEmail, name: "Colleague", isInstanceAdmin: true }).returning();
    userId = u!.id;
    otherId = o!.id;
    await db.insert(workspaceMembers).values([
      { workspaceId: wsId, userId, roleKey: "owner" },
      { workspaceId: wsId, userId: otherId, roleKey: "member" },
    ]);
    const [p] = await db.insert(projects).values({ workspaceId: wsId, name: "Erasure project", domain: `erasure-${suffix}.example` }).returning();
    projectId = p!.id;
    await db.insert(sessions).values({ userId, tokenHash: `erasure-${suffix}`, expiresAt: new Date(Date.now() + 86_400_000) });
    await db.insert(bookmarks).values({ userId, name: "My view", path: "/" });
    await db.insert(notifications).values({ userId, kind: "info", title: "Hello" });
    await db.insert(feedback).values({ userId, message: "Please add dark mode" });
    await db.insert(apiKeys).values({ workspaceId: wsId, userId, name: "CI", prefix: "as_test", keyHash: `erasure-key-${suffix}` });
    await db.insert(invitations).values({
      workspaceId: wsId,
      email: `invitee.${suffix}@autoseo.test`,
      roleKey: "member",
      tokenHash: `erasure-inv-${suffix}`,
      invitedBy: userId,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const logs = await db
      .insert(auditLogs)
      .values([
        { action: "auth.login", actorId: userId, actorEmail: email, ip: "203.0.113.9", meta: {} },
        { action: "member.role_changed", actorId: otherId, actorEmail: otherEmail, targetType: "user", targetId: userId, meta: { email } },
      ])
      .returning({ id: auditLogs.id });
    auditIds.push(...logs.map((l) => l.id));
    const [r] = await db
      .insert(reports)
      .values({
        projectId,
        workspaceId: wsId,
        kind: "deck",
        title: "Q3 report",
        createdBy: userId,
        createdByLabel: "Erase Me",
        shareEnabled: true,
        shareToken: `erasure-share-${suffix}`,
      })
      .returning();
    reportId = r!.id;
  });

  afterAll(async () => {
    await db.delete(auditLogs).where(inArray(auditLogs.id, auditIds));
    await db.delete(auditLogs).where(inArray(auditLogs.targetId, [userId, otherId]));
    await db.delete(workspaces).where(eq(workspaces.id, wsId));
    await db.delete(users).where(inArray(users.id, [userId, otherId]));
  });

  it("inventories the user's data and blocks while they are the sole owner of a team workspace", async () => {
    const inv = await getErasureInventory(userId);
    const byKey = Object.fromEntries(inv.items.map((i) => [i.key, i.count]));
    expect(byKey.sessions).toBe(1);
    expect(byKey.bookmarks).toBe(1);
    expect(byKey.api_keys).toBe(1);
    expect(byKey.reports).toBe(1);
    expect(byKey.report_shares).toBe(1);
    expect(byKey.audit_logs).toBeGreaterThanOrEqual(2);
    expect(inv.blockers.map((b) => b.code)).toContain("sole_owner");
    await expect(eraseUser(userId, { confirmEmail: email, actor: null, initiatedBy: "self" })).rejects.toBeInstanceOf(ErasureError);
  });

  it("exports the user's data without secrets", async () => {
    const data = await buildUserExport(userId);
    expect(data.profile.email).toBe(email);
    expect(data.sessions).toHaveLength(1);
    expect(JSON.stringify(data)).not.toContain("tokenHash");
    expect(JSON.stringify(data)).not.toContain("keyHash");
    expect(data.bookmarks).toHaveLength(1);
    expect(data.reportsCreated.map((r) => r.id)).toContain(reportId);
  });

  it("requires the exact email as confirmation", async () => {
    await db.update(workspaceMembers).set({ roleKey: "owner" }).where(eq(workspaceMembers.userId, otherId));
    await expect(eraseUser(userId, { confirmEmail: "wrong@autoseo.test", actor: null, initiatedBy: "self" })).rejects.toMatchObject({
      code: "confirm_mismatch",
    });
  });

  it("erases personal data, keeps workspace resources and anonymizes the audit trail", async () => {
    const res = await eraseUser(userId, { confirmEmail: email.toUpperCase(), actor: null, initiatedBy: "self" });
    expect(res.counts.sessions).toBe(1);

    expect(await db.select().from(users).where(eq(users.id, userId))).toHaveLength(0);
    expect(await db.select().from(sessions).where(eq(sessions.userId, userId))).toHaveLength(0);
    expect(await db.select().from(bookmarks).where(eq(bookmarks.userId, userId))).toHaveLength(0);
    expect(await db.select().from(apiKeys).where(eq(apiKeys.userId, userId))).toHaveLength(0);
    expect(await db.select().from(invitations).where(eq(invitations.tokenHash, `erasure-inv-${suffix}`))).toHaveLength(0);

    // Workspace data survives, re-attributed and with public links revoked.
    const [report] = await db.select().from(reports).where(eq(reports.id, reportId));
    expect(report).toBeDefined();
    expect(report!.createdBy).toBeNull();
    expect(report!.createdByLabel).toBe(DELETED_USER_LABEL);
    expect(report!.shareEnabled).toBe(false);
    expect(report!.shareToken).toBeNull();
    expect(await db.select().from(projects).where(eq(projects.id, projectId))).toHaveLength(1);

    // Audit log: actions kept, person removed.
    const [login] = await db.select().from(auditLogs).where(eq(auditLogs.id, auditIds[0]!));
    expect(login?.actorEmail).toBe(DELETED_USER_EMAIL);
    expect(login?.actorId).toBeNull();
    expect(login?.ip).toBeNull();
    const targeted = await db.select().from(auditLogs).where(eq(auditLogs.targetId, userId));
    const roleChange = targeted.find((l) => l.action === "member.role_changed");
    expect(JSON.stringify(roleChange?.meta)).not.toContain(email);
    const erased = targeted.find((l) => l.action === "user.erased");
    if (erased) expect(JSON.stringify(erased)).not.toContain(email);
  });
});
