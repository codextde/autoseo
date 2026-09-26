"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { Panel } from "@/components/app/page";
import { EngineIcon } from "@/components/app/engine-icon";
import { StatusBadge, TimeAgo } from "@/components/app/misc";
import { MultiSelect } from "@/components/app/filters";
import { formatCurrency } from "@/components/app/metrics";
import { useCan } from "@/components/app/shell-context";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { COUNTRIES, LANGUAGES, flagEmoji } from "@/lib/countries";
import { ENGINES } from "@/lib/engines";
import { cn } from "@/lib/utils";
import { updateModelSettingsAction } from "../actions";
import type { EngineAvailabilityView, RunInfo } from "../types";
import { RunNowButton } from "./run-controls";

const STATUS_LABEL: Record<EngineAvailabilityView["status"], { label: string; tone: string }> = {
  configured: { label: "Configured", tone: "success" },
  needs_key: { label: "Needs API key", tone: "warning" },
  needs_dataforseo: { label: "Needs DataForSEO", tone: "warning" },
  needs_agent: { label: "Needs local agent", tone: "warning" },
  disabled: { label: "Disabled by admin", tone: "disabled" },
};

const FREQUENCIES = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "paused", label: "Paused" },
];

const COUNTRY_OPTIONS = COUNTRIES.map((c) => ({ value: c.iso, label: c.name, icon: <span>{flagEmoji(c.iso)}</span> }));

