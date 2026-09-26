import "server-only";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { instances, users, type Instance } from "@/server/db/schema";
import { decryptJson, encryptJson } from "@/server/crypto";
import { env } from "@/server/env";
import { appUrl } from "@/server/http";
import { logEvent } from "@/server/events";
import { getSetting, isCoolifyConfigured, updateSetting, type CoolifySettings } from "@/server/settings";
import { buildCreateServiceBody, buildInstanceEnv, instanceUrl, serviceName } from "@/server/compose";
import { buildMailFrom, buildSmtpUrl } from "@/server/smtp-url";
import { generateSsoSecret } from "@/server/sso";
import { checkInstanceHealth, connectionFromSettings, coolify, CoolifyError, type CoolifyConnection } from "@/server/coolify";
import { sendMail } from "@/server/email";
import { instanceReadyEmail } from "@/server/email/templates";

const MAX_PROVISION_ATTEMPTS = 6;
/** How long a started instance may take to answer /api/health before it is marked failed. */
export const START_TIMEOUT_MS = 20 * 60 * 1000;

declare global {
  var __cloudProvisioning: Map<string, Promise<ProvisionResult>> | undefined;
}
const inflight = (globalThis.__cloudProvisioning ??= new Map());

export type ProvisionResult = { ok: true } | { ok: false; error: string };

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Resolves (and creates when missing) the Coolify project + environment instances are deployed into. */
export async function ensureCoolifyProject(conn: CoolifyConnection, s: CoolifySettings): Promise<string> {
  let projectUuid = s.projectUuid;
  if (projectUuid) {
    const projects = await coolify.listProjects(conn);
    if (!projects.some((p) => p.uuid === projectUuid)) projectUuid = "";
  }
  if (!projectUuid) {
    const projects = await coolify.listProjects(conn);
    const existing = projects.find((p) => p.name === s.projectName);
    projectUuid = existing
      ? existing.uuid
      : (await coolify.createProject(conn, s.projectName, "Managed AutoSEO instances (created by AutoSEO Cloud)")).uuid;
    await updateSetting("coolify", { projectUuid });
    await logEvent(existing ? "coolify.project_found" : "coolify.project_created", { data: { projectUuid, name: s.projectName } });
  }
  try {
    const envs = await coolify.listEnvironments(conn, projectUuid);
    if (!envs.some((e) => e.name === s.environmentName)) await coolify.createEnvironment(conn, projectUuid, s.environmentName);
  } catch (err) {
    // Older Coolify releases have no environments endpoint; new projects come with "production".
    if (!(err instanceof CoolifyError && (err.status === 404 || err.status === 405))) throw err;
  }
  return projectUuid;
}

async function instanceSsoSecret(instance: Instance): Promise<string> {
  if (instance.ssoSecretEnc) return decryptJson<string>(instance.ssoSecretEnc);
  const secret = generateSsoSecret();
  // Only the first writer wins, so concurrent runs agree on one secret.
  await db
    .update(instances)
    .set({ ssoSecretEnc: encryptJson(secret) })
    .where(and(eq(instances.id, instance.id), isNull(instances.ssoSecretEnc)));
  const [row] = await db.select({ enc: instances.ssoSecretEnc }).from(instances).where(eq(instances.id, instance.id));
  return decryptJson<string>(row!.enc!);
}

export async function getInstanceSsoSecret(instance: Instance): Promise<string | null> {
  return instance.ssoSecretEnc ? decryptJson<string>(instance.ssoSecretEnc) : null;
}

/** Makes sure the `app` container is routed to https://<host> (older Coolify ignores `urls` on create). */
async function ensureDomain(conn: CoolifyConnection, serviceUuid: string, host: string, instanceId: string) {
  const url = instanceUrl(host);
  try {
    const apps = await coolify.listServiceApplications(conn, serviceUuid);
    const app = apps.find((a) => a.name === "app") ?? apps[0];
    if (!app) return;
    const current = (app.fqdn ?? "").split(",").map((u) => u.trim().replace(/\/+$/, ""));
    if (current.includes(url)) return;
    await coolify.updateServiceApplication(conn, serviceUuid, app.uuid, { url });
    await logEvent("instance.domain_set", { instanceId, data: { url } });
  } catch (err) {
    if (err instanceof CoolifyError && (err.status === 404 || err.status === 405)) {
      await logEvent("instance.domain_check_skipped", { instanceId, data: { reason: err.message } });
      return;
    }
    throw err;
  }
}

