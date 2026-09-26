"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpCircle, ChevronDown, Eraser, FlaskConical, KeyRound, Loader2, MoreHorizontal, Pause, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useUrlPatch } from "@/hooks/use-url-state";
import type { AgentView } from "@/server/agents/queries";
import {
  deleteAgentAction,
  reinstallAgentAction,
  requestAgentCleanupAction,
  requestAgentUpdateAction,
  setAgentEnabledAction,
  startAgentTestAction,
  type InstallResult,
} from "../actions";
import { formatBytes } from "./agent-meta";
import { InstallResultDialog } from "./install-commands";

export function AgentActions({ agent }: { agent: AgentView }) {
  const router = useRouter();
  const [patch] = useUrlPatch();
  const [busy, setBusy] = useState<string | null>(null);
  const [reinstall, setReinstall] = useState<InstallResult | null>(null);
  const [reinstallOpen, setReinstallOpen] = useState(false);
  const [confirm, setConfirm] = useState<"reinstall" | "delete" | null>(null);

  const run = async <T,>(key: string, fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, success?: (data: T) => void) => {
    setBusy(key);
    try {
      const res = await fn();
      if (!res.ok) toast.error(res.error);
      else {
        success?.(res.data);
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  };

  const localNoUpdate = !!agent.localFlags?.noAutoUpdate;
  const testDisabled = !agent.allowedKinds.includes("test");

  const test = (runtimes?: ("claude" | "codex")[]) =>
    run(
      "test",
      () => startAgentTestAction(agent.id, runtimes),
      (d) => {
        toast.success(agent.status === "online" || agent.status === "paused" ? "Self-test started" : "Self-test queued — runs when the agent is online");
        patch({ job: d.jobId });
      },
    );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button
              variant="outline"
              size="sm"
              disabled={!!busy || localNoUpdate || !agent.firstCheckinAt}
              onClick={() =>
                run(
                  "update",
                  () => requestAgentUpdateAction(agent.id),
                  () => toast.success(agent.outdated ? "Update queued — applied on the next check-in" : "Already up to date — re-checked on the next check-in"),
                )
              }
            >
              {busy === "update" ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowUpCircle className="size-3.5" />}
              Update
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-64">
          {localNoUpdate
            ? "This agent runs with --no-auto-update. Re-run the installer to update it."
            : agent.outdated
              ? `Roll out ${agent.latestVersion} on the next check-in (ignores the auto-update switch).`
              : `Running the latest version (${agent.agentVersion ?? "—"}).`}
        </TooltipContent>
      </Tooltip>

      <ButtonGroup>
        <Button variant="outline" size="sm" disabled={!!busy || testDisabled} onClick={() => test()}>
          {busy === "test" ? <Loader2 className="size-3.5 animate-spin" /> : <FlaskConical className="size-3.5" />}
          Test
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="px-1.5" disabled={!!busy || testDisabled} aria-label="Test options">
              <ChevronDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="text-xs text-muted-foreground">Self-test (1 attempt, pinned to this machine)</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => test(["claude"])} disabled={!agent.claudeVersion && !!agent.firstCheckinAt}>
              Claude Code only
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => test(["codex"])} disabled={!agent.codexVersion && !!agent.firstCheckinAt}>
              Codex only
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => test(["claude", "codex"])}>Both CLIs</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ButtonGroup>

      <Button
        variant="outline"
        size="sm"
        disabled={!!busy || !agent.firstCheckinAt || agent.pendingCleanup}
        onClick={() => run("cleanup", () => requestAgentCleanupAction(agent.id), () => toast.success("Cleanup requested — runs on the next check-in"))}
        title={agent.workDirBytes != null ? `Job folders use ${formatBytes(agent.workDirBytes)}` : undefined}
      >
        {busy === "cleanup" || agent.pendingCleanup ? <Loader2 className="size-3.5 animate-spin" /> : <Eraser className="size-3.5" />}
        Cleanup
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon-sm" aria-label="More actions" disabled={!!busy}>
            {busy && ["pause", "reinstall", "delete"].includes(busy) ? <Loader2 className="size-3.5 animate-spin" /> : <MoreHorizontal className="size-4" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem
            onSelect={() =>
              run(
                "pause",
                () => setAgentEnabledAction(agent.id, !agent.enabled),
                () => toast.success(agent.enabled ? "Paused — no new jobs" : "Resumed"),
              )
            }
          >
            {agent.enabled ? <Pause className="size-4" /> : <Play className="size-4" />}
            {agent.enabled ? "Disable (pause)" : "Enable (resume)"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setConfirm("reinstall")}>
            <KeyRound className="size-4" /> Reinstall (new token)
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirm("delete")}>
            <Trash2 className="size-4" /> Delete agent
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirm !== null} onOpenChange={(v) => !v && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "delete" ? `Delete "${agent.name}"?` : `Reinstall "${agent.name}"?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "delete"
                ? "The token is revoked and the agent disappears from the dashboard. Unfinished jobs go back to the queue for other agents. Uninstall it on the machine too."
                : "A new token is issued and the current one stops working immediately. Unfinished jobs are requeued; settings and history are kept. You'll see the new install command once."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!!busy}
              className={confirm === "delete" ? "bg-destructive text-white hover:bg-destructive/90" : undefined}
              onClick={async (e) => {
                e.preventDefault();
                if (confirm === "delete") {
                  await run("delete", () => deleteAgentAction(agent.id), () => {
                    toast.success("Agent deleted");
                    router.push("/agents");
                  });
                } else {
                  await run("reinstall", () => reinstallAgentAction(agent.id), (d) => {
                    setReinstall(d);
                    setReinstallOpen(true);
                  });
                }
                setConfirm(null);
              }}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {confirm === "delete" ? "Delete agent" : "Issue new token"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <InstallResultDialog mode="reinstall" result={reinstall} open={reinstallOpen} onOpenChange={setReinstallOpen} />
    </div>
  );
}
