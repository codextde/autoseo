"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { assertAdmin, AuthError } from "@/server/auth/guards";
import { getSetting, isCoolifyConfigured, updateSetting } from "@/server/settings";
import { sendMail, verifySmtp } from "@/server/email";
import { testEmail } from "@/server/email/templates";
import { connectStripe, cancelSubscriptionNow, stripeModeFromKey } from "@/server/stripe";
import { connectionFromSettings, coolify } from "@/server/coolify";
import { IMAGE_PATTERN, MEMORY_PATTERN } from "@/server/compose";
import { getInstance } from "@/server/instances";
import { deleteInstance, ensureCoolifyProject, provisionInstance, restartInstance, retryProvisioning, stopInstance } from "@/server/provisioning";
import { logEvent } from "@/server/events";

export type AdminActionState = { ok?: boolean; error?: string; message?: string };

function fail(err: unknown): AdminActionState {
  if (err instanceof AuthError) return { error: err.message };
  if (err instanceof z.ZodError) return { error: err.issues.map((i) => i.message).join(" ") };
  return { error: err instanceof Error ? err.message : String(err) };
}

const checkbox = (v: FormDataEntryValue | null) => v === "on" || v === "true";
const text = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

/* ─────────────────────────────── Email ─────────────────────────────── */

const smtpSchema = z.object({
  host: z.string().max(253),
  port: z.coerce.number().int().min(1, "Port must be 1–65535.").max(65535, "Port must be 1–65535."),
  user: z.string().max(320),
  fromName: z.string().max(80),
  fromEmail: z.union([z.literal(""), z.email("From email is not a valid address.")]),
  replyTo: z.union([z.literal(""), z.email("Reply-to is not a valid address.")]),
});

export async function saveSmtpAction(_prev: AdminActionState, fd: FormData): Promise<AdminActionState> {
  try {
    const { user } = await assertAdmin();
    const data = smtpSchema.parse({
      host: text(fd, "host"),
      port: text(fd, "port") || "587",
      user: text(fd, "user"),
      fromName: text(fd, "fromName"),
      fromEmail: text(fd, "fromEmail"),
      replyTo: text(fd, "replyTo"),
    });
    if (data.host && !data.fromEmail) return { error: "A from email is required when a host is set." };
    const password = String(fd.get("password") ?? "");
    await updateSetting("smtp", {
      ...data,
      secure: checkbox(fd.get("secure")),
      shareWithInstances: checkbox(fd.get("shareWithInstances")),
      ...(password ? { password } : checkbox(fd.get("clearPassword")) ? { password: "" } : {}),
    });
    await logEvent("settings.smtp_saved", { userId: user.id, data: { host: data.host, port: data.port } });
    const verify = data.host ? await verifySmtp() : null;
    refresh();
    if (verify && !verify.ok) return { ok: true, message: `Saved, but the connection test failed: ${verify.error}` };
    return { ok: true, message: data.host ? "Saved — the SMTP connection works." : "Saved." };
  } catch (err) {
    return fail(err);
  }
}

export async function sendTestEmailAction(_prev: AdminActionState, fd: FormData): Promise<AdminActionState> {
  try {
    const { user } = await assertAdmin();
    const to = text(fd, "to") || user.email;
    if (!z.email().safeParse(to).success) return { error: "Enter a valid recipient." };
    const res = await sendMail({ to, ...testEmail() });
    await logEvent("settings.smtp_test", { userId: user.id, data: { to, transport: res.transport, delivered: res.delivered, error: res.error } });
    if (res.transport === "log") return { error: "SMTP is not configured — the test email was written to the server log." };
    if (!res.delivered) return { error: `Sending failed: ${res.error}` };
    return { ok: true, message: `Test email sent to ${to}.` };
  } catch (err) {
    return fail(err);
  }
}

/* ─────────────────────────────── Stripe ─────────────────────────────── */