async function instanceEnv(instance: Instance, owner: { email: string; name: string | null }) {
  const smtp = await getSetting("smtp");
  const share = smtp.shareWithInstances && !!smtp.host && !!smtp.fromEmail;
  return buildInstanceEnv({
    host: instance.host,
    ownerEmail: owner.email,
    ownerName: owner.name ?? "",
    workspaceName: instance.workspaceName,
    smtpUrl: share ? buildSmtpUrl(smtp) : null,
    mailFrom: share ? buildMailFrom(smtp.fromName, smtp.fromEmail) : null,
    ssoSecret: await instanceSsoSecret(instance),
    cloudUrl: env.appUrl,
  });
}

/**
 * Creates (or adopts) the Coolify service, applies domain + environment and starts it. Idempotent and
 * resumable: the service uuid is stored the moment it exists, and every step is safe to repeat.
 */
async function runProvision(instanceId: string, actor: string): Promise<ProvisionResult> {
  let instance = (await db.select().from(instances).where(eq(instances.id, instanceId)).limit(1))[0];
  if (!instance) return { ok: false, error: "Instance not found." };
  if (instance.status === "deleted") return { ok: false, error: "This instance was deleted." };

  if (instance.status !== "provisioning") {
    const [updated] = await db
      .update(instances)
      .set({ status: "provisioning", error: null, startRequestedAt: null })
      .where(and(eq(instances.id, instanceId), ne(instances.status, "deleted")))
      .returning();
    if (!updated) return { ok: false, error: "This instance was deleted." };
    instance = updated;
  }
  await logEvent("instance.provision_started", { instanceId, userId: instance.userId, data: { actor, attempt: instance.provisionAttempts + 1 } });

  try {
    const settings = await getSetting("coolify");
    if (!isCoolifyConfigured(settings)) {
      throw new Error("Coolify is not configured yet (Admin → Coolify: API token and server are required).");
    }
    if (!instance.userId) throw new Error("The instance has no owner account.");
    const [owner] = await db.select().from(users).where(eq(users.id, instance.userId)).limit(1);
    if (!owner) throw new Error("The owner account no longer exists.");

    const conn = connectionFromSettings(settings);
    let serviceUuid = instance.coolifyServiceUuid;
    if (!serviceUuid) {
      const projectUuid = await ensureCoolifyProject(conn, settings);
      // Adopt a service left behind by an interrupted run of *this* instance (its id is in the description)
      // instead of creating a duplicate — never one of a previous owner of the same address.
      const existing = (await coolify.listServices(conn)).find(
        (s) => s.name === serviceName(instance!.slug) && (s.description ?? "").includes(instanceId),
      );
      if (existing) {
        serviceUuid = existing.uuid;
        await logEvent("instance.service_adopted", { instanceId, data: { serviceUuid } });
      } else {
        const created = await coolify.createService(
          conn,
          buildCreateServiceBody({
            instanceId,
            slug: instance.slug,
            host: instance.host,
            ownerEmail: owner.email,
            projectUuid,
            serverUuid: settings.serverUuid,
            environmentName: settings.environmentName,
            image: settings.image,
            memoryLimit: settings.memoryLimit,
          }),
        );
        if (!created?.uuid) throw new Error("Coolify did not return a service uuid.");
        serviceUuid = created.uuid;
        await logEvent("instance.service_created", { instanceId, data: { serviceUuid, domains: created.domains ?? [] } });
      }
      await db.update(instances).set({ coolifyServiceUuid: serviceUuid }).where(eq(instances.id, instanceId));
      instance = { ...instance, coolifyServiceUuid: serviceUuid };
    }

    await ensureDomain(conn, serviceUuid, instance.host, instanceId);
    await coolify.setServiceEnvs(conn, serviceUuid, await instanceEnv(instance, owner));
    await logEvent("instance.env_applied", { instanceId });

    // A stop or delete may have landed while we were configuring: don't start it behind its back.
    const [current] = await db.select({ status: instances.status }).from(instances).where(eq(instances.id, instanceId));
    if (current?.status !== "provisioning") {
      await logEvent("instance.provision_aborted", { instanceId, data: { status: current?.status ?? "missing" } });
      return { ok: false, error: `Provisioning stopped: the instance is now ${current?.status ?? "gone"}.` };
    }
    await coolify.startService(conn, serviceUuid);
    const [started] = await db
      .update(instances)
      .set({ startRequestedAt: new Date(), provisionAttempts: 0, nextProvisionAt: null, error: null })
      .where(and(eq(instances.id, instanceId), eq(instances.status, "provisioning")))
      .returning({ id: instances.id });
    if (!started) {
      // Stopped/deleted during the start call: undo the start.
      await coolify.stopService(conn, serviceUuid).catch(() => undefined);
      await logEvent("instance.provision_aborted", { instanceId, data: { reason: "state changed during start" } });
      return { ok: false, error: "Provisioning stopped: the instance changed state." };
    }
    await logEvent("instance.start_requested", { instanceId, data: { serviceUuid } });
    return { ok: true };
  } catch (err) {
    const message = errorMessage(err);
    const attempts = instance.provisionAttempts + 1;
    const failed = attempts >= MAX_PROVISION_ATTEMPTS;
    // Backoff: 1, 2, 4, 8, 16 minutes between automatic retries.
    const nextProvisionAt = failed ? null : new Date(Date.now() + 60_000 * 2 ** (attempts - 1));
    await db
      .update(instances)
      .set({ provisionAttempts: attempts, nextProvisionAt, error: message, ...(failed ? { status: "failed" as const } : {}) })
      .where(and(eq(instances.id, instanceId), eq(instances.status, "provisioning")));
    await logEvent(failed ? "instance.failed" : "instance.provision_error", {
      instanceId,
      userId: instance.userId,
      data: { error: message, attempt: attempts, retryAt: nextProvisionAt?.toISOString() ?? null },
    });
    console.error(`[provision] ${instance.slug}: ${message}`);
    return { ok: false, error: message };
  }
}

