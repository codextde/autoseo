import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { env } from "@/server/env";
import { getReleaseKeys, releaseKeyFingerprint, signRelease } from "./signing";

/**
 * The agent runtime (`agent/agent.mjs`) and its installers are served by the app itself. Every
 * deploy is a new agent version: the build commit (+ date) in production, a content hash in dev.
 */

const AGENT_DIR = path.join(process.cwd(), "agent");
const VERSION_PLACEHOLDER = "__AUTOSEO_AGENT_VERSION__";
const HOST_PLACEHOLDER = "__AUTOSEO_HOST__";
const PUBKEY_PLACEHOLDER = "__AUTOSEO_AGENT_PUBKEY__";

export type AgentRuntimeArtifact = {
  version: string;
  sha256: string;
  size: number;
  content: Buffer;
  commit: string;
  builtAt: string | null;
  /** Ed25519 signature (base64) of `content` with the instance's release key. */
  signature: string;
  keyFingerprint: string;
};

type BuildInfo = { commit: string; date: string | null };

let buildInfoCache: BuildInfo | null | undefined;
function readBuildInfo(): BuildInfo | null {
  if (buildInfoCache !== undefined) return buildInfoCache;
  if (env.buildCommit && env.buildCommit !== "dev") {
    buildInfoCache = { commit: env.buildCommit, date: env.buildDate === new Date(0).toISOString() ? null : env.buildDate };
    return buildInfoCache;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), "build-info.json"), "utf8")) as { commit?: string; date?: string };
    buildInfoCache = raw.commit ? { commit: String(raw.commit), date: raw.date ? String(raw.date) : null } : null;
  } catch {
    buildInfoCache = null;
  }
  return buildInfoCache;
}

let runtimeCache: { mtimeMs: number; artifact: AgentRuntimeArtifact } | null = null;

/** Current agent runtime as served to agents (version string injected, SHA-256 of served bytes). */
export function getAgentRuntime(): AgentRuntimeArtifact {
  const file = path.join(AGENT_DIR, "agent.mjs");
  const stat = fs.statSync(file);
  if (runtimeCache && runtimeCache.mtimeMs === stat.mtimeMs) return runtimeCache.artifact;
  const raw = fs.readFileSync(file, "utf8");
  const build = readBuildInfo();
  const contentHash = crypto.createHash("sha256").update(raw).digest("hex");
  const version = build
    ? `${build.commit.slice(0, 12)}${build.date ? `-${build.date.replace(/[^0-9]/g, "").slice(0, 12)}` : ""}`
    : `dev-${contentHash.slice(0, 12)}`;
  const content = Buffer.from(raw.split(VERSION_PLACEHOLDER).join(version).split(PUBKEY_PLACEHOLDER).join(getReleaseKeys().publicKeyB64), "utf8");
  const artifact: AgentRuntimeArtifact = {
    version,
    sha256: crypto.createHash("sha256").update(content).digest("hex"),
    size: content.length,
    content,
    commit: build?.commit ?? "dev",
    builtAt: build?.date ?? null,
    signature: signRelease(content),
    keyFingerprint: releaseKeyFingerprint(),
  };
  runtimeCache = { mtimeMs: stat.mtimeMs, artifact };
  return artifact;
}

/** Safe variant for UI pages (never throws). */
export function getAgentRuntimeInfo(): { version: string; sha256: string; size: number; commit: string; builtAt: string | null; keyFingerprint: string } | null {
  try {
    const { version, sha256, size, commit, builtAt, keyFingerprint } = getAgentRuntime();
    return { version, sha256, size, commit, builtAt, keyFingerprint };
  } catch (err) {
    console.error("[agents] agent runtime missing", err);
    return null;
  }
}

/** Installer script with the server URL injected as default `--host`. */
export function getInstallScript(kind: "sh" | "ps1"): string {
  const file = path.join(AGENT_DIR, kind === "sh" ? "install.sh" : "install.ps1");
  const raw = fs.readFileSync(file, "utf8");
  return raw.split(HOST_PLACEHOLDER).join(env.appUrl).split(PUBKEY_PLACEHOLDER).join(getReleaseKeys().publicKeyB64);
}

/** Public base URL used in install commands. */
export function agentHostUrl(): string {
  return env.appUrl;
}

export type InstallCommands = { unix: string; windows: string; unixUninstall: string; windowsUninstall: string };

/**
 * One-liners. The token travels in an environment variable (not in process arguments, so it never
 * shows up in `ps`); the dashboard appends optional local-policy flags such as `--allow-full`.
 */
export function buildInstallCommands(token: string, host = agentHostUrl()): InstallCommands {
  return {
    unix: `curl -fsSL ${host}/install.sh | AUTOSEO_AGENT_TOKEN=${token} bash -s -- --host ${host}`,
    windows: `$env:AUTOSEO_AGENT_TOKEN='${token}'; iwr -useb ${host}/install.ps1 | iex; Install-AutoSEOAgent -HostUrl ${host}`,
    unixUninstall: `curl -fsSL ${host}/install.sh | bash -s -- --uninstall`,
    windowsUninstall: `iwr -useb ${host}/install.ps1 | iex; Uninstall-AutoSEOAgent`,
  };
}
