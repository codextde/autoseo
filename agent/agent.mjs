#!/usr/bin/env node
// AutoSEO local agent — runs AutoSEO's AI jobs with your locally installed Claude Code or Codex CLI.
//
// • Single dependency-free file, Node.js >= 20.
// • Outbound HTTPS only (check-in, long-poll for jobs, stream logs, post results). No listening sockets.
// • Every job runs as a NEW CLI session in its own folder; up to `maxParallel` jobs in parallel.
// • Self-updates: downloads the new runtime from your AutoSEO server, verifies SHA-256, swaps atomically
//   and restarts (disable with --no-auto-update).
//
// Commands: run (default) · configure · doctor · status · cleanup · version
// Config:   ~/.autoseo-agent/config.json (0600) — override the directory with AUTOSEO_AGENT_HOME.

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const AGENT_VERSION = "__AUTOSEO_AGENT_VERSION__";
/** Release signing key of the AutoSEO server (Ed25519, SPKI DER, base64). Pinned into config.json at install. */
const RELEASE_PUBLIC_KEY = "__AUTOSEO_AGENT_PUBKEY__";
const EXIT_RESTART = 75;
const SELF = fileURLToPath(import.meta.url);
const IS_WIN = process.platform === "win32";
const HOME_DIR = process.env.AUTOSEO_AGENT_HOME || path.join(os.homedir(), ".autoseo-agent");
const CONFIG_FILE = path.join(HOME_DIR, "config.json");
const LOG_DIR = path.join(HOME_DIR, "logs");
const UPDATE_MARKER = path.join(HOME_DIR, "update.json");
/** Private scratch dir for per-job CLI config (outside the job folder the model can read). */
const RUN_DIR = path.join(HOME_DIR, "run");
const JOB_DIR_RE = /^ajb_[a-z0-9]{6,40}$/;
const MAX_LOG_FILE = 5 * 1024 * 1024;

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

/* ───────────────────────────── small utils ───────────────────────────── */

const sleep = (ms, signal) =>
  new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });

function expandHome(p) {
  if (!p) return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return "?";
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${u[i]}`;
}

function truncate(s, max) {
  s = String(s ?? "");
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function oneLine(v, max = 160) {
  const s = typeof v === "string" ? v : JSON.stringify(v ?? "");
  return truncate(s.replace(/\s+/g, " ").trim(), max);
}

class Backoff {
  constructor(min = 1000, max = 60_000) {
    this.min = min;
    this.max = max;
    this.n = 0;
  }
  next() {
    const base = Math.min(this.max, this.min * 2 ** this.n++);
    return Math.round(base / 2 + Math.random() * (base / 2));
  }
  reset() {
    this.n = 0;
  }
}

/** Extracts the first JSON object/array from free text. */
function extractJson(text) {
  if (!text) return undefined;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.search(/[[{]/);
  if (start === -1) return undefined;
  const open = candidate[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

function linksFromText(text) {
  const out = [];
  if (!text) return out;
  for (const m of text.matchAll(/\[([^\]]{1,300})\]\((https?:\/\/[^\s)]+)\)/g)) out.push({ url: m[2], title: m[1] });
  for (const m of text.matchAll(/(?<![(\w])(https?:\/\/[^\s)\]>"']+)/g)) out.push({ url: m[1].replace(/[.,;:]+$/, "") });
  return out;
}

function dedupeCitations(list) {
  const seen = new Map();
  for (const c of list) {
    if (!c?.url || !/^https?:\/\//.test(c.url)) continue;
    const prev = seen.get(c.url);
    if (!prev) seen.set(c.url, { url: c.url, ...(c.title ? { title: String(c.title).slice(0, 300) } : {}) });
    else if (!prev.title && c.title) prev.title = String(c.title).slice(0, 300);
  }
  return [...seen.values()].slice(0, 200);
}

async function dirSize(dir) {
  let total = 0;
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    try {
      if (e.isDirectory()) total += await dirSize(p);
      else if (e.isFile()) total += (await fsp.stat(p)).size;
    } catch {
      /* vanished */
    }
  }
  return total;
}

/* ───────────────────────────── config ───────────────────────────── */

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeConfig(cfg) {
  fs.mkdirSync(HOME_DIR, { recursive: true, mode: 0o700 });
  const tmp = `${CONFIG_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, CONFIG_FILE);
  try {
    fs.chmodSync(CONFIG_FILE, 0o600);
  } catch {
    /* windows */
  }
}

/** Plain http is only allowed for local development hosts. */
function isAllowedHost(h) {
  try {
    const u = new URL(h);
    if (u.protocol === "https:") return true;
    if (u.protocol !== "http:") return false;
    return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname) || /\.(localhost|test)$/.test(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Local security policy — only the machine owner changes it (installer flags / `configure`); the server
 * can never widen it:
 *  allowFull          Full CLI mode (owner's MCP servers) for the owner's own jobs
 *  mcpServers         which of the owner's user-scope Claude MCP servers Full mode exposes ("all" | names)
 *  allowCodexShell    Codex shell tool (read-only sandbox) for the owner's own jobs
 *  allowRemoteWorkdir accept work directories from the dashboard outside the local base directory
 */
function localPolicy() {
  const list = config.mcpServers;
  return {
    allowFull: config.allowFull === true,
    mcpServers: list === "all" || list === undefined ? "all" : Array.isArray(list) ? list.map(String) : [],
    allowCodexShell: config.allowCodexShell === true,
    allowRemoteWorkdir: config.allowRemoteWorkdir === true,
  };
}

function normalizeHost(h) {
  if (!h) return h;
  let v = String(h).trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  return v;
}

/* ───────────────────────────── logging ───────────────────────────── */

class Logger {
  constructor() {
    this.file = path.join(LOG_DIR, "agent.log");
    this.console = process.stdout.isTTY || process.env.AUTOSEO_AGENT_CONSOLE === "1";
    this.remote = null; // (line) => void — set once connected
    this.ready = false;
  }
  ensureDir() {
    if (this.ready) return;
    this.ready = true;
    try {
      fs.mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
    } catch {
      /* ignore */
    }
  }
  rotate() {
    try {
      const st = fs.statSync(this.file);
      if (st.size < MAX_LOG_FILE) return;
      for (let i = 3; i >= 1; i--) {
        const from = i === 1 ? this.file : `${this.file}.${i - 1}`;
        if (fs.existsSync(from)) fs.renameSync(from, `${this.file}.${i}`);
      }
    } catch {
      /* ignore */
    }
  }
  write(level, msg, { remote = true } = {}) {
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${msg}`;
    this.ensureDir();
    try {
      this.rotate();
      fs.appendFileSync(this.file, `${line}\n`);
    } catch {
      /* disk full etc. */
    }
    if (this.console) {
      const color = level === "error" ? C.red : level === "warn" ? C.yellow : level === "debug" ? C.gray : "";
      process.stdout.write(`${C.dim}${line.slice(11, 19)}${C.reset} ${color}${msg}${color ? C.reset : ""}\n`);
    }
    if (remote && this.remote && level !== "debug") {
      const color = level === "error" ? C.red : level === "warn" ? C.yellow : C.gray;
      this.remote(`${color}${msg}${C.reset}`);
    }
  }
  info(m, o) {
    this.write("info", m, o);
  }
  warn(m, o) {
    this.write("warn", m, o);
  }
  error(m, o) {
    this.write("error", m, o);
  }
  debug(m) {
    this.write("debug", m, { remote: false });
  }
}

const log = new Logger();

/* ───────────────────────────── process spawning ───────────────────────────── */

const WIN_META = /([()\][%!^"`<>&|;, *?])/g;

/** Quotes one argument for `cmd.exe /d /s /c "…"` targeting a .cmd/.bat shim. */
function winQuoteArg(arg) {
  let a = String(arg);
  a = a.replace(/(\\*)"/g, '$1$1\\"');
  a = a.replace(/(\\*)$/, "$1$1");
  a = `"${a}"`;
  a = a.replace(WIN_META, "^$1");
  return a.replace(WIN_META, "^$1");
}

function needsShell(bin) {
  return IS_WIN && /\.(cmd|bat)$/i.test(bin);
}

/** spawn() that also works for Windows .cmd shims (npm-installed CLIs) without a shell on POSIX. */
function spawnCli(bin, args, opts = {}) {
  if (needsShell(bin)) {
    const line = [bin.replace(WIN_META, "^$1"), ...args.map(winQuoteArg)].join(" ");
    return spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${line}"`], { ...opts, windowsVerbatimArguments: true, windowsHide: true });
  }
  return spawn(bin, args, { ...opts, windowsHide: true });
}

function runCapture(bin, args, { timeoutMs = 20_000, env } = {}) {
  return new Promise((resolve) => {
    let out = "";
    let err = "";
    let child;
    try {
      child = spawnCli(bin, args, { env: env ?? childEnv(), stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      return resolve({ code: -1, out: "", err: String(e?.message ?? e) });
    }
    const t = setTimeout(() => killTree(child), timeoutMs);
    child.stdout.on("data", (d) => (out += d.toString("utf8")).length > 200_000 && (out = out.slice(-200_000)));
    child.stderr.on("data", (d) => (err += d.toString("utf8")).length > 50_000 && (err = err.slice(-50_000)));
    child.on("error", (e) => {
      clearTimeout(t);
      resolve({ code: -1, out, err: String(e?.message ?? e) });
    });
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ code: code ?? -1, out, err });
    });
  });
}

function killTree(child, signal = "SIGTERM") {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (IS_WIN) {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } else {
      try {
        process.kill(-child.pid, signal);
      } catch {
        child.kill(signal);
      }
    }
  } catch {
    /* already gone */
  }
}

/* ───────────────────────────── CLI detection ───────────────────────────── */

function extraPathDirs() {
  const h = os.homedir();
  const dirs = [
    path.join(h, ".local", "bin"),
    path.join(h, ".claude", "local"),
    path.join(h, ".npm-global", "bin"),
    path.join(h, ".bun", "bin"),
    path.join(h, ".volta", "bin"),
    path.join(h, ".cargo", "bin"),
  ];
  if (IS_WIN) {
    if (process.env.APPDATA) dirs.push(path.join(process.env.APPDATA, "npm"));
    if (process.env.LOCALAPPDATA) dirs.push(path.join(process.env.LOCALAPPDATA, "Programs", "claude"));
  } else {
    dirs.push("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/snap/bin");
    try {
      const nvm = path.join(h, ".nvm", "versions", "node");
      for (const v of fs.readdirSync(nvm).sort().reverse()) dirs.push(path.join(nvm, v, "bin"));
    } catch {
      /* no nvm */
    }
  }
  return dirs;
}

let cachedPath = null;
function searchPath() {
  if (cachedPath) return cachedPath;
  const sep = IS_WIN ? ";" : ":";
  const parts = [...(config.path ? String(config.path).split(sep) : []), ...(process.env.PATH ?? "").split(sep), ...extraPathDirs()];
  cachedPath = [...new Set(parts.filter(Boolean))].join(sep);
  return cachedPath;
}

function childEnv(extra = {}) {
  const env = { ...process.env, PATH: searchPath(), ...extra };
  if (IS_WIN) env.Path = env.PATH;
  // Never leak a parent Claude Code session into job sessions.
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.AUTOSEO_AGENT_SUPERVISED;
  return env;
}

function which(cmd) {
  const sep = IS_WIN ? ";" : ":";
  // On Windows only real executables/shims count (npm also drops an extensionless sh script next to .cmd).
  const exts = IS_WIN ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean).map((e) => e.toLowerCase()) : [""];
  for (const dir of searchPath().split(sep)) {
    for (const ext of exts) {
      const p = path.join(dir, cmd + ext);
      try {
        const st = fs.statSync(p);
        if (st.isFile() && (IS_WIN || (st.mode & 0o111) !== 0)) return p;
      } catch {
        /* next */
      }
    }
  }
  return null;
}

