import "server-only";
import { clientIpSync } from "@/server/http/request";
import crypto from "node:crypto";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { agentCheckins, agentJobs, agents, type AgentCommand } from "@/server/db/schema";
import { rateLimit } from "@/server/rate-limit";
import { getSetting } from "@/server/settings";
import { hashAgentToken, logAgentEvent, type AgentRow } from "./core";
import { reconcileRunningJobs } from "./jobs";
import { signal } from "./notify";
import { getAgentRuntime } from "./runtime";

/* ───────────────────────────── auth ───────────────────────────── */

export function requestIp(req: Request): string | null {
  return clientIpSync(req.headers);
}

export function agentJson(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Authenticates an agent request (`Authorization: Bearer asa_…`). Returns the agent row or an error
 * response. Also refreshes `lastSeenAt` so any request keeps the agent online.
 */
export async function authenticateAgent(req: Request): Promise<{ agent: AgentRow; ip: string | null } | Response> {
  const ip = requestIp(req);
  const header = req.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token || token.length > 200) return agentJson({ error: "unauthorized", message: "Missing agent token" }, 401);
  const [agent] = await db.select().from(agents).where(eq(agents.tokenHash, hashAgentToken(token))).limit(1);
  if (!agent) {
    if (!rateLimit(`agent-auth:${ip ?? "?"}`, 60, 60_000)) return agentJson({ error: "rate_limited" }, 429);
    return agentJson({ error: "unauthorized", message: "This agent token is not valid (it may have been reinstalled or deleted)." }, 401);
  }
  const now = new Date();
  if (!agent.lastSeenAt || now.getTime() - agent.lastSeenAt.getTime() > 3_000) {
    await db.update(agents).set({ lastSeenAt: now, lastIp: ip ?? agent.lastIp }).where(eq(agents.id, agent.id));
    agent.lastSeenAt = now;
  }
  return { agent, ip };
}

export async function readJsonBody<T extends z.ZodType>(req: Request, schema: T, maxBytes = 1_000_000): Promise<z.infer<T> | Response> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > maxBytes) return agentJson({ error: "payload_too_large" }, 413);
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return agentJson({ error: "bad_request" }, 400);
  }
  if (raw.length > maxBytes) return agentJson({ error: "payload_too_large" }, 413);
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    return agentJson({ error: "bad_request", message: "Invalid JSON" }, 400);
  }
  const res = schema.safeParse(parsed);
  if (!res.success) return agentJson({ error: "invalid", message: res.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, 400);
  return res.data;
}

/* ───────────────────────────── check-in ───────────────────────────── */

const shortStr = (max = 200) => z.string().max(max).nullish();

