"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Apple, CheckCircle2, ChevronDown, KeyRound, Loader2, Monitor, ShieldCheck, Terminal } from "lucide-react";
import { AgentOrb } from "@/components/agent-ui";
import { CopyButton } from "@/components/app/misc";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { refreshAgentDataAction, type InstallResult } from "../actions";

type Platform = "unix" | "windows";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "unix";
  return /Windows/i.test(navigator.userAgent) ? "windows" : "unix";
}

export function CodeBlock({ code, className, label }: { code: string; className?: string; label?: string }) {
  return (
    <div className={cn("group relative min-w-0 overflow-hidden rounded-xl border bg-[#0c0c0d] text-[#e7e6e1]", className)}>
      {label && (
        <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5 text-[11px] text-white/50">
          <span>{label}</span>
        </div>
      )}
      <div className="flex items-start gap-2 p-3">
        <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-all">
          <span className="text-emerald-400 select-none">$ </span>
          {code}
        </pre>
        <CopyButton value={code} size="icon" className="shrink-0 text-white/70 hover:bg-white/10 hover:text-white" />
      </div>
    </div>
  );
}

const FLAGS: { unix: string; windows: string; text: string }[] = [
  { unix: "--runtime claude|codex|detect", windows: "-Runtime claude|codex|detect", text: "CLI to use (dashboard setting overrides it). Default: detect." },
  { unix: "--workdir <dir>", windows: "-WorkDir <dir>", text: "Folder for job sessions. Default: OS temp directory." },
  { unix: "--max-parallel <n>", windows: "-MaxParallel <n>", text: "Parallel jobs on this machine." },
  { unix: "--no-auto-update", windows: "-NoAutoUpdate", text: "Never self-update (re-run the installer to update)." },
  { unix: "--no-autostart", windows: "-NoAutostart", text: "Skip launchd / systemd / Scheduled Task registration." },
  { unix: "--mcp-servers a,b | all | none", windows: "-McpServers a,b", text: "Which of your Claude Code MCP servers Full mode exposes (default: all user-scope servers)." },
  { unix: "--allow-codex-shell", windows: "-AllowCodexShell", text: "Let Codex use its read-only shell tool for your own jobs (off by default)." },
  { unix: "--allow-remote-workdir", windows: "-AllowRemoteWorkdir", text: "Accept work directories set in the dashboard outside --workdir." },
];