function parseVersion(text) {
  const m = String(text ?? "").match(/\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.-]+)?/);
  return m ? m[0] : null;
}

const clis = { claude: null, codex: null, detectedAt: 0 };

async function detectClis(force = false) {
  if (!force && Date.now() - clis.detectedAt < 5 * 60_000) return clis;
  cachedPath = null;
  for (const name of ["claude", "codex"]) {
    const bin = which(name);
    if (!bin) {
      clis[name] = null;
      continue;
    }
    const prev = clis[name];
    const v = await runCapture(bin, ["--version"], { timeoutMs: 20_000 });
    const version = parseVersion(v.out) || parseVersion(v.err);
    if (!version) {
      clis[name] = null;
      continue;
    }
    if (prev && prev.bin === bin && prev.version === version) continue;
    const help = await runCapture(bin, name === "claude" ? ["--help"] : ["exec", "--help"], { timeoutMs: 20_000 });
    const h = `${help.out}\n${help.err}`;
    clis[name] = {
      bin,
      version,
      caps:
        name === "claude"
          ? {
              safeMode: h.includes("--safe-mode"),
              jsonSchema: h.includes("--json-schema"),
              noSession: h.includes("--no-session-persistence"),
              dontAsk: h.includes("dontAsk"),
              tools: h.includes("--tools"),
              systemPrompt: h.includes("--system-prompt"),
              partial: h.includes("--include-partial-messages"),
              mcpConfig: h.includes("--mcp-config"),
              strictMcp: h.includes("--strict-mcp-config"),
              settingSources: h.includes("--setting-sources"),
            }
          : {
              ephemeral: h.includes("--ephemeral"),
              skipGit: h.includes("--skip-git-repo-check"),
              json: h.includes("--json"),
              outputLast: h.includes("--output-last-message"),
              sandbox: h.includes("--sandbox"),
              image: h.includes("--image"),
              ignoreUserConfig: h.includes("--ignore-user-config"),
            },
    };
  }
  clis.detectedAt = Date.now();
  return clis;
}

function installedRuntimes() {
  return ["claude", "codex"].filter((r) => clis[r]);
}

/* ───────────────────────────── state ───────────────────────────── */

let config = readConfig();
const localFlags = { runtime: null, workDir: null, maxParallel: null, noAutoUpdate: false };
const settings = {
  enabled: true,
  runtime: null,
  workDir: null,
  maxParallel: 2,
  allowedKinds: ["llm", "web-search", "chat", "test"],
  cliProfile: "auto",
  checkinIntervalSeconds: 10,
  jobTimeoutMinutes: 30,
  autoCleanupHours: 24,
  autoUpdate: true,
};
const running = new Map(); // jobId → { job, child, cancel(reason), startedAt }
const pendingEvents = [];
let agentInfo = null;
let stopping = false;
let updating = null; // version being installed
let lastUpdateFailure = 0;
let workDirBytes = null;
let lastSizeScan = 0;
let authFailed = false;
const stopController = new AbortController();
let wakePoll = null;

function effectiveRuntime() {
  const wanted = settings.runtime || localFlags.runtime || config.runtime || "detect";
  if (wanted === "claude") return clis.claude ? "claude" : null;
  if (wanted === "codex") return clis.codex ? "codex" : null;
  return clis.claude ? "claude" : clis.codex ? "codex" : null;
}

/** Local base directory for job folders (install flag / config; never set by the server). */
function baseWorkDir() {
  return path.resolve(expandHome(localFlags.workDir || config.workDir || path.join(os.tmpdir(), "autoseo-agent")));
}

let warnedWorkDir = null;
function effectiveWorkDir() {
  const base = baseWorkDir();
  const pushed = settings.workDir ? path.resolve(expandHome(settings.workDir)) : null;
  if (!pushed || pushed === base) return base;
  const rel = path.relative(base, pushed);
  const inside = rel && !rel.startsWith("..") && !path.isAbsolute(rel);
  if (inside || localPolicy().allowRemoteWorkdir) return pushed;
  if (warnedWorkDir !== pushed) {
    warnedWorkDir = pushed;
    log.warn(`Ignoring work directory ${pushed} from the dashboard: it is outside ${base}. Re-run the installer with --allow-remote-workdir to allow it.`);
  }
  return base;
}

function jobsRoot() {
  return path.join(effectiveWorkDir(), "autoseo-jobs");
}

function maxParallel() {
  return Math.max(1, Math.min(32, Number(settings.maxParallel || localFlags.maxParallel || config.maxParallel || 2)));
}

function noAutoUpdate() {
  return !!(localFlags.noAutoUpdate || config.noAutoUpdate);
}

function pushEvent(e) {
  pendingEvents.push(e);
  if (pendingEvents.length > 50) pendingEvents.splice(0, pendingEvents.length - 50);
}

/* ───────────────────────────── HTTP ───────────────────────────── */

