"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { projects } from "@/server/db/schema";
import { actionAdmin, ActionError, runAction } from "@/server/auth/guards";
import { rateLimit } from "@/server/rate-limit";
import { sendMail, verifySmtp, appUrl } from "@/server/email";
import { simpleEmail } from "@/server/email/templates";
import { logAudit } from "@/server/audit";
import { isValidEmail } from "@/server/auth/domains";
import {
  AI_KEY_PROVIDERS,
  testAiProvider,
  testBingKey,
  testCloudflareToken,
  testDataForSeo,
  testLlmRouting,
  testPageSpeedKey,
  type TestResult,
} from "@/server/admin/provider-tests";

function limit(userId: string, what: string, max = 10) {
  if (!rateLimit(`admin-test:${what}:${userId}`, max, 10 * 60_000)) {
    throw new ActionError("Too many tests in a short time. Please wait a few minutes.", "invalid");
  }
}

export async function verifySmtpAction() {
  return runAction(async (): Promise<TestResult> => {
    const ctx = await actionAdmin();
    limit(ctx.user.id, "smtp-verify");
    const started = Date.now();
    const res = await verifySmtp();
    return res.ok
      ? { ok: true, message: "SMTP server accepted the connection and credentials.", latencyMs: Date.now() - started }
      : { ok: false, message: "SMTP verification failed.", detail: res.error };
  });
}

export async function sendTestEmailAction(to: string) {
  return runAction(async (): Promise<TestResult> => {
    const ctx = await actionAdmin();
    limit(ctx.user.id, "test-email", 5);
    const email = z.string().trim().toLowerCase().parse(to || ctx.user.email);
    if (!isValidEmail(email)) throw new ActionError("Enter a valid recipient address.", "invalid");
    const mail = await simpleEmail({
      subject: "Test email from your AutoSEO instance",
      heading: "It works!",
      body: `This is a test email sent by ${ctx.user.email} from the admin panel.\nMagic sign-in links and invitations will be delivered the same way.`,
      cta: { label: "Open admin panel", url: appUrl("/admin/email") },
    });
    const started = Date.now();
    const res = await sendMail({ to: email, ...mail });
    void logAudit("email.test_sent", { actor: ctx.user, meta: { to: email, delivered: res.delivered, transport: res.transport } });
    if (res.transport === "log") return { ok: false, message: "SMTP is disabled — the message was written to the server log instead." };
    return res.delivered
      ? { ok: true, message: `Test email sent to ${email}.`, detail: res.messageId, latencyMs: Date.now() - started }
      : { ok: false, message: "Sending failed.", detail: res.error };
  });
}

export async function testAiProviderAction(provider: string) {
  return runAction(async () => {
    const ctx = await actionAdmin();
    limit(ctx.user.id, "ai");
    const p = z.enum(AI_KEY_PROVIDERS).parse(provider);
    const res = await testAiProvider(p);
    void logAudit("ai.provider_tested", { actor: ctx.user, meta: { provider: p, ok: res.ok } });
    return res;
  });
}

export async function testLlmRoutingAction(route: "api" | "agent") {
  return runAction(async () => {
    const ctx = await actionAdmin();
    limit(ctx.user.id, "ai-routing");
    // Route agent tests to the admin's own workspace: one where they manage agents, else the
    // workspace of their last project, else their first membership.
    const lastProjectWs = ctx.user.lastProjectId
      ? (await db.select({ ws: projects.workspaceId }).from(projects).where(eq(projects.id, ctx.user.lastProjectId)).limit(1))[0]?.ws
      : undefined;
    const membership =
      ctx.memberships.find((m) => m.permissions.has("agents.manage") && m.workspace.id === lastProjectWs) ??
      ctx.memberships.find((m) => m.permissions.has("agents.manage")) ??
      ctx.memberships.find((m) => m.workspace.id === lastProjectWs) ??
      ctx.memberships[0];
    return testLlmRouting(z.enum(["api", "agent"]).parse(route), {
      workspaceId: membership?.workspace.id ?? null,
      workspaceName: membership?.workspace.name ?? null,
      userId: ctx.user.id,
    });
  });
}

export async function testDataForSeoAction() {
  return runAction(async () => {
    const ctx = await actionAdmin();
    limit(ctx.user.id, "dfs");
    return testDataForSeo();
  });
}

export async function testIntegrationAction(kind: string) {
  return runAction(async (): Promise<TestResult> => {
    const ctx = await actionAdmin();
    limit(ctx.user.id, "integration");
    const k = z.enum(["pagespeed", "cloudflare", "bing"]).parse(kind);
    if (k === "pagespeed") return testPageSpeedKey();
    if (k === "cloudflare") return testCloudflareToken();
    return testBingKey();
  });
}