/** Single-flight per instance (webhook, success redirect and reconciler may race). */
export function provisionInstance(instanceId: string, actor = "system"): Promise<ProvisionResult> {
  const running = inflight.get(instanceId);
  if (running) return running;
  const p = runProvision(instanceId, actor).finally(() => inflight.delete(instanceId));
  inflight.set(instanceId, p);
  return p;
}

/** Retry from scratch after a failure (resets the attempt counter). */
export async function retryProvisioning(instanceId: string, actor: string): Promise<ProvisionResult> {
  await db.update(instances).set({ provisionAttempts: 0, nextProvisionAt: null }).where(eq(instances.id, instanceId));
  return provisionInstance(instanceId, actor);
}

async function withService<T>(instance: Instance, fn: (conn: CoolifyConnection, uuid: string) => Promise<T>): Promise<T> {
  if (!instance.coolifyServiceUuid) throw new Error("This instance has no Coolify service yet — provision it first.");
  const settings = await getSetting("coolify");
  return fn(connectionFromSettings(settings), instance.coolifyServiceUuid);
}

/** Stops the containers (data volumes are kept). `byAdmin` keeps billing events from starting it again. */
export async function stopInstance(
  instance: Instance,
  actor: string,
  reason: string,
  opts: { byAdmin?: boolean } = {},
): Promise<ProvisionResult> {
  try {
    // Mark first so a concurrent provisioning run sees the stop before it starts the service.
    await db
      .update(instances)
      .set({ status: "stopped", stoppedByAdmin: !!opts.byAdmin, startRequestedAt: null, nextProvisionAt: null, error: null })
      .where(and(eq(instances.id, instance.id), ne(instances.status, "deleted")));
    if (instance.coolifyServiceUuid) await withService(instance, (conn, uuid) => coolify.stopService(conn, uuid));
    await logEvent("instance.stopped", { instanceId: instance.id, userId: instance.userId, data: { actor, reason } });
    return { ok: true };
  } catch (err) {
    const message = errorMessage(err);
    await db.update(instances).set({ error: `Stop failed: ${message}` }).where(eq(instances.id, instance.id));
    await logEvent("instance.stop_failed", { instanceId: instance.id, data: { actor, reason, error: message } });
    return { ok: false, error: message };
  }
}

/** Restart (optionally pulling the latest image); the reconciler confirms health again. */
export async function restartInstance(instance: Instance, actor: string, opts: { latest?: boolean } = {}): Promise<ProvisionResult> {
  try {
    await withService(instance, async (conn, uuid) => {
      try {
        await coolify.restartService(conn, uuid, opts);
      } catch (err) {
        if (!opts.latest || !(err instanceof CoolifyError) || err.status < 400 || err.status >= 500) throw err;
        // No `latest` support on this Coolify: stop + start pulls the image on start.
        await coolify.stopService(conn, uuid);
        await coolify.startService(conn, uuid);
      }
    });
    await db
      .update(instances)
      .set({ status: "provisioning", stoppedByAdmin: false, startRequestedAt: new Date(), error: null })
      .where(and(eq(instances.id, instance.id), ne(instances.status, "deleted")));
    await logEvent(opts.latest ? "instance.redeployed" : "instance.restarted", { instanceId: instance.id, userId: instance.userId, data: { actor } });
    return { ok: true };
  } catch (err) {
    const message = errorMessage(err);
    await logEvent("instance.restart_failed", { instanceId: instance.id, data: { actor, error: message } });
    return { ok: false, error: message };
  }
}