class AuthError extends Error {}
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function api(pathname, body, { timeoutMs = 30_000, method = "POST" } = {}) {
  const url = new URL(pathname, `${config.host}/`);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const onStop = () => ctrl.abort();
  stopController.signal.addEventListener("abort", onStop, { once: true });
  try {
    const res = await fetch(url, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.token}`,
        "user-agent": `autoseo-agent/${AGENT_VERSION} (${process.platform}; node ${process.versions.node})`,
        "x-agent-version": AGENT_VERSION,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (res.status === 401) throw new AuthError(data?.message || "Agent token rejected");
    if (!res.ok) throw new HttpError(res.status, data?.message || data?.error || `HTTP ${res.status}`);
    return data;
  } finally {
    clearTimeout(t);
    stopController.signal.removeEventListener("abort", onStop);
  }
}

/** POST with retries (results must not get lost on a flaky connection). */
async function apiRetry(pathname, body, attempts = 8) {
  const b = new Backoff(1000, 30_000);
  for (let i = 0; i < attempts; i++) {
    try {
      return await api(pathname, body);
    } catch (e) {
      if (e instanceof AuthError) throw e;
      if (e instanceof HttpError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) throw e;
      if (i === attempts - 1) throw e;
      await sleep(b.next());
    }
  }
  return null;
}

/* ───────────────────────────── log shipping ───────────────────────────── */

const shipQueue = [];
let shipBytes = 0;
let shipTimer = null;
let shipping = false;

const MAX_ENTRY_CHARS = 16_000;

function ship(jobId, stream, text) {
  if (!text) return;
  // Oversized output is split so every entry stays well below the server's per-entry limit.
  for (let i = 0; i < text.length; i += MAX_ENTRY_CHARS) {
    const part = text.slice(i, i + MAX_ENTRY_CHARS);
    const last = shipQueue.at(-1);
    if (last && last.jobId === jobId && last.stream === stream && last.data.length + part.length <= MAX_ENTRY_CHARS) last.data += part;
    else shipQueue.push({ jobId, stream, data: part });
    shipBytes += part.length;
  }
  while (shipBytes > 2_000_000 && shipQueue.length) shipBytes -= shipQueue.shift().data.length;
  if (!shipTimer) shipTimer = setTimeout(flushLogs, 350);
}

function shipLines(jobId, stream, text) {
  const s = String(text);
  ship(jobId, stream, s.endsWith("\n") ? s : `${s}\n`);
}

async function flushLogs() {
  shipTimer = null;
  if (shipping || !shipQueue.length || !config.token || authFailed) return;
  shipping = true;
  const batch = [];
  let size = 0;
  while (shipQueue.length && batch.length < 200 && size < 200_000) {
    const e = shipQueue.shift();
    size += e.data.length;
    batch.push(e);
  }
  shipBytes -= size;
  try {
    const res = await api("/api/agent/logs", { entries: batch }, { timeoutMs: 20_000 });
    for (const id of res?.cancel ?? []) cancelJob(id, "Cancelled from the dashboard");
  } catch (e) {
    const rejected = e instanceof HttpError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429;
    if (!(e instanceof AuthError) && !rejected) {
      shipQueue.unshift(...batch);
      shipBytes += size;
    } else if (rejected) log.debug(`Dropped ${batch.length} log entries (server rejected them: ${e.message})`);
  } finally {
    shipping = false;
    if (shipQueue.length && !shipTimer) shipTimer = setTimeout(flushLogs, 1000);
  }
}

/* ───────────────────────────── check-in ───────────────────────────── */

function checkinBody(state) {
  return {
    version: AGENT_VERSION,
    hostname: os.hostname(),
    os: process.platform,
    osRelease: `${os.type()} ${os.release()}`,
    arch: process.arch,
    node: process.versions.node,
    claude: clis.claude?.version ?? null,
    codex: clis.codex?.version ?? null,
    effectiveRuntime: effectiveRuntime(),
    flags: {
      runtime: localFlags.runtime || config.runtime || "detect",
      workDir: localFlags.workDir || config.workDir || null,
      maxParallel: localFlags.maxParallel || config.maxParallel || null,
      noAutoUpdate: noAutoUpdate(),
      autostart: config.autostart || null,
      allowFull: localPolicy().allowFull,
      allowCodexShell: localPolicy().allowCodexShell,
      allowRemoteWorkdir: localPolicy().allowRemoteWorkdir,
      mcpServers: localPolicy().allowFull ? (localPolicy().mcpServers === "all" ? "all" : localPolicy().mcpServers.join(",")) : null,
    },
    workDir: effectiveWorkDir(),
    maxParallel: maxParallel(),
    running: [...running.keys()],
    state: state ?? (stopping ? "stopping" : updating ? "updating" : running.size ? "busy" : "idle"),
    updatingTo: updating,
    workDirBytes,
    events: pendingEvents.splice(0, pendingEvents.length),
  };
}

async function checkin(state) {
  await detectClis();
  if (Date.now() - lastSizeScan > 5 * 60_000) {
    lastSizeScan = Date.now();
    dirSize(jobsRoot())
      .then((n) => (workDirBytes = n))
      .catch(() => {});
  }
  const body = checkinBody(state);
  try {
    const res = await api("/api/agent/checkin", body, { timeoutMs: 30_000 });
    applyCheckin(res);
    return res;
  } catch (e) {
    pendingEvents.unshift(...body.events);
    throw e;
  }
}

function applyCheckin(res) {
  if (!res) return;
  const first = !agentInfo;
  agentInfo = res.agent;
  if (authFailed) {
    authFailed = false;
    log.info("Agent token accepted again");
  }
  const prevRuntime = effectiveRuntime();
  const prevParallel = maxParallel();
  const prevEnabled = settings.enabled;
  Object.assign(settings, res.settings ?? {});
  if (first) {
    log.info(
      `Connected to ${config.host} as "${agentInfo.name}" · runtime ${effectiveRuntime() ?? "none"} · ${maxParallel()} parallel · work dir ${effectiveWorkDir()}`,
    );
    if (fs.existsSync(UPDATE_MARKER)) {
      try {
        const m = JSON.parse(fs.readFileSync(UPDATE_MARKER, "utf8"));
        log.info(`Running updated agent ${m.from} → ${AGENT_VERSION}`);
      } catch {
        /* ignore */
      }
      fs.rmSync(UPDATE_MARKER, { force: true });
    }
  } else {
    if (prevRuntime !== effectiveRuntime()) log.info(`Runtime is now ${effectiveRuntime() ?? "none"}`);
    if (prevParallel !== maxParallel()) log.info(`Max parallel jobs is now ${maxParallel()}`);
    if (prevEnabled !== settings.enabled) log.info(settings.enabled ? "Resumed — accepting jobs" : "Paused — not accepting new jobs");
  }
  if (!effectiveRuntime() && first) log.warn("No usable CLI found. Install Claude Code (`claude`) or Codex (`codex`) and make sure it is on PATH.");
  for (const id of res.cancel ?? []) cancelJob(id, "Cancelled from the dashboard");
  for (const cmd of res.commands ?? []) {
    if (cmd.type === "cleanup") void cleanup(cmd.maxAgeHours ?? 0, !!cmd.auto);
  }
  if (res.update && !updating && !stopping) {
    if (noAutoUpdate()) {
      if (!applyCheckin.warned) log.warn(`Update ${res.update.version} available, but auto-update is disabled (--no-auto-update).`);
      applyCheckin.warned = true;
    } else if (Date.now() - lastUpdateFailure > 10 * 60_000 || res.update.forced) {
      void selfUpdate(res.update);
    }
  }
  if (wakePoll) wakePoll();
}

async function checkinLoop() {
  const backoff = new Backoff(2000, 60_000);
  while (!stopping) {
    let wait = Math.max(5, Math.min(55, settings.checkinIntervalSeconds || 10)) * 1000;
    try {
      await checkin();
      backoff.reset();
    } catch (e) {
      if (e instanceof AuthError) {
        if (!authFailed) log.error(`${e.message} — reinstall the agent from the AutoSEO dashboard (Local Agents → Reinstall).`, { remote: false });
        authFailed = true;
        wait = 60_000;
      } else {
        wait = backoff.next();
        log.warn(`Check-in failed (${e.message ?? e}); retrying in ${Math.round(wait / 1000)}s`, { remote: false });
      }
    }
    await sleep(wait, stopController.signal);
  }
}

/* ───────────────────────────── job polling ───────────────────────────── */

async function pollLoop() {
  const backoff = new Backoff(1000, 60_000);
  while (!stopping) {
    if (!agentInfo || updating || authFailed) {
      await sleep(1000, stopController.signal);
      continue;
    }
    const slots = Math.max(0, maxParallel() - running.size);
    if (slots === 0) {
      await new Promise((resolve) => {
        wakePoll = resolve;
        setTimeout(resolve, 5000);
      });
      wakePoll = null;
      continue;
    }
    try {
      const res = await api(
        "/api/agent/poll",
        { slots, running: [...running.keys()], runtimes: effectiveRuntime() ? installedRuntimes() : [], wait: 25 },
        { timeoutMs: 45_000 },
      );
      backoff.reset();
      for (const id of res?.cancel ?? []) cancelJob(id, "Cancelled from the dashboard");
      for (const job of res?.jobs ?? []) void runJob(job);
    } catch (e) {
      if (stopping) break;
      if (e instanceof AuthError) {
        authFailed = true;
        await sleep(60_000, stopController.signal);
      } else {
        const wait = backoff.next();
        log.debug(`Poll failed (${e.message ?? e}); retrying in ${Math.round(wait / 1000)}s`);
        await sleep(wait, stopController.signal);
      }
    }
  }
}

/* ───────────────────────────── job execution ───────────────────────────── */

const DEFAULT_SYSTEM = "You are a precise assistant used by AutoSEO, an SEO and AI-visibility platform. Answer the request directly and completely.";

function cancelJob(id, reason, opts) {
  const r = running.get(id);
  if (r && !r.cancelled) {
    log.info(`Cancelling job ${id}: ${reason}`);
    r.cancel(reason, opts);
  }
}

async function runJob(job) {
  if (running.has(job.id)) return;
  const started = Date.now();
  const entry = { job, child: null, cancelled: null, retryable: false, startedAt: started, cancel: () => {} };
  entry.cancel = (reason, { retryable = false } = {}) => {
    entry.cancelled = reason || "Cancelled";
    entry.retryable = retryable;
    if (entry.child) killTree(entry.child);
  };
  running.set(job.id, entry);
  const dir = path.join(jobsRoot(), job.id);
  const out = (text) => shipLines(job.id, "stdout", text);
  let result;
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      path.join(dir, "job.json"),
      JSON.stringify({ id: job.id, kind: job.kind, purpose: job.purpose, runtime: job.runtime, attempt: job.attempt, startedAt: new Date(started).toISOString() }, null, 2),
    );
    await detectClis();
    if (job.kind === "test") {
      result = await runSelfTest(job, dir, entry, out);
    } else {
      const runtime = job.runtime && job.runtime !== "any" ? job.runtime : effectiveRuntime();
      if (!runtime || !clis[runtime]) {
        result = { status: "failed", error: `${runtime ?? "No"} CLI is not installed on this machine`, retryable: true };
      } else {
        const mode = jobMode(job);
        const start = await apiRetry(`/api/agent/jobs/${job.id}/start`, { runtime, cliVersion: clis[runtime].version, workDir: dir, cliMode: mode }, 4).catch((e) => ({
          ok: false,
          cancel: true,
          error: e,
        }));
        if (!start?.ok || start.cancel) {
          result = start?.ok ? { status: "cancelled", error: "Cancelled before start" } : null;
        } else {
          log.info(`▶ ${job.kind} job ${job.id} "${job.purpose}" via ${runtime} (${mode})`);
          out(`${C.bold}${C.cyan}▶ ${job.purpose}${C.reset} ${C.dim}(${job.kind} · ${runtime} ${clis[runtime].version} · ${mode} mode · attempt ${job.attempt})${C.reset}`);
          result =
            job.kind === "chat"
              ? await runChatTask({ job, runtime, dir, entry, out, mode })
              : await runCliTask({ job, runtime, dir, entry, out, mode, prompt: job.payload?.prompt ?? "", system: job.payload?.system });
        }
      }
    }
  } catch (e) {
    result = { status: "failed", error: `Agent error: ${e?.message ?? e}`, retryable: true };
  }
  if (!result) {
    running.delete(job.id);
    if (wakePoll) wakePoll();
    log.warn(`Job ${job.id} was not started (server declined)`);
    return;
  }
  result.durationMs ??= Date.now() - started;
  try {
    fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify({ ...result, finishedAt: new Date().toISOString() }, null, 2));
    fs.writeFileSync(path.join(dir, ".done"), new Date().toISOString());
  } catch {
    /* folder may have been removed */
  }
  const secs = (result.durationMs / 1000).toFixed(1);
  if (result.status === "succeeded") out(`${C.green}✓ finished in ${secs}s${C.reset}`);
  else out(`${C.red}✗ ${result.status}${result.error ? `: ${oneLine(result.error, 300)}` : ""} (${secs}s)${C.reset}`);
  await flushLogs();
  try {
    await apiRetry(`/api/agent/jobs/${job.id}/complete`, result, 10);
    log.info(`${result.status === "succeeded" ? "✓" : "✗"} job ${job.id} ${result.status} in ${secs}s`);
  } catch (e) {
    log.error(`Could not report result of job ${job.id}: ${e.message ?? e}`);
  } finally {
    // Only now the job leaves `running`, so check-ins never report it as unknown while its result is in flight.
    running.delete(job.id);
    if (wakePoll) wakePoll();
  }
}

/*
 * JSON Schema normalization for `claude -p --json-schema` (same rules as the server's
 * src/server/agents/json-schema.ts): keep the structural core and valid patterns, drop meta keywords
 * (`$schema`), `format` and vendor keys the CLI's validator rejects. The caller validates the answer.
 */
const SCHEMA_KW = new Set(["items", "additionalProperties", "not", "contains", "propertyNames", "additionalItems"]);
const SCHEMA_LIST_KW = new Set(["anyOf", "oneOf", "allOf", "prefixItems"]);
const SCHEMA_MAP_KW = new Set(["properties", "$defs", "definitions", "patternProperties"]);
const VALUE_KW = new Set([
  "type", "required", "enum", "const", "description", "title", "default", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
  "multipleOf", "minLength", "maxLength", "minItems", "maxItems", "uniqueItems", "minProperties", "maxProperties", "$ref",
]);
const isPlainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const validPattern = (p) => {
  if (typeof p !== "string" || p.length > 2000) return false;
  try {
    new RegExp(p, "u");
    return true;
  } catch {
    return false;
  }
};

function normalizeSchemaNode(node, depth) {
  if (typeof node === "boolean") return node;
  if (!isPlainObject(node) || depth > 64) return {};
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (SCHEMA_KW.has(key)) {
      if (typeof value === "boolean" || isPlainObject(value)) out[key] = normalizeSchemaNode(value, depth + 1);
    } else if (SCHEMA_LIST_KW.has(key)) {
      if (Array.isArray(value)) out[key] = value.map((v) => normalizeSchemaNode(v, depth + 1));
    } else if (SCHEMA_MAP_KW.has(key)) {
      if (isPlainObject(value)) out[key] = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalizeSchemaNode(v, depth + 1)]));
    } else if (key === "pattern") {
      if (validPattern(value)) out[key] = value;
    } else if (VALUE_KW.has(key)) {
      if (key === "$ref" && (typeof value !== "string" || !value.startsWith("#"))) continue;
      out[key] = key === "type" && Array.isArray(value) ? value.filter((t) => typeof t === "string") : value;
    }
  }
  if (Array.isArray(out.required) && isPlainObject(out.properties)) out.required = out.required.filter((r) => typeof r === "string" && r in out.properties);
  return out;
}

export function normalizeJsonSchema(schema) {
  if (!isPlainObject(schema)) return null;
  const out = normalizeSchemaNode(schema, 0);
  return isPlainObject(out) && Object.keys(out).length ? out : null;
}

/** Runs one CLI session for a prompt and returns the job result payload. */
async function runCliTask(opts) {
  const { job, runtime, dir, entry, out, prompt, system, filePrefix = "", timeoutMs, noSchema = false, mode = "lean", chat = false, onEvent, images = [] } = opts;
  const cli = clis[runtime];
  const payload = job.payload ?? {};
  const web = !!payload.webSearch || job.kind === "web-search";
  const shell = needsShell(cli.bin);
  const sys = system || DEFAULT_SYSTEM;
  // AutoSEO's own MCP server (chat jobs): the short-lived token only travels via an environment variable.
  const mcp = payload.mcp?.url && payload.mcp?.token ? payload.mcp : null;
  const owner = job.owner === true;
  const extraEnv = {};
  let mcpFile = null;
  let stdin = prompt;
  let args;
  if (runtime === "claude") {
    const caps = cli.caps;
    args = ["-p", "--output-format", "stream-json", "--verbose"];
    if (chat && caps.partial) args.push("--include-partial-messages");
    if (caps.noSession) args.push("--no-session-persistence");
    if (caps.dontAsk) args.push("--permission-mode", "dontAsk");
    // Never the owner's settings (permission allow-rules, hooks, plugins) for server-initiated jobs; the
    // MCP server list is always explicit: AutoSEO's server + (Full only) the servers the owner exposed.
    const servers = mode === "full" ? ownerClaudeMcpServers() : {};
    if (mcp) {
      servers.autoseo = { type: "http", url: mcp.url, headers: { Authorization: "Bearer ${AUTOSEO_MCP_TOKEN}" } };
      extraEnv.AUTOSEO_MCP_TOKEN = mcp.token;
    }
    const serverNames = Object.keys(servers);
    if (serverNames.length && caps.mcpConfig && caps.strictMcp) {
      // Outside the job folder (the model may read the job folder), 0600, deleted after the run.
      fs.mkdirSync(RUN_DIR, { recursive: true, mode: 0o700 });
      mcpFile = path.join(RUN_DIR, `${job.id}-${filePrefix}${crypto.randomBytes(4).toString("hex")}.mcp.json`);
      fs.writeFileSync(mcpFile, JSON.stringify({ mcpServers: servers }), { mode: 0o600 });
      args.push("--strict-mcp-config", "--mcp-config", mcpFile, ...(caps.settingSources ? ["--setting-sources", ""] : []));
    } else if (caps.safeMode) {
      args.push("--safe-mode");
    }
    // WebFetch runs on this machine (its network): only for the owner's own jobs. WebSearch runs remotely.
    const webTools = web ? (owner ? ["WebSearch", "WebFetch"] : ["WebSearch"]) : [];
    // Chat may read its attachments (file tools are confined to the job folder by the permission mode).
    const tools = [...webTools, ...(chat ? ["Read", "Glob", "Grep"] : [])];
    const allowed = [...webTools, ...(mcpFile ? serverNames.map((n) => `mcp__${n}`) : [])];
    if (caps.tools) args.push("--tools", tools.join(","));
    if (allowed.length) args.push("--allowedTools", allowed.join(","));
    const schema = !noSchema && caps.jsonSchema ? normalizeJsonSchema(payload.jsonSchema) : null;
    if (schema) args.push("--json-schema", JSON.stringify(schema));
    if (payload.model) args.push("--model", String(payload.model));
    if (!shell && caps.systemPrompt) args.push("--system-prompt", sys);
    else stdin = `<instructions>\n${sys}\n</instructions>\n\n${prompt}`;
  } else {
    const caps = cli.caps;
    args = ["exec", "--json"];
    if (caps.skipGit) args.push("--skip-git-repo-check");
    if (caps.ephemeral) args.push("--ephemeral");
    if (caps.sandbox) args.push("--sandbox", "read-only");
    // The shell can read every file on this machine (even in the read-only sandbox): off unless the
    // owner enabled it locally, and never for other people's jobs.
    if (!(localPolicy().allowCodexShell && owner)) args.push("--disable", "shell_tool");
    // Lean: without the owner's Codex config (its MCP servers etc.).
    if (mode !== "full" && caps.ignoreUserConfig) args.push("--ignore-user-config");
    args.push("-C", dir);
    if (web) args.push("-c", 'web_search="live"', "-c", "tools.web_search=true");
    if (mcp) {
      args.push("-c", `mcp_servers.autoseo.url=${JSON.stringify(mcp.url)}`, "-c", 'mcp_servers.autoseo.bearer_token_env_var="AUTOSEO_MCP_TOKEN"');
      extraEnv.AUTOSEO_MCP_TOKEN = mcp.token;
    }
    if (caps.image) for (const img of images) args.push("-i", img);
    if (payload.model) args.push("-m", String(payload.model));
    if (caps.outputLast) args.push("-o", path.join(dir, `${filePrefix}last-message.txt`));
    args.push("-");
    stdin = `<instructions>\n${sys}\n</instructions>\n\n${prompt}`;
  }
  fs.writeFileSync(path.join(dir, `${filePrefix}prompt.txt`), stdin);
  // For debugging: the exact CLI invocation (tokens only ever travel via environment variables).
  fs.writeFileSync(path.join(dir, `${filePrefix}command.json`), JSON.stringify({ bin: cli.bin, args, mode, owner, env: Object.keys(extraEnv) }, null, 2));
  const rawOut = fs.createWriteStream(path.join(dir, `${filePrefix}output.jsonl`));
  const rawErr = fs.createWriteStream(path.join(dir, `${filePrefix}stderr.log`));
  const limitMs = Math.max(5_000, Math.min(timeoutMs ?? job.timeoutMs ?? settings.jobTimeoutMinutes * 60_000, settings.jobTimeoutMinutes * 60_000));
  const started = Date.now();
  const parser = runtime === "claude" ? new ClaudeStream(out, onEvent) : new CodexStream(out, onEvent);

  const exit = await new Promise((resolve) => {
    let child;
    try {
      child = spawnCli(cli.bin, args, { cwd: dir, env: childEnv(extraEnv), stdio: ["pipe", "pipe", "pipe"], detached: !IS_WIN });
    } catch (e) {
      return resolve({ code: -1, spawnError: String(e?.message ?? e) });
    }
    entry.child = child;
    if (entry.cancelled) killTree(child);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      out(`${C.yellow}⏱ timeout after ${Math.round(limitMs / 1000)}s — stopping CLI${C.reset}`);
      killTree(child);
      setTimeout(() => killTree(child, "SIGKILL"), 5000);
    }, limitMs);
    let buf = "";
    let errTail = "";
    child.stdout.on("data", (d) => {
      rawOut.write(d);
      buf += d.toString("utf8");
      let i;
      while ((i = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) parser.line(line);
      }
    });
    child.stderr.on("data", (d) => {
      rawErr.write(d);
      const s = d.toString("utf8");
      errTail = (errTail + s).slice(-8000);
      const lines = s
        .split(/\r?\n/)
        .filter((l) => l.trim() && !/rmcp::transport|^\d{4}-\d\d-\d\dT.*\b(ERROR|WARN)\b.*mcp/i.test(l));
      if (lines.length) shipLines(job.id, "stderr", lines.map((l) => truncate(l, 2000)).join("\n"));
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, spawnError: String(e?.message ?? e), errTail });
    });
    child.on("close", (code, sig) => {
      clearTimeout(timer);
      if (buf.trim()) parser.line(buf.trim());
      resolve({ code: code ?? -1, signal: sig, timedOut, errTail });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(stdin);
  });
  entry.child = null;
  rawOut.end();
  rawErr.end();
  if (mcpFile) fs.rmSync(mcpFile, { force: true });
  const durationMs = Date.now() - started;
  const base = { runtime, cliVersion: cli.version, exitCode: exit.code, durationMs };

  if (entry.cancelled) {
    // Stopped by this machine (shutdown / update), not by the user → let another agent retry it.
    if (entry.retryable) return { ...base, status: "failed", error: entry.cancelled, retryable: true };
    return { ...base, status: "cancelled", error: entry.cancelled };
  }
  if (exit.spawnError) return { ...base, status: "failed", error: `Could not start ${runtime}: ${exit.spawnError}`, retryable: true };
  if (exit.timedOut) return { ...base, status: "timeout", error: `Timed out after ${Math.round(limitMs / 1000)}s` };

  const r = parser.result();
  if (runtime === "codex" && cli.caps.outputLast) {
    try {
      const last = fs.readFileSync(path.join(dir, `${filePrefix}last-message.txt`), "utf8").trim();
      if (last) r.text = last;
    } catch {
      /* not written */
    }
  }
  if (r.error || (exit.code !== 0 && !r.text)) {
    const err = r.error || oneLine(exit.errTail, 1500) || `${runtime} exited with code ${exit.code}`;
    if (runtime === "claude" && !noSchema && payload.jsonSchema && /json-schema/i.test(err)) {
      out(`${C.yellow}⚠ Claude Code rejected the JSON schema — retrying with prompt-only JSON instructions${C.reset}`);
      return runCliTask({ ...opts, noSchema: true, filePrefix: `${filePrefix}retry-` });
    }
    const machineIssue = classifyCliError(runtime, err);
    return { ...base, status: "failed", error: err, model: r.model, usage: r.usage, retryable: !!machineIssue };
  }
  const text = r.text ?? "";
  let json;
  if (r.structured !== undefined) json = r.structured;
  else if (payload.jsonSchema) json = extractJson(text);
  const citations = web ? dedupeCitations([...linksFromText(text), ...(r.citations ?? [])]) : dedupeCitations(r.citations ?? []);
  return { ...base, status: "succeeded", text: r.structured !== undefined ? JSON.stringify(r.structured) : text, json, citations, model: r.model, usage: r.usage };
}

const cliWarnings = new Map();

/**
 * Failures caused by this machine's CLI setup (not logged in, usage limit, overloaded) are retried on
 * another agent and surfaced in the dashboard activity log.
 */
function classifyCliError(runtime, err) {
  const label = runtime === "claude" ? "Claude Code" : "Codex";
  let hint = null;
  if (/not logged in|please run \/login|codex login|invalid api key|authentication_error|oauth token (has )?expired|unauthorized/i.test(err))
    hint = `${label} is not logged in on this machine — run \`${runtime === "claude" ? "claude" : "codex login"}\` once in a terminal.`;
  else if (/usage limit|rate.?limit|quota|429|overloaded|529/i.test(err)) hint = `${label} hit a usage/rate limit on this machine.`;
  if (!hint) return null;
  const last = cliWarnings.get(hint) ?? 0;
  if (Date.now() - last > 10 * 60_000) {
    cliWarnings.set(hint, Date.now());
    log.warn(hint);
    pushEvent({ type: "cli_problem", level: "warning", message: hint, meta: { runtime, error: truncate(err, 500) } });
  }
  return hint;
}

function toolResultText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => (c?.type === "text" ? c.text : c?.type ? `[${c.type}]` : JSON.stringify(c))).join("\n");
  return content == null ? "" : JSON.stringify(content);
}

