"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Cpu, FolderOpen, Layers, ShieldCheck, SlidersHorizontal, Tag } from "lucide-react";
import { toast } from "sonner";
import { Panel } from "@/components/app/page";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { ChipsInput, NumberInput, Rows, SaveBar, SettingRow, ToggleRow } from "@/features/admin/components/settings-kit";
import { cn } from "@/lib/utils";
import type { AgentView } from "@/server/agents/queries";
import { updateAgentSettingsAction } from "../actions";
import { runtimeLabel } from "./agent-meta";

type FormValues = {
  name: string;
  labels: string[];
  enabled: boolean;
  runtime: "claude" | "codex" | "detect" | null;
  cliProfile: "auto" | "lean" | "full";
  workDir: string;
  maxParallel: number | null;
  autoUpdate: boolean;
  allowedKinds: ("llm" | "web-search" | "chat" | "test")[];
  shared: boolean;
};

function fromView(a: AgentView): FormValues {
  return {
    name: a.name,
    labels: a.labels,
    enabled: a.enabled,
    runtime: a.runtimeSetting,
    cliProfile: a.cliProfile,
    workDir: a.workDir ?? "",
    maxParallel: a.maxParallel,
    autoUpdate: a.autoUpdate,
    allowedKinds: a.allowedKinds as FormValues["allowedKinds"],
    shared: a.shared,
  };
}

const KINDS: { key: FormValues["allowedKinds"][number]; label: string; hint: string }[] = [
  { key: "llm", label: "LLM tasks", hint: "Analysis, extraction, writing (no tools)." },
  { key: "web-search", label: "Web search", hint: "Tasks that let the CLI search/fetch the web and return citations." },
  { key: "chat", label: "Agent chat", hint: "Interactive chat turns streamed to the app, with the AutoSEO MCP server attached." },
  { key: "test", label: "Self-tests", hint: "Health checks started from this dashboard." },
];