/** Removes the Coolify service including volumes and marks the instance deleted (releases the address). */
export async function deleteInstance(instance: Instance, actor: string): Promise<ProvisionResult> {
  try {
    if (instance.coolifyServiceUuid) {
      await withService(instance, async (conn, uuid) => {
        try {
          await coolify.deleteService(conn, uuid);
        } catch (err) {
          if (!(err instanceof CoolifyError && err.status === 404)) throw err;
        }
      });
    }
    await db
      .update(instances)
      .set({ status: "deleted", ssoSecretEnc: null, startRequestedAt: null, nextProvisionAt: null, error: null })
      .where(eq(instances.id, instance.id));
    await logEvent("instance.deleted", {
      instanceId: instance.id,
      userId: instance.userId,
      data: { actor, slug: instance.slug, serviceUuid: instance.coolifyServiceUuid },
    });
    return { ok: true };
  } catch (err) {
    const message = errorMessage(err);
    await logEvent("instance.delete_failed", { instanceId: instance.id, data: { actor, error: message } });
    return { ok: false, error: message };
  }
}

/** Called by the reconciler when /api/health answers: marks running and sends the ready email once. */
export async function markInstanceHealthy(instance: Instance): Promise<void> {
  const now = new Date();
  const wasRunning = instance.status === "running";
  // Conditional: a stop/delete that landed during the (slow) health check wins.
  const [updated] = await db
    .update(instances)
    .set({ status: "running", lastHealthAt: now, lastHealthOk: true, error: null })
    .where(and(eq(instances.id, instance.id), inArray(instances.status, ["provisioning", "running"])))
    .returning({ id: instances.id });
  if (!updated) return;
  if (!wasRunning) await logEvent("instance.running", { instanceId: instance.id, userId: instance.userId, data: { host: instance.host } });
  else if (instance.lastHealthOk === false) await logEvent("instance.healthy_again", { instanceId: instance.id });

  // Claim atomically so the email goes out exactly once.
  const [claimed] = await db
    .update(instances)
    .set({ readyEmailSentAt: now })
    .where(and(eq(instances.id, instance.id), isNull(instances.readyEmailSentAt)))
    .returning({ id: instances.id });
  if (!claimed || !instance.userId) return;
  const [owner] = await db.select().from(users).where(eq(users.id, instance.userId)).limit(1);
  if (!owner) return;
  const mail = instanceReadyEmail({
    instanceUrl: instanceUrl(instance.host),
    dashboardUrl: appUrl("/api/instance/open"),
    workspaceName: instance.workspaceName,
  });
  const res = await sendMail({ to: owner.email, ...mail });
  await logEvent("email.instance_ready", { instanceId: instance.id, userId: owner.id, data: { transport: res.transport, delivered: res.delivered, error: res.error } });
}

export async function markInstanceUnhealthy(instance: Instance): Promise<void> {
  const [updated] = await db
    .update(instances)
    .set({ lastHealthOk: false })
    .where(and(eq(instances.id, instance.id), eq(instances.status, "running")))
    .returning({ id: instances.id });
  if (updated && instance.lastHealthOk !== false) {
    await logEvent("instance.unhealthy", { instanceId: instance.id, userId: instance.userId, data: { host: instance.host } });
  }
}

export async function markStartTimedOut(instance: Instance): Promise<void> {
  const error = "The instance did not become healthy within 20 minutes. Check the service logs in Coolify, then retry.";
  const [updated] = await db
    .update(instances)
    .set({ status: "failed", error })
    .where(and(eq(instances.id, instance.id), eq(instances.status, "provisioning")))
    .returning({ id: instances.id });
  if (updated) await logEvent("instance.failed", { instanceId: instance.id, userId: instance.userId, data: { error } });
}

export { checkInstanceHealth };

/** Count helpers for the admin overview. */
export async function instanceCounts() {
  const rows = await db
    .select({ status: instances.status, n: sql<number>`count(*)::int` })
    .from(instances)
    .groupBy(instances.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Partial<Record<Instance["status"], number>>;
}