export const checkinSchema = z.object({
  version: z.string().max(80),
  hostname: shortStr(),
  os: shortStr(40),
  osRelease: shortStr(),
  arch: shortStr(40),
  node: shortStr(40),
  claude: shortStr(120),
  codex: shortStr(120),
  effectiveRuntime: z.enum(["claude", "codex"]).nullish(),
  flags: z
    .object({
      runtime: z.enum(["claude", "codex", "detect"]).nullish(),
      workDir: z.string().max(1000).nullish(),
      maxParallel: z.number().int().min(1).max(64).nullish(),
      noAutoUpdate: z.boolean().nullish(),
      autostart: z.string().max(40).nullish(),
      allowFull: z.boolean().nullish(),
      allowCodexShell: z.boolean().nullish(),
      allowRemoteWorkdir: z.boolean().nullish(),
      mcpServers: z.string().max(2000).nullish(),
    })
    .default({}),
  workDir: z.string().max(1000).nullish(),
  maxParallel: z.number().int().min(1).max(64).nullish(),
  running: z.array(z.string().max(40)).max(128).default([]),
  state: z.enum(["idle", "busy", "updating", "stopping"]).default("idle"),
  /** `doctor` connectivity check: report the environment only (no job reconciliation / commands). */
  probe: z.boolean().optional(),
  workDirBytes: z.number().int().min(0).nullish(),
  updatingTo: z.string().max(80).nullish(),
  events: z
    .array(
      z.object({
        type: z.string().max(60),
        level: z.enum(["info", "success", "warning", "error"]).default("info"),
        message: z.string().max(2000),
        jobId: z.string().max(40).nullish(),
        meta: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .max(50)
    .default([]),
});

export type CheckinBody = z.infer<typeof checkinSchema>;

export type CheckinResponse = {
  agent: { id: string; name: string; workspaceId: string };
  settings: {
    enabled: boolean;
    runtime: "claude" | "codex" | "detect" | null;
    workDir: string | null;
    maxParallel: number;
    allowedKinds: string[];
    cliProfile: "auto" | "lean" | "full";
    checkinIntervalSeconds: number;
    jobTimeoutMinutes: number;
    autoCleanupHours: number;
    autoUpdate: boolean;
  };
  latestVersion: string;
  update: { version: string; sha256: string; signature: string; url: string; forced: boolean } | null;
  cancel: string[];
  commands: AgentCommand[];
  serverTime: string;
};

function fingerprint(b: CheckinBody): string {
  return crypto
    .createHash("sha1")
    .update(JSON.stringify([b.version, b.hostname, b.os, b.osRelease, b.arch, b.node, b.claude, b.codex, b.effectiveRuntime]))
    .digest("hex");
}

export async function handleCheckin(agent: AgentRow, body: CheckinBody, ip: string | null): Promise<CheckinResponse> {
  const settings = await getSetting("agents");
  const runtime = getAgentRuntime();
  const now = new Date();
  const wasOffline = !!agent.offlineSince || !agent.firstCheckinAt;
  const versionChanged = !!agent.agentVersion && agent.agentVersion !== body.version;
  const effectiveMaxParallel = agent.maxParallel ?? body.flags.maxParallel ?? settings.defaultMaxParallelJobs;
  const effectiveWorkDir = agent.workDir ?? body.flags.workDir ?? (settings.defaultWorkDir || null);

  const probe = !!body.probe;

  const patch: Partial<typeof agents.$inferInsert> = {
    agentVersion: body.version,
    hostname: body.hostname ?? agent.hostname,
    os: body.os ?? agent.os,
    osRelease: body.osRelease ?? agent.osRelease,
    arch: body.arch ?? agent.arch,
    nodeVersion: body.node ?? agent.nodeVersion,
    claudeVersion: body.claude ?? null,
    codexVersion: body.codex ?? null,
    effectiveRuntime: body.effectiveRuntime ?? null,
    localFlags: {
      runtime: body.flags.runtime ?? undefined,
      workDir: body.flags.workDir ?? null,
      maxParallel: body.flags.maxParallel ?? null,
      noAutoUpdate: !!body.flags.noAutoUpdate,
      autostart: body.flags.autostart ?? null,
      allowFull: !!body.flags.allowFull,
      allowCodexShell: !!body.flags.allowCodexShell,
      allowRemoteWorkdir: !!body.flags.allowRemoteWorkdir,
      mcpServers: body.flags.mcpServers ?? null,
    },
    effectiveWorkDir: body.workDir ?? effectiveWorkDir,
    effectiveMaxParallel: body.maxParallel ?? effectiveMaxParallel,
    workDirBytes: body.workDirBytes ?? agent.workDirBytes,
    lastCheckinAt: now,
    lastSeenAt: now,
    lastIp: ip ?? agent.lastIp,
    offlineSince: null,
    firstCheckinAt: agent.firstCheckinAt ?? now,
  };
  // A probe (installer `doctor`) may run next to a live agent: never touch its job/run state.
  if (!probe) {
    patch.runningJobs = body.running.length;
    patch.state = body.state;
  }

  // Update bookkeeping.
  if (versionChanged) {
    patch.lastUpdatedAt = now;
    patch.updatingToVersion = null;
    patch.updateStartedAt = null;
    if (body.version === runtime.version) patch.updateRequestedAt = null;
  }
  if (body.state === "updating" && body.updatingTo && agent.updatingToVersion !== body.updatingTo) {
    patch.updatingToVersion = body.updatingTo;
    patch.updateStartedAt = now;
  }
  if (body.version === runtime.version && agent.updateRequestedAt) patch.updateRequestedAt = null;

  const outdated = body.version !== runtime.version;
  const forced = !!agent.updateRequestedAt;
  const autoUpdate = settings.allowAutoUpdate && agent.autoUpdate;
  const localBlock = !!body.flags.noAutoUpdate;
  let update: CheckinResponse["update"] = null;
  if (!probe && outdated && (forced || autoUpdate)) {
    if (localBlock) {
      if (forced) {
        patch.updateRequestedAt = null;
        await logAgentEvent(agent.id, "update_blocked", "Update requested, but this agent runs with --no-auto-update (update it manually by re-running the installer).", {
          level: "warning",
        });
      }
    } else {
      update = {
        version: runtime.version,
        sha256: runtime.sha256,
        signature: runtime.signature,
        url: `/install/agent.mjs?v=${encodeURIComponent(runtime.version)}`,
        forced,
      };
    }
  }

  await db.update(agents).set(patch).where(eq(agents.id, agent.id));

  // Deliver pending commands exactly once (atomic take, so concurrently added commands survive).
  let commands: AgentCommand[] = [];
  if (!probe) {
    const taken = (await db.execute(sql`
      UPDATE agents a SET commands = '[]'::jsonb
      FROM (SELECT id, commands FROM agents WHERE id = ${agent.id} FOR UPDATE) old
      WHERE a.id = old.id AND jsonb_array_length(old.commands) > 0
      RETURNING old.commands AS commands`)) as unknown as Array<{ commands: AgentCommand[] }>;
    commands = taken[0]?.commands ?? [];
  }

  // History: one row whenever the environment changes, else at most hourly.
  const fp = fingerprint(body);
  const [last] = await db
    .select({ fingerprint: agentCheckins.fingerprint, createdAt: agentCheckins.createdAt })
    .from(agentCheckins)
    .where(eq(agentCheckins.agentId, agent.id))
    .orderBy(desc(agentCheckins.createdAt))
    .limit(1);
  const envChanged = !last || last.fingerprint !== fp;
  if (envChanged || now.getTime() - last.createdAt.getTime() > 3_600_000) {
    await db.insert(agentCheckins).values({
      agentId: agent.id,
      agentVersion: body.version,
      hostname: body.hostname,
      os: body.os,
      osRelease: body.osRelease,
      arch: body.arch,
      nodeVersion: body.node,
      claudeVersion: body.claude,
      codexVersion: body.codex,
      effectiveRuntime: body.effectiveRuntime,
      runningJobs: body.running.length,
      ip,
      fingerprint: fp,
    });
  }

  // Activity log.
  if (!agent.firstCheckinAt) {
    await logAgentEvent(agent.id, "first_checkin", `First check-in from ${body.hostname ?? "unknown host"} (${body.os ?? "?"}/${body.arch ?? "?"})`, {
      level: "success",
      meta: { version: body.version, claude: body.claude, codex: body.codex, node: body.node },
    });
  } else if (wasOffline) {
    await logAgentEvent(agent.id, "online", "Came back online", { level: "success" });
  }
  if (versionChanged) {
    await logAgentEvent(agent.id, "updated", `Updated agent ${agent.agentVersion} → ${body.version}`, {
      level: "success",
      meta: { from: agent.agentVersion, to: body.version },
    });
  }
  if (agent.firstCheckinAt && (agent.claudeVersion ?? null) !== (body.claude ?? null)) {
    await logAgentEvent(agent.id, "cli_changed", `Claude Code ${agent.claudeVersion ?? "not installed"} → ${body.claude ?? "not installed"}`, {
      meta: { cli: "claude", from: agent.claudeVersion, to: body.claude },
    });
  }
  if (agent.firstCheckinAt && (agent.codexVersion ?? null) !== (body.codex ?? null)) {
    await logAgentEvent(agent.id, "cli_changed", `Codex ${agent.codexVersion ?? "not installed"} → ${body.codex ?? "not installed"}`, {
      meta: { cli: "codex", from: agent.codexVersion, to: body.codex },
    });
  }
  if (body.state === "updating" && body.updatingTo && agent.updatingToVersion !== body.updatingTo) {
    await logAgentEvent(agent.id, "update_started", `Updating to ${body.updatingTo}`, { meta: { from: body.version, to: body.updatingTo } });
  }
  // Events may only reference this agent's own jobs.
  const eventJobIds = [...new Set(body.events.map((e) => e.jobId).filter((v): v is string => !!v))];
  const ownJobIds = new Set(
    eventJobIds.length
      ? (
          await db
            .select({ id: agentJobs.id })
            .from(agentJobs)
            .where(and(inArray(agentJobs.id, eventJobIds), or(eq(agentJobs.agentId, agent.id), eq(agentJobs.pinnedAgentId, agent.id))))
        ).map((r) => r.id)
      : [],
  );
  for (const raw of body.events) {
    const e = { ...raw, jobId: raw.jobId && ownJobIds.has(raw.jobId) ? raw.jobId : null };
    const quietAutoCleanup = e.type === "cleanup" && e.meta?.auto === true && Number(e.meta?.removed ?? 0) === 0;
    if (!quietAutoCleanup) await logAgentEvent(agent.id, e.type, e.message, { level: e.level, jobId: e.jobId ?? null, meta: e.meta ?? {} });
    if (e.type === "cleanup" && e.meta) {
      const freed = Number(e.meta.freedBytes ?? 0);
      await db
        .update(agents)
        .set({ lastCleanupAt: now, lastCleanupFreedBytes: Number.isFinite(freed) ? freed : 0 })
        .where(eq(agents.id, agent.id));
    }
  }

  const cancel = probe ? [] : await reconcileRunningJobs({ ...agent, ...patch } as AgentRow, body.running);
  if (wasOffline || versionChanged || body.state !== agent.state || body.running.length !== agent.runningJobs) {
    await signal({ type: "agent-changed", agentId: agent.id });
  }

  return {
    agent: { id: agent.id, name: agent.name, workspaceId: agent.workspaceId },
    settings: {
      enabled: agent.enabled && settings.enabled,
      runtime: agent.runtime ?? null,
      workDir: effectiveWorkDir,
      maxParallel: effectiveMaxParallel,
      allowedKinds: agent.allowedKinds,
      cliProfile: agent.cliProfile,
      checkinIntervalSeconds: settings.checkinIntervalSeconds,
      jobTimeoutMinutes: settings.jobTimeoutMinutes,
      autoCleanupHours: settings.autoCleanupHours,
      autoUpdate: autoUpdate && !localBlock,
    },
    latestVersion: runtime.version,
    update,
    cancel,
    commands,
    serverTime: now.toISOString(),
  };
}