/**
 * Pretty-prints Claude Code stream-json events (live terminal) and collects the result. With
 * `onEvent` it also emits structured chat events (text/thinking deltas, tool calls/results).
 */
class ClaudeStream {
  constructor(out, onEvent) {
    this.out = out;
    this.emit = onEvent ?? null;
    this.text = null;
    this.lastAssistantText = "";
    this.model = null;
    this.citations = [];
    this.error = null;
    this.structured = undefined;
    this.usage = null;
    this.tools = new Map();
    this.streamedMsgs = new Set();
    this.curMsg = null;
    this.anyText = false;
  }
  text_(delta) {
    if (!this.emit || !delta) return;
    this.emit({ type: "text", delta });
    this.anyText = true;
  }
  line(line) {
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      this.out(`${C.dim}${truncate(line, 500)}${C.reset}`);
      return;
    }
    const o = this.out;
    if (ev.type === "stream_event" && ev.event) {
      // Partial message chunks (--include-partial-messages): forward deltas only.
      const e = ev.event;
      if (ev.parent_tool_use_id) return;
      if (e.type === "message_start") this.curMsg = e.message?.id ?? null;
      else if (e.type === "content_block_start" && e.content_block?.type === "text" && this.anyText) this.text_("\n\n");
      else if (e.type === "content_block_start" && (e.content_block?.type === "thinking" || e.content_block?.type === "redacted_thinking")) {
        // Thinking is often redacted (empty deltas): still tell the UI that the model is thinking.
        if (this.curMsg) this.streamedMsgs.add(this.curMsg);
        this.out(`${C.dim}✻ thinking…${C.reset}`);
        if (this.emit) this.emit({ type: "thinking", delta: "" });
      }
      else if (e.type === "content_block_delta" && e.delta?.type === "text_delta") {
        if (this.curMsg) this.streamedMsgs.add(this.curMsg);
        this.text_(e.delta.text);
      } else if (e.type === "content_block_delta" && e.delta?.type === "thinking_delta" && this.emit && e.delta.thinking) {
        if (this.curMsg) this.streamedMsgs.add(this.curMsg);
        this.emit({ type: "thinking", delta: e.delta.thinking });
      }
      return;
    }
    if (ev.type === "system" && ev.subtype === "init") {
      this.model = ev.model ?? this.model;
      const mcp = (ev.mcp_servers ?? []).map((m) => `${m.name}${m.status && m.status !== "connected" ? `(${m.status})` : ""}`).join(", ");
      o(`${C.dim}● session ${String(ev.session_id ?? "").slice(0, 8)} · model ${ev.model ?? "?"} · tools ${ev.tools?.length ?? 0} · mcp ${mcp || "none"}${C.reset}`);
    } else if (ev.type === "assistant" && ev.message) {
      this.model = ev.message.model ?? this.model;
      const streamed = this.streamedMsgs.has(ev.message.id);
      const sub = !!ev.parent_tool_use_id;
      for (const block of ev.message.content ?? []) {
        if (block.type === "text" && block.text) {
          if (!sub) this.lastAssistantText = block.text;
          o(block.text);
          if (!streamed && !sub) {
            if (this.anyText) this.text_("\n\n");
            this.text_(block.text);
          }
        } else if (block.type === "thinking") {
          if (block.thinking) o(`${C.dim}✻ ${truncate(block.thinking, 2000)}${C.reset}`);
          else if (!streamed) o(`${C.dim}✻ thinking…${C.reset}`);
          if (!streamed && !sub && block.thinking && this.emit) this.emit({ type: "thinking", delta: block.thinking });
        } else if (block.type === "tool_use") {
          this.tools.set(block.id, block.name);
          if (block.name === "StructuredOutput") {
            this.structured = block.input;
            o(`${C.magenta}⚙ StructuredOutput${C.reset} ${C.dim}${oneLine(block.input, 400)}${C.reset}`);
          } else {
            o(`${C.cyan}⚙ ${block.name}${C.reset} ${C.dim}${oneLine(block.input, 240)}${C.reset}`);
            if (this.emit) this.emit({ type: "tool_call", id: String(block.id), name: String(block.name), input: block.input ?? null });
          }
        }
      }
    } else if (ev.type === "user" && ev.message) {
      for (const block of ev.message.content ?? []) {
        if (block.type !== "tool_result") continue;
        const name = this.tools.get(block.tool_use_id) ?? "tool";
        const content = toolResultText(block.content);
        if (block.is_error) o(`${C.red}  ↳ ${name} error: ${oneLine(content, 300)}${C.reset}`);
        else o(`${C.green}  ↳ ${name}${C.reset} ${C.dim}${formatBytes(content.length)}${C.reset}`);
        if (this.emit && name !== "StructuredOutput") {
          this.emit({ type: "tool_result", id: String(block.tool_use_id), output: truncate(content, 8000), isError: !!block.is_error });
        }
      }
      const r = ev.tool_use_result;
      if (r && typeof r === "object") {
        for (const item of r.results ?? []) {
          for (const c of Array.isArray(item?.content) ? item.content : []) if (c?.url) this.citations.push({ url: c.url, title: c.title });
        }
        if (typeof r.url === "string" && r.code >= 200 && r.code < 400) this.citations.push({ url: r.url });
      }
    } else if (ev.type === "result") {
      this.usage = { ...(ev.usage ?? {}), total_cost_usd: ev.total_cost_usd, num_turns: ev.num_turns, duration_api_ms: ev.duration_api_ms };
      if (ev.structured_output !== undefined && ev.structured_output !== null) this.structured = ev.structured_output;
      if (ev.is_error || (ev.subtype && ev.subtype !== "success")) {
        this.error = typeof ev.result === "string" && ev.result ? ev.result : `Claude Code finished with ${ev.subtype ?? "an error"}`;
        if (Array.isArray(ev.errors) && ev.errors.length) this.error += ` (${ev.errors.map((x) => oneLine(x, 200)).join("; ")})`;
      } else {
        this.text = typeof ev.result === "string" ? ev.result : this.lastAssistantText;
      }
      const cost = typeof ev.total_cost_usd === "number" ? ` · $${ev.total_cost_usd.toFixed(4)}` : "";
      o(`${C.dim}● ${ev.num_turns ?? 1} turn(s) · ${ev.usage?.output_tokens ?? "?"} output tokens${cost}${C.reset}`);
    } else if (ev.type === "rate_limit_event" && ev.rate_limit_info?.status && ev.rate_limit_info.status !== "allowed") {
      const info = ev.rate_limit_info;
      const window = info.rateLimitType ? ` (${String(info.rateLimitType).replace(/_/g, " ")} window)` : "";
      o(`${C.yellow}⚠ ${info.status === "allowed_warning" ? "approaching the usage limit" : `rate limited: ${info.status}`}${window}${C.reset}`);
    }
  }
  result() {
    return {
      text: this.text ?? (this.error ? null : this.lastAssistantText || null),
      model: this.model,
      citations: this.citations,
      error: this.error,
      structured: this.structured,
      usage: this.usage,
    };
  }
}