export async function saveStripeAction(_prev: AdminActionState, fd: FormData): Promise<AdminActionState> {
  try {
    const { user } = await assertAdmin();
    const secretKey = text(fd, "secretKey");
    if (secretKey && !stripeModeFromKey(secretKey)) {
      return { error: "That doesn't look like a Stripe secret key (sk_live_…, sk_test_…, rk_live_… or rk_test_…)." };
    }
    const trialDays = z.coerce.number().int().min(0).max(730).safeParse(text(fd, "trialDays") || "0");
    if (!trialDays.success) return { error: "Trial days must be a number between 0 and 730." };
    const current = await getSetting("stripe");
    if (!secretKey && !current.secretKey) return { error: "Enter your Stripe secret key." };
    await updateSetting("stripe", {
      ...(secretKey ? { secretKey, mode: stripeModeFromKey(secretKey) } : {}),
      trialDays: trialDays.data,
      automaticTax: checkbox(fd.get("automaticTax")),
      allowPromotionCodes: checkbox(fd.get("allowPromotionCodes")),
    });
    await logEvent("settings.stripe_saved", { userId: user.id, data: { keyChanged: !!secretKey } });
    // Saving (re)runs the idempotent account setup.
    const res = await connectStripe();
    refresh();
    if (!res.ok) return { error: `Saved, but connecting to Stripe failed: ${res.error}` };
    return { ok: true, message: `Connected to Stripe (${res.settings.mode ?? "unknown"} mode).` };
  } catch (err) {
    return fail(err);
  }
}

export async function connectStripeAction(): Promise<AdminActionState> {
  try {
    await assertAdmin();
    const res = await connectStripe();
    refresh();
    return res.ok ? { ok: true, message: "Stripe setup is complete." } : { error: res.error };
  } catch (err) {
    return fail(err);
  }
}

/* ─────────────────────────────── Coolify ─────────────────────────────── */

