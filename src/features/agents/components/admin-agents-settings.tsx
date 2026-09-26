"use client";

import { Clock, Eraser, FolderOpen, Layers, Power, RefreshCw } from "lucide-react";
import { Panel } from "@/components/app/page";
import { Input } from "@/components/ui/input";
import { NumberInput, Rows, SaveBar, SettingRow, ToggleRow, useSettingsForm } from "@/features/admin/components/settings-kit";

export type AgentsSettingsValues = {
  enabled: boolean;
  checkinIntervalSeconds: number;
  defaultWorkDir: string;
  autoCleanupHours: number;
  jobTimeoutMinutes: number;
  defaultMaxParallelJobs: number;
  allowAutoUpdate: boolean;
};

/** Instance-wide defaults for all local agents (Admin → Local Agents). */
export function AdminAgentsSettings({ initial }: { initial: { values: AgentsSettingsValues; secrets: Record<string, boolean> } }) {
  const form = useSettingsForm<AgentsSettingsValues>("agents", initial);
  const v = form.values;
  return (
    <div className="space-y-5">
      <Panel title="Routing" icon={<Power className="size-4 text-muted-foreground" />} description="Whether AI work may be sent to local agents at all.">
        <Rows>
          <ToggleRow
            label="Enable local agents"
            description="When off, agents stay connected but receive no AI work — everything uses the API providers from Admin → AI Providers."
            checked={v.enabled}
            onCheckedChange={(x) => form.set("enabled", x)}
          />
          <SettingRow label="Check-in interval" description="How often agents report status and pick up settings (5–55 s). Jobs are delivered instantly via long-polling." htmlFor="ag-interval">
            <NumberInput id="ag-interval" value={v.checkinIntervalSeconds} min={5} max={55} suffix="seconds" onChange={(x) => form.set("checkinIntervalSeconds", x)} />
          </SettingRow>
        </Rows>
      </Panel>

      <Panel title="Jobs" icon={<Layers className="size-4 text-muted-foreground" />}>
        <Rows>
          <SettingRow label="Default parallel jobs" description="Per agent, unless overridden on the agent or with --max-parallel." htmlFor="ag-parallel">
            <NumberInput id="ag-parallel" value={v.defaultMaxParallelJobs} min={1} max={32} suffix="jobs" onChange={(x) => form.set("defaultMaxParallelJobs", x)} />
          </SettingRow>
          <SettingRow label="Job timeout" description="A CLI session running longer is stopped and marked as timed out." htmlFor="ag-timeout">
            <div className="flex items-center gap-2">
              <Clock className="size-3.5 text-muted-foreground" />
              <NumberInput id="ag-timeout" value={v.jobTimeoutMinutes} min={1} max={1440} suffix="minutes" onChange={(x) => form.set("jobTimeoutMinutes", x)} />
            </div>
          </SettingRow>
          <SettingRow label="Default work directory" description="Where agents create job folders. Empty = each machine's temp directory. Agents' own settings win." htmlFor="ag-workdir">
            <div className="relative">
              <FolderOpen className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="ag-workdir"
                className="pl-8 font-mono text-xs"
                placeholder="OS temp directory"
                value={v.defaultWorkDir}
                onChange={(e) => form.set("defaultWorkDir", e.target.value)}
              />
            </div>
          </SettingRow>
          <SettingRow label="Auto-cleanup" description="Finished job folders older than this are deleted hourly (freed space is reported per agent). 0 = never." htmlFor="ag-cleanup">
            <div className="flex items-center gap-2">
              <Eraser className="size-3.5 text-muted-foreground" />
              <NumberInput id="ag-cleanup" value={v.autoCleanupHours} min={0} max={2160} suffix="hours" onChange={(x) => form.set("autoCleanupHours", x)} />
            </div>
          </SettingRow>
        </Rows>
      </Panel>

      <Panel title="Updates" icon={<RefreshCw className="size-4 text-muted-foreground" />}>
        <Rows>
          <ToggleRow
            label="Automatic agent updates"
            description="Every deploy is a new agent version. When on, agents with auto-update enabled roll it out on their next check-in. The Update button on an agent always works (unless it runs with --no-auto-update)."
            checked={v.allowAutoUpdate}
            onCheckedChange={(x) => form.set("allowAutoUpdate", x)}
          />
        </Rows>
      </Panel>

      <SaveBar dirty={form.dirty} saving={form.saving} onSave={form.save} onReset={form.reset} count={form.changedCount} />
    </div>
  );
}
