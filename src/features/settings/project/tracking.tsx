"use client";

import Link from "next/link";
import { Check, PauseCircle } from "lucide-react";
import { Panel } from "@/components/app/page";
import { EngineIcon } from "@/components/app/engine-icon";
import { SaveBar } from "@/features/admin/components/settings-kit";
import type { EngineAvailability } from "@/features/onboarding/types";
import { ENGINES } from "@/lib/engines";
import { cn } from "@/lib/utils";
import { ReadOnlyNotice, useProjectForm, type ProjectSettingsData } from "./shared";

const FREQUENCIES = [
  { key: "daily", label: "Daily", hint: "Every day" },
  { key: "weekly", label: "Weekly", hint: "Once a week" },
  { key: "monthly", label: "Monthly", hint: "Once a month" },
  { key: "paused", label: "Paused", hint: "No scheduled runs" },
] as const;

export function TrackingSettings({
  project,
  canEdit,
  engines,
  isAdmin,
}: {
  project: ProjectSettingsData;
  canEdit: boolean;
  engines: EngineAvailability[];
  isAdmin: boolean;
}) {
  const form = useProjectForm(
    project.id,
    { engines: project.engines, trackingFrequency: project.trackingFrequency },
    (v, changed) => {
      const patch: Record<string, unknown> = {};
      for (const k of changed) patch[k] = v[k];
      return patch;
    },
  );
  const v = form.values;
  const availability = new Map(engines.map((e) => [e.id, e]));
  const toggle = (id: string) =>
    form.set("engines", v.engines.includes(id) ? v.engines.filter((x) => x !== id) : [...v.engines, id]);
  const missing = v.engines.filter((id) => !availability.get(id)?.available);

  return (
    <div className="space-y-4">
      {!canEdit && <ReadOnlyNotice>You can view the tracking setup. Changing it requires the projects or settings permission.</ReadOnlyNotice>}
      <Panel
        title="AI engines"
        description="Which AI assistants we ask your prompts in. Prompts can override this individually."
        actions={<span className="text-xs text-muted-foreground tabular">{v.engines.length} enabled</span>}
      >
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {ENGINES.map((e) => {
            const a = availability.get(e.id);
            const on = v.engines.includes(e.id);
            const blocked = a?.disabled && !on;
            return (
              <button
                key={e.id}
                type="button"
                aria-pressed={on}
                disabled={!canEdit || blocked}
                onClick={() => toggle(e.id)}
                className={cn(
                  "flex items-center gap-3 rounded-xl border bg-card p-3 text-left transition-all disabled:cursor-not-allowed",
                  on ? "border-foreground/80 ring-1 ring-foreground/80" : "hover:border-foreground/25",
                  blocked && "opacity-50",
                )}
              >
                <EngineIcon id={e.id} size="md" withTooltip={false} active={on || Boolean(a?.available)} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{e.name}</p>
                  <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground" title={a?.hint}>
                    <span className={cn("size-1.5 shrink-0 rounded-full", a?.available ? "bg-success" : "bg-muted-foreground/40")} />
                    {a?.hint ?? e.vendor}
                  </p>
                </div>
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border",
                    on ? "border-foreground bg-foreground text-background" : "border-input",
                  )}
                >
                  {on && <Check className="size-3" />}
                </span>
              </button>
            );
          })}
        </div>
        {v.engines.length === 0 && <p className="mt-3 text-xs text-destructive">Enable at least one engine.</p>}
        {missing.length > 0 && (
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            {missing.length} enabled engine{missing.length > 1 ? "s have" : " has"} no provider yet — they start tracking as soon as one is connected
            {isAdmin ? (
              <>
                {" "}
                in{" "}
                <Link href="/admin/ai" className="font-medium text-brand hover:underline">
                  Admin → AI Providers
                </Link>
                .
              </>
            ) : (
              " by an admin."
            )}
          </p>
        )}
      </Panel>

      <Panel title="Tracking frequency" description="How often all active prompts are asked in every enabled engine.">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {FREQUENCIES.map((f) => {
            const on = v.trackingFrequency === f.key;
            return (
              <button
                key={f.key}
                type="button"
                disabled={!canEdit}
                aria-pressed={on}
                onClick={() => form.set("trackingFrequency", f.key)}
                className={cn(
                  "rounded-xl border p-3 text-left transition-all disabled:cursor-not-allowed",
                  on ? "border-foreground/80 bg-card ring-1 ring-foreground/80" : "bg-card hover:border-foreground/25",
                )}
              >
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  {f.key === "paused" && <PauseCircle className="size-3.5 text-muted-foreground" />}
                  {f.label}
                </p>
                <p className="text-[11px] text-muted-foreground">{f.hint}</p>
              </button>
            );
          })}
        </div>
      </Panel>
      <SaveBar
        dirty={form.dirty && v.engines.length > 0}
        saving={form.saving}
        onSave={() => void form.save()}
        onReset={form.reset}
        count={form.changedCount}
      />
    </div>
  );
}