const coolifySchema = z.object({
  baseUrl: z.url("Base URL must be a valid URL.").refine((u) => /^https?:\/\//.test(u), "Base URL must start with https://"),
  projectName: z.string().min(1, "Project name is required.").max(100),
  baseDomain: z
    .string()
    .toLowerCase()
    .regex(/^(?=.{3,200}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/, "Instance base domain must be a domain like autoseo.codext.de."),
  image: z.string().regex(IMAGE_PATTERN, "Image must look like ghcr.io/codextde/autoseo:latest."),
  memoryLimit: z.string().regex(MEMORY_PATTERN, "Memory limit must look like 1536m or 2g."),
});

export async function saveCoolifyAction(_prev: AdminActionState, fd: FormData): Promise<AdminActionState> {
  try {
    const { user } = await assertAdmin();
    const data = coolifySchema.parse({
      baseUrl: text(fd, "baseUrl").replace(/\/+$/, ""),
      projectName: text(fd, "projectName"),
      baseDomain: text(fd, "baseDomain"),
      image: text(fd, "image"),
      memoryLimit: text(fd, "memoryLimit"),
    });
    const apiToken = text(fd, "apiToken");
    const current = await getSetting("coolify");
    const connectionChanged = data.baseUrl !== current.baseUrl || (!!apiToken && apiToken !== current.apiToken);
    await updateSetting("coolify", {
      ...data,
      ...(apiToken ? { apiToken } : {}),
      ...(connectionChanged || data.projectName !== current.projectName ? { projectUuid: "" } : {}),
      ...(connectionChanged ? { serverUuid: "", serverName: "" } : {}),
    });
    await logEvent("settings.coolify_saved", { userId: user.id, data: { baseUrl: data.baseUrl, tokenChanged: !!apiToken } });
    refresh();
    return { ok: true, message: connectionChanged ? "Saved. Now load the servers and pick one." : "Saved." };
  } catch (err) {
    return fail(err);
  }
}

export type CoolifyServersState = AdminActionState & { servers?: { uuid: string; name: string; ip?: string }[] };

export async function loadCoolifyServersAction(): Promise<CoolifyServersState> {
  try {
    await assertAdmin();
    const settings = await getSetting("coolify");
    const servers = (await coolify.listServers(connectionFromSettings(settings))).map((s) => ({ uuid: s.uuid, name: s.name, ip: s.ip }));
    if (servers.length === 1 && settings.serverUuid !== servers[0]!.uuid) {
      await updateSetting("coolify", { serverUuid: servers[0]!.uuid, serverName: servers[0]!.name });
      refresh();
      return { ok: true, servers, message: `Selected the only server, “${servers[0]!.name}”.` };
    }
    return { ok: true, servers, message: servers.length ? `Found ${servers.length} servers.` : "No servers found in Coolify." };
  } catch (err) {
    return fail(err);
  }
}

export async function selectCoolifyServerAction(_prev: AdminActionState, fd: FormData): Promise<AdminActionState> {
  try {
    await assertAdmin();
    const uuid = text(fd, "serverUuid");
    const settings = await getSetting("coolify");
    const server = (await coolify.listServers(connectionFromSettings(settings))).find((s) => s.uuid === uuid);
    if (!server) return { error: "Server not found." };
    await updateSetting("coolify", { serverUuid: server.uuid, serverName: server.name });
    refresh();
    return { ok: true, message: `Instances will be deployed to “${server.name}”.` };
  } catch (err) {
    return fail(err);
  }
}

export async function testCoolifyAction(): Promise<AdminActionState> {
  try {
    await assertAdmin();
    const settings = await getSetting("coolify");
    const conn = connectionFromSettings(settings);
    const version = await coolify.version(conn);
    if (!isCoolifyConfigured(settings)) return { ok: true, message: `Connected to Coolify ${version}. Pick a server to finish setup.` };
    const projectUuid = await ensureCoolifyProject(conn, await getSetting("coolify"));
    refresh();
    return { ok: true, message: `Connected to Coolify ${version}. Project “${settings.projectName}” is ready (${projectUuid}).` };
  } catch (err) {
    return fail(err);
  }
}

/* ─────────────────────────────── Customers ─────────────────────────────── */

export type InstanceOp = "provision" | "start" | "stop" | "restart" | "redeploy";

export async function adminInstanceAction(instanceId: string, op: InstanceOp): Promise<AdminActionState> {
  try {
    const { user } = await assertAdmin();
    const instance = await getInstance(instanceId);
    if (!instance || instance.status === "deleted") return { error: "Instance not found." };
    const actor = `admin:${user.email}`;
    let res;
    switch (op) {
      case "provision":
        res = await retryProvisioning(instance.id, actor);
        break;
      case "start":
        res = await provisionInstance(instance.id, actor);
        break;
      case "stop":
        res = await stopInstance(instance, actor, "admin");
        break;
      case "restart":
        res = await restartInstance(instance, actor);
        break;
      case "redeploy":
        res = await restartInstance(instance, actor, { latest: true });
        break;
      default:
        return { error: "Unknown action." };
    }
    refresh();
    return res.ok ? { ok: true, message: `${op[0]!.toUpperCase()}${op.slice(1)} requested for ${instance.slug}.` } : { error: res.error };
  } catch (err) {
    return fail(err);
  }
}

export async function adminDeleteInstanceAction(_prev: AdminActionState, fd: FormData): Promise<AdminActionState> {
  try {
    const { user } = await assertAdmin();
    const instance = await getInstance(text(fd, "instanceId"));
    if (!instance || instance.status === "deleted") return { error: "Instance not found." };
    if (text(fd, "confirmSlug") !== instance.slug) return { error: `Type “${instance.slug}” to confirm.` };
    const actor = `admin:${user.email}`;
    await cancelSubscriptionNow(instance, actor);
    const res = await deleteInstance(instance, actor);
    refresh();
    return res.ok ? { ok: true, message: `${instance.slug} was deleted.` } : { error: res.error };
  } catch (err) {
    return fail(err);
  }
}