/** OS tabs with copyable install (and uninstall) commands. */
export function InstallCommandTabs({
  commands,
  showUninstall = true,
}: {
  commands: InstallResult["commands"];
  showUninstall?: boolean;
}) {
  // Rendered inside dialogs only (client-side), so reading the user agent here is hydration-safe.
  const [platform, setPlatform] = useState<Platform>(detectPlatform);
  const [showFlags, setShowFlags] = useState(false);
  const [allowFull, setAllowFull] = useState(true);
  const command = platform === "unix" ? commands.unix + (allowFull ? " --allow-full" : "") : commands.windows + (allowFull ? " -AllowFull" : "");
  const tabs: { key: Platform; label: string; icon: React.ReactNode; hint: string }[] = [
    { key: "unix", label: "macOS / Linux", icon: <Apple className="size-3.5" />, hint: "Terminal (bash). Sets up a launchd agent (macOS) or a systemd user service (Linux)." },
    { key: "windows", label: "Windows", icon: <Monitor className="size-3.5" />, hint: "PowerShell. Registers a Scheduled Task that starts at logon." },
  ];
  const active = tabs.find((t) => t.key === platform)!;
  return (
    <div className="min-w-0 space-y-3">
      <div className="inline-flex rounded-lg bg-muted p-[3px]" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={platform === t.key}
            onClick={() => setPlatform(t.key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors",
              platform === t.key ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{active.hint}</p>
      <CodeBlock code={command} />
      <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-xs">
        <input type="checkbox" className="mt-0.5 size-3.5 accent-foreground" checked={allowFull} onChange={(e) => setAllowFull(e.target.checked)} />
        <span>
          <span className="font-medium text-foreground">Allow Full mode for my own work</span>{" "}
          <span className="text-muted-foreground">
            ({platform === "unix" ? "--allow-full" : "-AllowFull"}) — your chats and agentic tasks may use this machine&apos;s Claude Code MCP servers.
            Jobs of other people always run Lean, and the dashboard can never turn this on for you.
          </span>
        </span>
      </label>
      <button
        type="button"
        onClick={() => setShowFlags((v) => !v)}
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={cn("size-3.5 transition-transform", showFlags && "rotate-180")} />
        Optional flags{showUninstall ? " & uninstall" : ""}
      </button>
      <AnimatePresence initial={false}>
        {showFlags && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="space-y-3 pt-1">
              <ul className="divide-y rounded-xl border text-xs">
                {FLAGS.map((f) => (
                  <li key={f.unix} className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:items-center sm:gap-3">
                    <code className="shrink-0 font-mono text-[11px] text-foreground sm:w-56">{platform === "unix" ? f.unix : f.windows}</code>
                    <span className="text-muted-foreground">{f.text}</span>
                  </li>
                ))}
              </ul>
              {showUninstall && <CodeBlock label="Uninstall" code={platform === "unix" ? commands.unixUninstall : commands.windowsUninstall} />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Shown right after creating or reinstalling an agent: the token/command is displayed exactly once.
 * Watches the agent until it checks in.
 */
export function InstallResultDialog({
  result,
  open,
  onOpenChange,
  mode,
}: {
  result: InstallResult | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: "create" | "reinstall";
}) {
  const [seen, setSeen] = useState<{ token: string; host: string | null } | null>(null);
  const connected = result && seen?.token === result.token ? seen : null;

  useEffect(() => {
    if (!open || !result || connected) return;
    const issuedAt = new Date(result.issuedAt).getTime();
    let stop = false;
    const id = window.setInterval(async () => {
      const res = await refreshAgentDataAction(result.agentId);
      if (stop || !res.ok) return;
      const v = res.data.view;
      const checkedIn = v.lastCheckinAt ? new Date(v.lastCheckinAt).getTime() : 0;
      if (checkedIn >= issuedAt - 1000 && v.status !== "offline" && v.status !== "pending") setSeen({ token: result.token, host: v.hostname });
    }, 3000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [open, result, connected]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Terminal className="size-4" />
            {mode === "create" ? `Install "${result?.name ?? "agent"}"` : `Reinstall "${result?.name ?? "agent"}"`}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Run this command on the machine that has Claude Code or Codex installed. The agent only makes outbound HTTPS requests to this server — no open ports."
              : "The old token no longer works. Run this command on the machine to reconnect it — settings and history are kept."}
          </DialogDescription>
        </DialogHeader>
        {result && (
          <div className="min-w-0 space-y-4">
            <div className="flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning/8 px-3 py-2.5 text-xs">
              <KeyRound className="mt-px size-3.5 shrink-0 text-warning" />
              <p>
                <span className="font-medium">This command contains the agent token and is shown only once.</span>{" "}
                <span className="text-muted-foreground">Only its SHA-256 hash is stored. Lost it? Use Reinstall to issue a new one.</span>
              </p>
            </div>
            <InstallCommandTabs commands={result.commands} />
            <div
              className={cn(
                "flex items-center gap-3 rounded-xl border px-3 py-3 transition-colors",
                connected ? "border-success/30 bg-success/8" : "bg-muted/40",
              )}
            >
              <AgentOrb size={34} state={connected ? "success" : "thinking"} />
              <div className="min-w-0 flex-1 text-sm">
                {connected ? (
                  <>
                    <p className="flex items-center gap-1.5 font-medium">
                      <CheckCircle2 className="size-4 text-success" /> Connected{connected.host ? ` from ${connected.host}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">The agent is online and ready for jobs.</p>
                  </>
                ) : (
                  <>
                    <p className="flex items-center gap-1.5 font-medium">
                      <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> Waiting for the first check-in…
                    </p>
                    <p className="text-xs text-muted-foreground">Needs Node.js 20+ and Claude Code or Codex on the machine.</p>
                  </>
                )}
              </div>
            </div>
            <div className="rounded-xl border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">CLI mode: Auto</p>
              <p className="mt-0.5">
                Your own chats and agentic tasks (content, report agent) run in <span className="font-medium text-foreground">Full</span> mode with the
                MCP servers you allow, plus AutoSEO&apos;s own MCP server. Everything else — including all work requested by other people — runs{" "}
                <span className="font-medium text-foreground">Lean</span>: no local MCP servers, settings or shell, file access limited to the job folder.
              </p>
            </div>
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <ShieldCheck className="size-3.5" /> The installer verifies the agent&apos;s SHA-256 and release signature, and stores the token in a 0600 config file. Updates must carry the same signature.
            </p>
          </div>
        )}
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>{connected ? "Done" : "Close"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