/** Pretty-prints Codex `exec --json` events and collects the result (+ structured chat events). */
class CodexStream {
  constructor(out, onEvent) {
    this.out = out;
    this.emit = onEvent ?? null;
    this.text = null;
    this.error = null;
    this.usage = null;
    this.citations = [];
    this.anyText = false;
  }
  line(line) {
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      this.out(`${C.dim}${truncate(line, 500)}${C.reset}`);
      return;
    }
    const o = this.out;
    const e = this.emit;
    const item = ev.item;
    if (ev.type === "thread.started") o(`${C.dim}● thread ${String(ev.thread_id ?? "").slice(0, 8)}${C.reset}`);
    else if ((ev.type === "item.completed" || ev.type === "item.started") && item) {
      const done = ev.type === "item.completed";
      const id = String(item.id ?? "");
      switch (item.type) {
        case "agent_message":
          if (done && item.text) {
            this.text = item.text;
            o(item.text);
            if (e) {
              e({ type: "text", delta: `${this.anyText ? "\n\n" : ""}${item.text}` });
              this.anyText = true;
            }
          }
          break;
        case "reasoning":
          if (done && item.text) {
            o(`${C.dim}✻ ${truncate(item.text, 2000)}${C.reset}`);
            if (e) e({ type: "thinking", delta: item.text });
          }
          break;
        case "command_execution":
          if (!done) {
            o(`${C.cyan}$ ${oneLine(item.command, 300)}${C.reset}`);
            if (e) e({ type: "tool_call", id, name: "shell", input: { command: item.command } });
          } else {
            if (item.exit_code != null && item.exit_code !== 0) o(`${C.red}  ↳ exit ${item.exit_code}${C.reset}`);
            if (e) e({ type: "tool_result", id, output: truncate(String(item.aggregated_output ?? ""), 8000), isError: item.exit_code != null && item.exit_code !== 0 });
          }
          break;
        case "web_search":
          if (done) {
            const query = item.query || item.action?.query || "";
            o(`${C.cyan}⌕ web search${C.reset} ${C.dim}${oneLine(query, 200)}${C.reset}`);
            if (e) {
              e({ type: "tool_call", id, name: "web_search", input: { query } });
              e({ type: "tool_result", id, output: "" });
            }
          }
          break;
        case "mcp_tool_call": {
          const name = `mcp__${item.server ?? "mcp"}__${item.tool ?? "tool"}`;
          if (!done) {
            o(`${C.cyan}⚙ ${item.server ?? "mcp"}.${item.tool ?? "tool"}${C.reset} ${C.dim}${oneLine(item.arguments ?? "", 200)}${C.reset}`);
            if (e) e({ type: "tool_call", id, name, input: item.arguments ?? null });
          } else if (e) {
            const failed = !!item.error || item.status === "failed";
            e({ type: "tool_result", id, output: truncate(toolResultText(item.error ?? item.result?.content ?? item.result ?? ""), 8000), isError: failed });
          }
          break;
        }
        case "error":
          o(`${C.red}✗ ${oneLine(item.message, 400)}${C.reset}`);
          break;
        default:
          if (done) o(`${C.dim}· ${item.type}${C.reset}`);
      }
    } else if (ev.type === "turn.completed") {
      this.usage = ev.usage ?? null;
      o(`${C.dim}● ${ev.usage?.output_tokens ?? "?"} output tokens${C.reset}`);
    } else if (ev.type === "turn.failed") {
      this.error = ev.error?.message ?? "Codex turn failed";
    } else if (ev.type === "error") {
      this.error = ev.message ?? "Codex error";
    }
  }
  result() {
    return { text: this.text, model: null, citations: this.citations, error: this.error && !this.text ? this.error : null, usage: this.usage };
  }
}