export function ModelsView({
  projectId,
  engines,
  enabled: initialEnabled,
  frequency: initialFrequency,
  country: initialCountry,
  language: initialLanguage,
  latestRun,
  cost30d,
  isAdmin,
  activePrompts,
}: {
  projectId: string;
  engines: EngineAvailabilityView[];
  enabled: string[];
  frequency: string;
  country: string;
  language: string;
  latestRun: RunInfo | null;
  cost30d: number;
  isAdmin: boolean;
  activePrompts: number;
}) {
  const can = useCan();
  const canManage = can("prompts.manage");
  // Engines + frequency raise paid spend: project/settings managers only (enforced server-side too).
  const canConfigure = can("projects.manage") || can("settings.manage");
  const [enabled, setEnabled] = useState(initialEnabled);
  const [frequency, setFrequency] = useState(initialFrequency);
  const [country, setCountry] = useState(initialCountry);
  const [language, setLanguage] = useState(initialLanguage);
  const [pending, start] = useTransition();
  const availMap = new Map(engines.map((e) => [e.id, e]));

  const save = (patch: Parameters<typeof updateModelSettingsAction>[1], rollback: () => void, message: string) =>
    start(async () => {
      const res = await updateModelSettingsAction(projectId, patch);
      if (res.ok) toast.success(message);
      else {
        rollback();
        toast.error(res.error);
      }
    });

  const toggle = (id: string, on: boolean) => {
    const prev = enabled;
    const next = on ? [...enabled, id] : enabled.filter((e) => e !== id);
    setEnabled(next);
    save({ engines: next }, () => setEnabled(prev), `${ENGINES.find((e) => e.id === id)?.name} ${on ? "enabled" : "disabled"}`);
  };

  const answersPerRun = activePrompts * enabled.length;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Tracking" description="How often and from where your prompts are asked" className="lg:col-span-2" contentClassName="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Tracking frequency</Label>
            <Select
              value={frequency}
              disabled={!canConfigure || pending}
              onValueChange={(v) => {
                const prev = frequency;
                setFrequency(v);
                save({ trackingFrequency: v as "daily" }, () => setFrequency(prev), "Tracking frequency updated");
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FREQUENCIES.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">Runs start automatically (UTC). Paused projects are not tracked.</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Default location</Label>
            <MultiSelect
              single
              options={COUNTRY_OPTIONS}
              value={[country]}
              onChange={(v) => {
                if (!v[0] || !canManage) return;
                const prev = country;
                setCountry(v[0]);
                save({ country: v[0] }, () => setCountry(prev), "Default location updated");
              }}
              className="h-8 w-full"
            />
            <p className="text-[11px] text-muted-foreground">Used for new prompts; each prompt keeps its own location.</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Default language</Label>
            <Select
              value={language}
              disabled={!canManage || pending}
              onValueChange={(v) => {
                const prev = language;
                setLanguage(v);
                save({ language: v }, () => setLanguage(prev), "Default language updated");
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((l) => (
                  <SelectItem key={l.code} value={l.code}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </Panel>
        <Panel title="Last run" contentClassName="space-y-3">
          {latestRun ? (
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <StatusBadge status={latestRun.status === "partial" ? "warning" : latestRun.status} label={latestRun.status === "partial" ? "Partial" : undefined} />
                <TimeAgo date={latestRun.createdAt} className="text-xs text-muted-foreground" />
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-lg bg-muted/60 py-1.5">
                  <div className="text-base font-semibold tabular">{latestRun.doneTasks}</div>
                  <div className="text-muted-foreground">answered</div>
                </div>
                <div className="rounded-lg bg-muted/60 py-1.5">
                  <div className="text-base font-semibold tabular">{latestRun.failedTasks}</div>
                  <div className="text-muted-foreground">failed</div>
                </div>
                <div className="rounded-lg bg-muted/60 py-1.5">
                  <div className="text-base font-semibold tabular">${latestRun.costUsd.toFixed(2)}</div>
                  <div className="text-muted-foreground">cost</div>
                </div>
              </div>
              {latestRun.error && <p className="line-clamp-3 text-xs text-muted-foreground">{latestRun.error}</p>}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No tracking run yet.</p>
          )}
          <div className="flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
            <span>
              {answersPerRun} answers per run · {formatCurrency(cost30d, "USD", 2)} last 30 days
            </span>
            <RunNowButton projectId={projectId} />
          </div>
        </Panel>
      </div>

      <Panel
        title="AI models"
        description={`${enabled.length} of ${ENGINES.length} models enabled for this project`}
        actions={pending ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {ENGINES.map((e, i) => {
            const avail = availMap.get(e.id);
            const on = enabled.includes(e.id);
            const status = avail ? STATUS_LABEL[avail.status] : STATUS_LABEL.needs_key;
            return (
              <motion.div
                key={e.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.02, duration: 0.2 }}
                className={cn("flex flex-col gap-3 rounded-2xl border bg-card p-4 transition-colors", on ? "border-brand/40 ring-1 ring-brand/20" : "")}
              >
                <div className="flex items-start gap-3">
                  <EngineIcon id={e.id} size="lg" withTooltip={false} active={on} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{e.name}</div>
                    <div className="text-xs text-muted-foreground">{e.vendor}</div>
                  </div>
                  <Switch checked={on} disabled={!canConfigure || pending} onCheckedChange={(v) => toggle(e.id, v)} aria-label={`Enable ${e.name}`} />
                </div>
                <p className="text-xs text-muted-foreground">{e.description}</p>
                <div className="mt-auto space-y-1.5 border-t pt-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">
                      Provider: <span className="font-medium text-foreground">{avail?.providerLabel ?? "—"}</span>
                    </span>
                    <StatusBadge status={status.tone} label={status.label} />
                  </div>
                  {!avail?.configured && (
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-muted-foreground">{avail?.reason}</span>
                      {isAdmin && avail && (
                        <Link href={avail.adminHref} className="flex shrink-0 items-center gap-0.5 font-medium hover:underline">
                          Admin <ArrowUpRight className="size-3" />
                        </Link>
                      )}
                    </div>
                  )}
                  {avail?.configured && <span className="text-muted-foreground">{avail.reason}</span>}
                </div>
              </motion.div>
            );
          })}
        </div>
        {!canConfigure && <p className="mt-3 text-xs text-muted-foreground">Only project managers can enable or disable AI models and change the tracking frequency.</p>}
        {!isAdmin && <p className="mt-3 text-xs text-muted-foreground">Providers and API keys are configured by an instance admin (Admin → AI Providers / Data Providers).</p>}
      </Panel>
    </div>
  );
}