export function AgentSettingsForm({ agent, globalDefaults, isAdmin }: { agent: AgentView; globalDefaults: { maxParallel: number; workDir: string; allowAutoUpdate: boolean }; isAdmin: boolean }) {
  const router = useRouter();
  const [base, setBase] = useState<FormValues>(() => fromView(agent));
  const [v, setV] = useState<FormValues>(base);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof FormValues>(k: K, value: FormValues[K]) => setV((prev) => ({ ...prev, [k]: value }));
  const changed = useMemo(() => (Object.keys(v) as (keyof FormValues)[]).filter((k) => JSON.stringify(v[k]) !== JSON.stringify(base[k])), [v, base]);

  const localRuntime = agent.localFlags?.runtime ?? "detect";
  const localNoAutoUpdate = !!agent.localFlags?.noAutoUpdate;

  const save = async () => {
    if (!v.name.trim()) {
      toast.error("Name can't be empty");
      return;
    }
    setSaving(true);
    const patch: Record<string, unknown> = {};
    for (const k of changed) patch[k] = k === "workDir" ? v.workDir.trim() || null : v[k];
    const res = await updateAgentSettingsAction(agent.id, patch);
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    const next = fromView(res.data);
    setBase(next);
    setV(next);
    toast.success("Saved — the agent applies it on its next check-in");
    router.refresh();
  };

  return (
    <div className="space-y-5">
      <Panel title="General" icon={<Tag className="size-4 text-muted-foreground" />}>
        <Rows>
          <SettingRow label="Name" htmlFor="as-name">
            <Input id="as-name" value={v.name} maxLength={80} onChange={(e) => set("name", e.target.value)} />
          </SettingRow>
          <SettingRow label="Labels" description="Free-form tags to organise machines (e.g. office, gpu)." htmlFor="as-labels">
            <ChipsInput id="as-labels" value={v.labels} onChange={(x) => set("labels", x.slice(0, 10))} placeholder="Add a label and press Enter" />
          </SettingRow>
          <ToggleRow
            label="Accept jobs"
            description="When off, the agent is paused: it keeps checking in but receives no new AI work (self-tests still run)."
            checked={v.enabled}
            onCheckedChange={(x) => set("enabled", x)}
          />
          {isAdmin && (
            <ToggleRow
              label="Serve all workspaces"
              description="Instance-wide agent: may run AI work for projects of every workspace (admin only). Prompts of all workspaces then pass through this machine and its job log."
              checked={v.shared}
              onCheckedChange={(x) => set("shared", x)}
            />
          )}
        </Rows>
      </Panel>

      <Panel title="CLI runtime" icon={<Cpu className="size-4 text-muted-foreground" />} description="Applied on the next check-in (within seconds).">
        <Rows>
          <SettingRow
            label="Runtime"
            description={`Overrides the agent's local --runtime flag (currently: ${runtimeLabel(localRuntime)}). Detect prefers Claude Code, then Codex.`}
            htmlFor="as-runtime"
          >
            <NativeSelect id="as-runtime" value={v.runtime ?? ""} onChange={(e) => set("runtime", (e.target.value || null) as FormValues["runtime"])}>
              <NativeSelectOption value="">Agent default ({runtimeLabel(localRuntime)})</NativeSelectOption>
              <NativeSelectOption value="detect">Detect automatically</NativeSelectOption>
              <NativeSelectOption value="claude" disabled={!agent.claudeVersion && !!agent.firstCheckinAt}>
                Claude Code{agent.claudeVersion ? ` ${agent.claudeVersion}` : agent.firstCheckinAt ? " (not installed)" : ""}
              </NativeSelectOption>
              <NativeSelectOption value="codex" disabled={!agent.codexVersion && !!agent.firstCheckinAt}>
                Codex{agent.codexVersion ? ` ${agent.codexVersion}` : agent.firstCheckinAt ? " (not installed)" : ""}
              </NativeSelectOption>
            </NativeSelect>
          </SettingRow>
          <SettingRow
            label="CLI mode"
            description={
              <>
                <span className="font-medium text-foreground">Full</span> loads this machine&apos;s CLI configuration — its MCP servers, skills,
                CLAUDE.md and permission rules (MCP tools run when your Claude Code permissions allow them).{" "}
                <span className="font-medium text-foreground">Lean</span> skips all of it: much faster and cheaper for high-volume analysis.
                The AutoSEO MCP server is attached to chat jobs in both modes. Full only ever applies to jobs requested by this machine&apos;s
                owner, and only if the owner allowed it when installing (<code className="font-mono">--allow-full</code>) — this setting can
                only narrow what the machine allows.
                {v.cliProfile !== "lean" && !agent.localFlags?.allowFull && agent.firstCheckinAt && (
                  <span className="mt-1 block text-warning">This agent was installed without --allow-full, so every job runs Lean.</span>
                )}
              </>
            }
          >
            <div className="grid gap-2 sm:grid-cols-3">
              {(
                [
                  { key: "auto", title: "Auto", text: "Full for chat & agentic tasks (content, report agent), Lean for bulk analysis. Recommended." },
                  { key: "lean", title: "Lean", text: "Always without local MCP servers & config." },
                  { key: "full", title: "Full", text: "Always with local MCP servers, skills & settings." },
                ] as const
              ).map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => set("cliProfile", o.key)}
                  className={cn(
                    "rounded-xl border px-3 py-2.5 text-left transition-colors",
                    v.cliProfile === o.key ? "border-foreground/60 bg-muted/60 ring-1 ring-foreground/10" : "hover:bg-muted/40",
                  )}
                >
                  <div className="text-sm font-medium">{o.title}</div>
                  <div className="text-xs text-muted-foreground">{o.text}</div>
                </button>
              ))}
            </div>
          </SettingRow>
          <SettingRow label="Allowed job kinds" description="Only these kinds of work are routed to this machine.">
            <div className="space-y-2">
              {KINDS.map((k) => {
                const id = `as-kind-${k.key}`;
                const checked = v.allowedKinds.includes(k.key);
                return (
                  <div key={k.key} className="flex items-start gap-2.5">
                    <Checkbox
                      id={id}
                      checked={checked}
                      onCheckedChange={(x) => set("allowedKinds", x ? [...v.allowedKinds, k.key] : v.allowedKinds.filter((y) => y !== k.key))}
                      className="mt-0.5"
                    />
                    <Label htmlFor={id} className="flex flex-col items-start gap-0 font-normal">
                      <span className="text-sm font-medium">{k.label}</span>
                      <span className="text-xs text-muted-foreground">{k.hint}</span>
                    </Label>
                  </div>
                );
              })}
            </div>
          </SettingRow>
        </Rows>
      </Panel>

      <Panel title="Execution" icon={<Layers className="size-4 text-muted-foreground" />}>
        <Rows>
          <SettingRow
            label="Max parallel jobs"
            description={`Each job is a separate CLI session. Default: ${agent.localFlags?.maxParallel ? `${agent.localFlags.maxParallel} (local --max-parallel)` : `${globalDefaults.maxParallel} (instance default)`}.`}
            htmlFor="as-parallel"
          >
            <div className="flex flex-wrap items-center gap-3">
              <Switch checked={v.maxParallel != null} onCheckedChange={(x) => set("maxParallel", x ? (agent.effectiveMaxParallel ?? globalDefaults.maxParallel) : null)} aria-label="Override max parallel jobs" />
              {v.maxParallel != null ? (
                <NumberInput id="as-parallel" value={v.maxParallel} min={1} max={32} suffix="jobs" onChange={(x) => set("maxParallel", x)} className="w-36" />
              ) : (
                <span className="text-sm text-muted-foreground">Using default ({agent.effectiveMaxParallel ?? globalDefaults.maxParallel})</span>
              )}
            </div>
          </SettingRow>
          <SettingRow
            label="Work directory"
            description="Every job runs in its own folder below this directory. Empty = local --workdir or the OS temp directory."
            htmlFor="as-workdir"
          >
            <div className="space-y-1.5">
              <div className="relative">
                <FolderOpen className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="as-workdir"
                  className="pl-8 font-mono text-xs"
                  value={v.workDir}
                  placeholder={agent.effectiveWorkDir ?? (globalDefaults.workDir || "OS temp directory")}
                  onChange={(e) => set("workDir", e.target.value)}
                />
              </div>
              {agent.effectiveWorkDir && (
                <p className="text-[11px] break-all text-muted-foreground">
                  In use: <span className="font-mono">{agent.effectiveWorkDir}</span>
                </p>
              )}
            </div>
          </SettingRow>
        </Rows>
      </Panel>

      <Panel title="Updates" icon={<ShieldCheck className="size-4 text-muted-foreground" />}>
        <Rows>
          <ToggleRow
            label="Automatic updates"
            description={
              localNoAutoUpdate
                ? "This agent runs with --no-auto-update, so it never updates itself. Re-run the installer to update it."
                : globalDefaults.allowAutoUpdate
                  ? "New AutoSEO deploys roll out to this agent automatically (SHA-256 verified, atomic swap, restart)."
                  : "Auto-updates are disabled instance-wide (Admin → Local Agents). Use the Update button to roll out manually."
            }
            checked={v.autoUpdate}
            onCheckedChange={(x) => set("autoUpdate", x)}
          />
        </Rows>
      </Panel>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <SlidersHorizontal className="size-3.5" /> Settings are delivered with the next check-in — no restart needed.
      </p>
      <SaveBar dirty={changed.length > 0} saving={saving} onSave={save} onReset={() => setV(base)} count={changed.length} />
    </div>
  );
}