/* ───────────────────────────── chat jobs ───────────────────────────── */

/**
 * CLI mode for a job. The dashboard setting (or the job's Auto hint) can only ask for Full; it is used
 * only when the owner allowed Full locally AND the job was requested by this machine's owner.
 */
function jobMode(job) {
  let wanted;
  if (settings.cliProfile === "lean" || settings.cliProfile === "full") wanted = settings.cliProfile;
  else wanted = job.payload?.mode === "full" || job.payload?.mode === "lean" ? job.payload.mode : job.kind === "chat" ? "full" : "lean";
  if (wanted === "full" && (!localPolicy().allowFull || job.owner !== true)) return "lean";
  return wanted;
}

/** The owner's user-scope Claude MCP servers that Full mode may expose (from ~/.claude.json). */
function ownerClaudeMcpServers() {
  const policy = localPolicy();
  if (!policy.allowFull) return {};
  const file = process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, ".claude.json") : path.join(os.homedir(), ".claude.json");
  let servers = {};
  try {
    servers = JSON.parse(fs.readFileSync(file, "utf8")).mcpServers ?? {};
  } catch {
    return {};
  }
  const out = {};
  for (const [name, def] of Object.entries(servers)) {
    if (name === "autoseo" || !isPlainObject(def)) continue;
    if (policy.mcpServers !== "all" && !policy.mcpServers.includes(name)) continue;
    out[name] = def;
  }
  return out;
}

/** Buffers structured chat events and ships them strictly in order (text deltas are coalesced). */
class ChatEmitter {
  constructor(jobId, onCancel) {
    this.jobId = jobId;
    this.onCancel = onCancel;
    this.queue = [];
    this.timer = null;
    this.chain = Promise.resolve();
    this.dead = false;
  }
  push(ev) {
    if (this.dead) return;
    const last = this.queue.at(-1);
    if (last && (ev.type === "text" || ev.type === "thinking") && last.type === ev.type && last.delta.length + ev.delta.length < 16_000) last.delta += ev.delta;
    else this.queue.push({ ...ev });
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.schedule();
      }, 120);
    }
  }
  schedule() {
    this.chain = this.chain.then(() => this.sendAll()).catch(() => {});
    return this.chain;
  }
  async sendAll() {
    while (this.queue.length && !this.dead) await this.send(this.queue.splice(0, 200));
  }
  async send(batch) {
    const backoff = new Backoff(500, 5000);
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const res = await api(`/api/agent/jobs/${this.jobId}/events`, { events: batch }, { timeoutMs: 15_000 });
        if (res?.cancel) this.onCancel("Cancelled");
        return;
      } catch (e) {
        if (e instanceof HttpError && e.status === 409) {
          this.dead = true;
          this.onCancel("The server no longer accepts events for this job");
          return;
        }
        if (e instanceof AuthError || stopping) return;
        await sleep(backoff.next());
      }
    }
  }
  /** Sends everything still buffered (call before completing the job). */
  async close() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.schedule();
  }
}

const TEXT_MIME = /^(text\/|application\/(json|xml|csv|x-yaml|yaml|javascript|x-ndjson))/i;

function safeFileName(name, taken) {
  let base = path.basename(String(name || "file")).replace(/[^\w.\- ]+/g, "_").replace(/^\.+/, "").slice(0, 120) || "file";
  let candidate = base;
  for (let i = 2; taken.has(candidate.toLowerCase()); i++) {
    const ext = path.extname(base);
    candidate = `${path.basename(base, ext)}-${i}${ext}`;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

/** Chat turn: transcript replay + attachments in the job folder, streamed structured events. */
async function runChatTask({ job, runtime, dir, entry, out, mode }) {
  const payload = job.payload ?? {};
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const last = messages.at(-1);
  if (!last || last.role !== "user") return { status: "failed", error: "Chat job without a user message" };

  // Attachments → ./attachments/ (small text files are also inlined, so every mode can use them).
  const files = [];
  const images = [];
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
  if (attachments.length) {
    const adir = path.join(dir, "attachments");
    fs.mkdirSync(adir, { recursive: true, mode: 0o700 });
    const taken = new Set();
    for (const a of attachments) {
      const name = safeFileName(a.name, taken);
      const buf = Buffer.from(String(a.dataBase64 ?? ""), "base64");
      fs.writeFileSync(path.join(adir, name), buf, { mode: 0o600 });
      const isText = TEXT_MIME.test(a.mimeType ?? "") && buf.length <= 100_000;
      files.push({ name, mimeType: a.mimeType || "application/octet-stream", size: buf.length, inline: isText ? buf.toString("utf8") : null });
      if (/^image\//i.test(a.mimeType ?? "")) images.push(path.join(adir, name));
    }
  }

  const history = messages.slice(0, -1);
  let prompt = "";
  if (history.length) {
    prompt += "Conversation so far (you are the assistant; continue it):\n\n";
    prompt += history.map((m) => `<${m.role === "assistant" ? "assistant" : "user"}>\n${m.content}\n</${m.role === "assistant" ? "assistant" : "user"}>`).join("\n\n");
    prompt += "\n\n";
  }
  if (files.length) {
    prompt += "The user attached these files (saved in ./attachments/):\n";
    prompt += files.map((f) => `- ${f.name} (${f.mimeType}, ${formatBytes(f.size)})`).join("\n");
    prompt += "\n\n";
    for (const f of files.filter((x) => x.inline != null)) prompt += `<file name="attachments/${f.name}">\n${f.inline}\n</file>\n\n`;
  }
  prompt += history.length ? `Latest user message:\n\n${last.content}` : last.content;

  const emitter = new ChatEmitter(job.id, (reason) => cancelJob(job.id, reason));
  out(`${C.dim}● chat · ${messages.length} message(s) · ${files.length} attachment(s) · MCP ${payload.mcp?.url ? "AutoSEO + " : ""}${mode === "full" ? "local servers" : "none of the local servers"}${C.reset}`);
  const result = await runCliTask({
    job,
    runtime,
    dir,
    entry,
    out,
    mode,
    chat: true,
    images,
    prompt,
    system: payload.system || "You are AutoSEO's assistant for SEO and AI visibility (GEO). Use the AutoSEO tools when they help, and answer concisely in the user's language.",
    onEvent: (ev) => emitter.push(ev),
  });
  // Every event must be stored before the job is completed (the server ends the stream on completion).
  await emitter.close();
  return result;
}

/** Self-test: asks each CLI for a tiny JSON health payload (no credentials, no repo). */
async function runSelfTest(job, dir, entry, out) {
  const wanted = Array.isArray(job.payload?.testRuntimes) && job.payload.testRuntimes.length ? job.payload.testRuntimes : [effectiveRuntime()].filter(Boolean);
  const runtimeLabel = wanted.find((r) => clis[r]) ?? effectiveRuntime() ?? "claude";
  const start = await apiRetry(`/api/agent/jobs/${job.id}/start`, { runtime: runtimeLabel, cliVersion: clis[runtimeLabel]?.version ?? null, workDir: dir }, 4).catch(() => null);
  if (!start?.ok || start.cancel) return start?.ok ? { status: "cancelled", error: "Cancelled before start" } : null;
  out(`${C.bold}${C.cyan}▶ Self-test${C.reset} ${C.dim}agent ${AGENT_VERSION} · node ${process.versions.node} · ${os.hostname()}${C.reset}`);
  const checks = [];
  if (!wanted.length) {
    checks.push({ runtime: null, ok: false, error: "Neither Claude Code nor Codex is installed (or not on PATH)" });
  }
  for (const runtime of wanted) {
    if (entry.cancelled) break;
    const cli = clis[runtime];
    if (!cli) {
      checks.push({ runtime, ok: false, error: `${runtime} is not installed or not on PATH` });
      out(`${C.red}✗ ${runtime}: not installed${C.reset}`);
      continue;
    }
    const nonce = crypto.randomBytes(4).toString("hex");
    out(`${C.cyan}→ ${runtime} ${cli.version}${C.reset} ${C.dim}(${cli.bin})${C.reset}`);
    const t0 = Date.now();
    const r = await runCliTask({
      job: { ...job, kind: "llm", payload: {} },
      runtime,
      dir,
      entry,
      out,
      prompt: `This is an automated health check. Reply with only this JSON object and nothing else: {"ok": true, "check": "${nonce}"}`,
      system: "You are a health-check responder. Output exactly the requested JSON.",
      filePrefix: `${runtime}-`,
      timeoutMs: 150_000,
    });
    const latencyMs = Date.now() - t0;
    const parsed = extractJson(r.text ?? "");
    const ok = r.status === "succeeded" && parsed?.ok === true && parsed?.check === nonce;
    checks.push({
      runtime,
      cliVersion: cli.version,
      ok,
      latencyMs,
      model: r.model ?? null,
      error: ok ? null : r.error || (r.status === "succeeded" ? `Unexpected answer: ${oneLine(r.text, 200)}` : r.status),
    });
    out(ok ? `${C.green}✓ ${runtime} answered in ${(latencyMs / 1000).toFixed(1)}s${C.reset}` : `${C.red}✗ ${runtime}: ${checks.at(-1).error}${C.reset}`);
  }
  if (entry.cancelled) return { status: entry.retryable ? "failed" : "cancelled", error: entry.cancelled };
  const ok = checks.length > 0 && checks.every((c) => c.ok);
  const health = {
    ok,
    agentVersion: AGENT_VERSION,
    hostname: os.hostname(),
    os: `${process.platform} ${os.release()}`,
    arch: process.arch,
    node: process.versions.node,
    workDir: effectiveWorkDir(),
    maxParallel: maxParallel(),
    cliProfile: settings.cliProfile,
    clis: { claude: clis.claude?.version ?? null, codex: clis.codex?.version ?? null },
    checks,
  };
  const summary = checks.map((c) => `${c.runtime ?? "cli"} ${c.cliVersion ?? ""}: ${c.ok ? `OK in ${(c.latencyMs / 1000).toFixed(1)}s` : `FAILED (${c.error})`}`).join("; ");
  return {
    status: ok ? "succeeded" : "failed",
    text: summary,
    json: health,
    runtime: checks.find((c) => c.runtime)?.runtime ?? null,
    cliVersion: checks.find((c) => c.cliVersion)?.cliVersion ?? null,
    model: checks.find((c) => c.model)?.model ?? null,
    error: ok ? null : summary,
  };
}

/* ───────────────────────────── cleanup ───────────────────────────── */

let cleaning = false;
async function cleanup(maxAgeHours, auto) {
  if (cleaning) return;
  cleaning = true;
  const root = jobsRoot();
  let removed = 0;
  let freed = 0;
  try {
    const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
    const cutoff = Date.now() - Math.max(0, maxAgeHours) * 3_600_000;
    for (const e of entries) {
      if (!e.isDirectory() || !JOB_DIR_RE.test(e.name) || running.has(e.name)) continue;
      const dir = path.join(root, e.name);
      let finishedAt;
      try {
        finishedAt = (await fsp.stat(path.join(dir, ".done"))).mtimeMs;
      } catch {
        // No marker: an interrupted job. Treat as finished once it is a day old.
        const st = await fsp.stat(dir).catch(() => null);
        if (!st || Date.now() - st.mtimeMs < 24 * 3_600_000) continue;
        finishedAt = st.mtimeMs;
      }
      if (finishedAt > cutoff) continue;
      const size = await dirSize(dir);
      await fsp.rm(dir, { recursive: true, force: true });
      removed++;
      freed += size;
    }
    workDirBytes = await dirSize(root);
    lastSizeScan = Date.now();
    const msg = `Cleanup removed ${removed} finished job folder${removed === 1 ? "" : "s"} (${formatBytes(freed)} freed)`;
    if (removed || !auto) log.info(msg);
    pushEvent({ type: "cleanup", level: "info", message: msg, meta: { removed, freedBytes: freed, auto, maxAgeHours, workDir: effectiveWorkDir() } });
  } catch (e) {
    pushEvent({ type: "cleanup_failed", level: "error", message: `Cleanup failed: ${e.message ?? e}`, meta: { auto } });
  } finally {
    cleaning = false;
  }
  if (!stopping && agentInfo) checkin().catch(() => {});
}

/* ───────────────────────────── self-update ───────────────────────────── */

/** Release key this install trusts: pinned at install time (config), else the running agent's own key. */
function trustedReleaseKey() {
  const k = config.releaseKey || (RELEASE_PUBLIC_KEY.startsWith("__") ? null : RELEASE_PUBLIC_KEY);
  return k || null;
}

/** Updates must be signed by the pinned release key (a same-origin SHA-256 alone is not enough). */
function verifyRelease(buf, signature) {
  const key = trustedReleaseKey();
  if (!key) throw new Error("no release signing key pinned — re-run the installer to update");
  if (!signature) throw new Error("the server sent no release signature");
  const pub = crypto.createPublicKey({ key: Buffer.from(key, "base64"), format: "der", type: "spki" });
  if (!crypto.verify(null, buf, pub, Buffer.from(String(signature), "base64"))) {
    throw new Error("release signature is invalid (the server's signing key changed?) — re-run the installer to trust a new key");
  }
}

async function selfUpdate(update) {
  if (updating) return;
  updating = update.version;
  log.info(`Updating agent ${AGENT_VERSION} → ${update.version}${update.forced ? " (requested from the dashboard)" : ""}`);
  const tmp = `${SELF}.download`;
  try {
    const url = new URL(update.url, `${config.host}/`);
    const res = await fetch(url, { headers: { authorization: `Bearer ${config.token}`, "user-agent": `autoseo-agent/${AGENT_VERSION}` } });
    if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    const sha = crypto.createHash("sha256").update(buf).digest("hex");
    if (sha !== update.sha256) throw new Error(`SHA-256 mismatch (expected ${update.sha256.slice(0, 12)}…, got ${sha.slice(0, 12)}…)`);
    if (!buf.includes(Buffer.from(`const AGENT_VERSION = "${update.version}"`))) throw new Error("downloaded runtime has an unexpected version");
    verifyRelease(buf, update.signature);
    fs.writeFileSync(tmp, buf, { mode: 0o755 });
    checkin("updating").catch(() => {});
    // Drain: no new jobs are taken while `updating` is set; wait for running ones.
    const drainUntil = Date.now() + 45 * 60_000;
    if (running.size) log.info(`Waiting for ${running.size} running job(s) to finish before restarting`);
    while (running.size && Date.now() < drainUntil && !stopping) await sleep(1000);
    for (const id of running.keys()) cancelJob(id, "Agent is updating", { retryable: true });
    while (running.size && !stopping) await sleep(500);
    if (stopping) throw new Error("agent is shutting down — update postponed");
    try {
      fs.copyFileSync(SELF, `${SELF}.prev`);
    } catch {
      /* first update */
    }
    fs.renameSync(tmp, SELF);
    fs.writeFileSync(UPDATE_MARKER, JSON.stringify({ from: AGENT_VERSION, to: update.version, at: new Date().toISOString() }));
    log.info(`Installed ${update.version}; restarting`);
    await shutdown(EXIT_RESTART);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    lastUpdateFailure = Date.now();
    updating = null;
    log.error(`Update failed: ${e.message ?? e}`);
    pushEvent({ type: "update_failed", level: "error", message: `Update to ${update.version} failed: ${e.message ?? e}`, meta: { to: update.version } });
  }
}

/* ───────────────────────────── lifecycle ───────────────────────────── */

async function shutdown(code = 0, reason = "Agent is shutting down") {
  if (stopping) return;
  stopping = true;
  if (code !== EXIT_RESTART) log.info(`Stopping (${reason})`);
  for (const [id, r] of running) {
    log.info(`Stopping job ${id}`);
    r.cancel(reason, { retryable: true });
  }
  const until = Date.now() + 12_000;
  while (running.size && Date.now() < until) await sleep(200);
  await flushLogs().catch(() => {});
  try {
    await api("/api/agent/checkin", checkinBody(code === EXIT_RESTART ? "updating" : "stopping"), { timeoutMs: 5000 });
  } catch {
    /* best effort */
  }
  stopController.abort();
  if (code === EXIT_RESTART && process.env.AUTOSEO_AGENT_SUPERVISED !== "1") {
    // Not running under the installed supervisor: start the new version ourselves.
    const child = spawn(process.execPath, [SELF, ...process.argv.slice(2)], { detached: true, stdio: "ignore", env: process.env });
    child.unref();
    process.exit(0);
  }
  process.exit(code);
}

function parseRunFlags(argv) {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      runtime: { type: "string" },
      workdir: { type: "string" },
      "max-parallel": { type: "string" },
      "no-auto-update": { type: "boolean" },
      host: { type: "string" },
      token: { type: "string" },
    },
  });
  return values;
}

async function cmdRun(argv) {
  const f = parseRunFlags(argv);
  if (f.runtime && ["claude", "codex", "detect"].includes(f.runtime)) localFlags.runtime = f.runtime;
  if (f.workdir) localFlags.workDir = f.workdir;
  if (f["max-parallel"]) localFlags.maxParallel = Math.max(1, Math.min(32, Number(f["max-parallel"]) || 2));
  if (f["no-auto-update"]) localFlags.noAutoUpdate = true;
  if (f.host) config.host = normalizeHost(f.host);
  if (f.token) config.token = f.token;
  if (!config.host || !config.token) {
    console.error(`Not configured. Run the installer from your AutoSEO dashboard (Local Agents → Install agent) or:\n  node ${SELF} configure --host https://… --token …`);
    process.exit(2);
  }
  if (!isAllowedHost(config.host)) {
    console.error(`Refusing to connect to ${config.host}: use https:// (plain http is only allowed for localhost / *.test).`);
    process.exit(2);
  }
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 20) {
    console.error(`Node.js >= 20 is required (found ${process.versions.node}).`);
    process.exit(2);
  }
  // Trust-on-first-use for installs that predate release signing.
  if (!config.releaseKey && !RELEASE_PUBLIC_KEY.startsWith("__")) {
    config = { ...readConfig(), releaseKey: RELEASE_PUBLIC_KEY };
    writeConfig(config);
  }
  fs.rmSync(RUN_DIR, { recursive: true, force: true });
  log.remote = (line) => ship(null, "agent", `${line}\n`);
  process.on("SIGINT", () => void shutdown(0, "SIGINT"));
  process.on("SIGTERM", () => void shutdown(0, "SIGTERM"));
  if (!IS_WIN) process.on("SIGHUP", () => void shutdown(0, "SIGHUP"));
  process.on("unhandledRejection", (e) => log.error(`Unhandled rejection: ${e?.stack ?? e}`, { remote: false }));
  process.on("uncaughtException", (e) => {
    log.error(`Crash: ${e?.stack ?? e}`, { remote: false });
    process.exit(1);
  });
  log.info(`AutoSEO agent ${AGENT_VERSION} starting (pid ${process.pid}, node ${process.versions.node}, ${process.platform}/${process.arch})`, { remote: false });
  await detectClis(true);
  log.info(`CLIs: claude ${clis.claude?.version ?? "not found"} · codex ${clis.codex?.version ?? "not found"}`, { remote: false });
  const pol = localPolicy();
  log.info(
    `Local policy: Full mode ${pol.allowFull ? `allowed (MCP servers: ${pol.mcpServers === "all" ? "all" : pol.mcpServers.join(", ") || "none"})` : "off"} · Codex shell ${pol.allowCodexShell ? "allowed" : "off"} · dashboard work dirs ${pol.allowRemoteWorkdir ? "allowed" : `only below ${baseWorkDir()}`}`,
    { remote: false },
  );
  try {
    fs.mkdirSync(jobsRoot(), { recursive: true, mode: 0o700 });
  } catch (e) {
    log.warn(`Cannot create work dir ${jobsRoot()}: ${e.message}`);
  }
  await Promise.all([checkinLoop(), pollLoop()]);
}

function cmdConfigure(argv) {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      host: { type: "string" },
      token: { type: "string" },
      runtime: { type: "string" },
      workdir: { type: "string" },
      "max-parallel": { type: "string" },
      "no-auto-update": { type: "boolean" },
      "auto-update": { type: "boolean" },
      autostart: { type: "string" },
      path: { type: "string" },
      "allow-full": { type: "string" },
      "mcp-servers": { type: "string" },
      "allow-codex-shell": { type: "string" },
      "allow-remote-workdir": { type: "string" },
    },
  });
  const cfg = readConfig();
  if (values.host) cfg.host = normalizeHost(values.host);
  if (cfg.host && !isAllowedHost(cfg.host)) {
    console.error(`--host must use https:// (plain http is only allowed for localhost / *.test): ${cfg.host}`);
    process.exit(2);
  }
  const yesNo = (v, name) => {
    if (v === undefined) return undefined;
    if (["yes", "true", "1", "on"].includes(String(v).toLowerCase())) return true;
    if (["no", "false", "0", "off"].includes(String(v).toLowerCase())) return false;
    console.error(`--${name} must be yes or no`);
    process.exit(2);
  };
  const allowFull = yesNo(values["allow-full"], "allow-full");
  if (allowFull !== undefined) cfg.allowFull = allowFull;
  const codexShell = yesNo(values["allow-codex-shell"], "allow-codex-shell");
  if (codexShell !== undefined) cfg.allowCodexShell = codexShell;
  const remoteWd = yesNo(values["allow-remote-workdir"], "allow-remote-workdir");
  if (remoteWd !== undefined) cfg.allowRemoteWorkdir = remoteWd;
  if (values["mcp-servers"] !== undefined) {
    const v = String(values["mcp-servers"]).trim();
    cfg.mcpServers = v === "all" || v === "" ? "all" : v === "none" ? [] : v.split(",").map((x) => x.trim()).filter(Boolean);
  }
  // Pin the release signing key of the runtime being installed (re-installing re-pins).
  if (!RELEASE_PUBLIC_KEY.startsWith("__")) cfg.releaseKey = RELEASE_PUBLIC_KEY;
  // The installers pass the token via the environment so it never shows up in `ps` output.
  const token = values.token ?? process.env.AUTOSEO_AGENT_TOKEN;
  if (token) cfg.token = String(token).trim();
  if (values.runtime) {
    if (!["claude", "codex", "detect"].includes(values.runtime)) {
      console.error("--runtime must be claude, codex or detect");
      process.exit(2);
    }
    cfg.runtime = values.runtime;
  }
  if (values.workdir !== undefined) cfg.workDir = values.workdir ? path.resolve(expandHome(values.workdir)) : null;
  if (values["max-parallel"]) cfg.maxParallel = Math.max(1, Math.min(32, Number(values["max-parallel"]) || 2));
  if (values["no-auto-update"]) cfg.noAutoUpdate = true;
  if (values["auto-update"]) cfg.noAutoUpdate = false;
  if (values.autostart) cfg.autostart = values.autostart;
  if (values.path) cfg.path = values.path;
  cfg.runtime ??= "detect";
  cfg.installDir = HOME_DIR;
  cfg.updatedAt = new Date().toISOString();
  if (!cfg.host || !cfg.token) {
    console.error("configure needs --host and --token");
    process.exit(2);
  }
  writeConfig(cfg);
  console.log(`Saved ${CONFIG_FILE}`);
}

async function cmdDoctor() {
  if (!config.host || !config.token) {
    console.error("Not configured (missing host/token).");
    process.exit(2);
  }
  await detectClis(true);
  const line = (ok, label, detail) => console.log(`  ${ok ? `${C.green}✓` : `${C.yellow}!`}${C.reset} ${label}${detail ? ` ${C.dim}${detail}${C.reset}` : ""}`);
  line(true, `Node.js ${process.versions.node}`);
  line(!!clis.claude, `Claude Code ${clis.claude?.version ?? "not found"}`, clis.claude?.bin);
  line(!!clis.codex, `Codex ${clis.codex?.version ?? "not found"}`, clis.codex?.bin);
  try {
    const res = await api("/api/agent/checkin", { ...checkinBody("idle"), probe: true }, { timeoutMs: 20_000 });
    line(true, `Connected to ${config.host} as "${res.agent.name}"`, `runtime ${effectiveRuntime() ?? "none"}`);
    if (!clis.claude && !clis.codex) {
      console.log(`\n  ${C.yellow}Install Claude Code (https://claude.com/claude-code) or Codex (https://developers.openai.com/codex) so the agent can run jobs.${C.reset}`);
    }
    process.exit(0);
  } catch (e) {
    if (e instanceof AuthError) {
      console.error(`  ${C.red}✗ Token rejected by ${config.host}: ${e.message}${C.reset}`);
      process.exit(3);
    }
    console.error(`  ${C.red}✗ Cannot reach ${config.host}: ${e.message ?? e}${C.reset}`);
    process.exit(4);
  }
}

async function cmdStatus() {
  await detectClis(true);
  const masked = config.token ? `${String(config.token).slice(0, 10)}…` : "(none)";
  console.log(
    JSON.stringify(
      {
        version: AGENT_VERSION,
        configFile: CONFIG_FILE,
        host: config.host ?? null,
        token: masked,
        runtime: config.runtime ?? "detect",
        workDir: effectiveWorkDir(),
        maxParallel: maxParallel(),
        noAutoUpdate: noAutoUpdate(),
        autostart: config.autostart ?? null,
        localPolicy: localPolicy(),
        releaseKeyPinned: !!trustedReleaseKey(),
        claude: clis.claude ? { version: clis.claude.version, bin: clis.claude.bin } : null,
        codex: clis.codex ? { version: clis.codex.version, bin: clis.codex.bin } : null,
        logs: path.join(LOG_DIR, "agent.log"),
      },
      null,
      2,
    ),
  );
}

async function main() {
  const [cmd = "run", ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "run":
      return cmdRun(rest);
    case "configure":
      return cmdConfigure(rest);
    case "doctor":
      return cmdDoctor();
    case "status":
      return cmdStatus();
    case "cleanup":
      await cleanup(0, false);
      console.log(pendingEvents.at(-1)?.message ?? "done");
      return;
    case "version":
    case "--version":
    case "-v":
      console.log(AGENT_VERSION);
      return;
    default:
      if (cmd.startsWith("--")) return cmdRun([cmd, ...rest]);
      console.log("Usage: node agent.mjs [run|configure|doctor|status|cleanup|version]");
      process.exit(2);
  }
}

// Run only when executed directly (the file is also imported by unit tests).
const realPath = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
};
if (process.argv[1] && realPath(path.resolve(process.argv[1])) === realPath(SELF)) {
  main().catch((e) => {
    log.error(`Fatal: ${e?.stack ?? e}`, { remote: false });
    process.exit(1);
  });
}
