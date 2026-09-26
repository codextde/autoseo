"use client";

import { Cpu, FolderKanban, Gauge, Wallet } from "lucide-react";
import { Panel } from "@/components/app/page";
import { Meter } from "@/components/app/metrics";
import { RankedBars } from "@/components/app/charts";
import { formatUsd, featureLabel, providerLabel } from "@/features/settings/usage/labels";
import { NumberInput, Rows, SaveBar, SettingRow, useSettingsForm } from "./settings-kit";

export type LimitsSettings = {
  maxProjectsPerWorkspace: number;
  maxPromptsPerProject: number;
  dailyBudgetUsd: number;
  monthlyBudgetUsd: number;
  auditMaxPages: number;
  auditConcurrency: number;
  jobConcurrency: number;
  resaleMarkupPercent: number;
};

type Driver = { key: string; cost: number; events: number };

function BudgetMeter({ spent, budget, label }: { spent: number; budget: number; label: string }) {
  const pct = budget > 0 ? (spent / budget) * 100 : 0;
  const tone = pct >= 100 ? "destructive" : pct >= 80 ? "warning" : "brand";
  return (
    <div className="mt-2 max-w-sm space-y-1.5">
      <Meter value={budget > 0 ? pct : 0} tone={tone} className="h-2" />
      <p className="text-xs text-muted-foreground tabular">
        {label}: <span className="font-medium text-foreground">{formatUsd(spent)}</span>
        {budget > 0 ? ` · ${Math.round(pct)}% of ${formatUsd(budget)}` : " · no limit"}
      </p>
    </div>
  );
}

export function LimitsForm({
  initial,
  spend,
  providers,
  features,
}: {
  initial: { values: LimitsSettings; secrets: Record<string, boolean> };
  spend: { today: number; month: number };
  providers: Driver[];
  features: Driver[];
}) {
  const form = useSettingsForm<LimitsSettings>("limits", initial);
  const v = form.values;

  return (
    <div className="space-y-5">
      <Panel
        title="Budgets"
        icon={<Wallet className="size-4 text-muted-foreground" />}
        description="Hard caps for paid API calls (DataForSEO + AI providers). When reached, new paid calls fail with a clear error until the period resets (00:00 UTC / 1st of the month). 0 = unlimited."
      >
        <Rows>
          <SettingRow label="Daily budget" description="Across the whole instance." htmlFor="l-daily">
            <NumberInput id="l-daily" value={v.dailyBudgetUsd} min={0} step={1} suffix="USD / day" onChange={(x) => form.set("dailyBudgetUsd", x)} />
            <BudgetMeter spent={spend.today} budget={v.dailyBudgetUsd} label="Spent today" />
          </SettingRow>
          <SettingRow label="Monthly budget" htmlFor="l-monthly">
            <NumberInput id="l-monthly" value={v.monthlyBudgetUsd} min={0} step={10} suffix="USD / month" onChange={(x) => form.set("monthlyBudgetUsd", x)} />
            <BudgetMeter spent={spend.month} budget={v.monthlyBudgetUsd} label="Spent this month" />
          </SettingRow>
          <SettingRow
            label="Agency markup for estimates"
            description="Optional resale markup shown in the cost estimator (Settings → Billing & Costs) to quote clients. 0 = raw provider cost only. Doesn't change what you pay."
            htmlFor="l-markup"
          >
            <NumberInput id="l-markup" value={v.resaleMarkupPercent} min={0} max={1000} step={5} suffix="%" onChange={(x) => form.set("resaleMarkupPercent", x)} />
          </SettingRow>
        </Rows>
      </Panel>

      <Panel title="Workspace & project limits" icon={<FolderKanban className="size-4 text-muted-foreground" />}>
        <Rows>
          <SettingRow label="Projects per workspace" description="Active (non-archived) projects." htmlFor="l-projects">
            <NumberInput id="l-projects" value={v.maxProjectsPerWorkspace} min={1} onChange={(x) => form.set("maxProjectsPerWorkspace", x)} />
          </SettingRow>
          <SettingRow label="Prompts per project" description="Tracked prompts count against AI tracking costs." htmlFor="l-prompts">
            <NumberInput id="l-prompts" value={v.maxPromptsPerProject} min={1} onChange={(x) => form.set("maxPromptsPerProject", x)} />
          </SettingRow>
          <SettingRow label="Site audit: max pages" description="Upper bound per crawl (10 – 100,000)." htmlFor="l-audit">
            <NumberInput id="l-audit" value={v.auditMaxPages} min={10} max={100000} step={100} suffix="pages" onChange={(x) => form.set("auditMaxPages", x)} />
          </SettingRow>
        </Rows>
      </Panel>

      <Panel title="Performance" icon={<Cpu className="size-4 text-muted-foreground" />} description="Tune for the size of your server. Higher values finish work faster but use more CPU, memory and API rate limits.">
        <Rows>
          <SettingRow label="Audit crawler concurrency" description="Parallel page fetches per audit (1 – 50)." htmlFor="l-auditc">
            <NumberInput id="l-auditc" value={v.auditConcurrency} min={1} max={50} onChange={(x) => form.set("auditConcurrency", x)} />
          </SettingRow>
          <SettingRow label="Background job concurrency" description="Jobs running at once in this process (1 – 64)." htmlFor="l-jobs">
            <NumberInput id="l-jobs" value={v.jobConcurrency} min={1} max={64} onChange={(x) => form.set("jobConcurrency", x)} />
          </SettingRow>
        </Rows>
      </Panel>

      <SaveBar dirty={form.dirty} saving={form.saving} onSave={() => void form.save()} onReset={form.reset} count={form.changedCount} />

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="This month by provider" icon={<Gauge className="size-4 text-muted-foreground" />}>
          {providers.length ? (
            <RankedBars items={providers.map((p) => ({ key: p.key, label: providerLabel(p.key), value: p.cost, sub: `${p.events} calls`, right: formatUsd(p.cost) }))} />
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">No paid calls this month.</p>
          )}
        </Panel>
        <Panel title="Top cost drivers" description="Features with the highest spend this month.">
          {features.length ? (
            <RankedBars items={features.slice(0, 8).map((f) => ({ key: f.key, label: featureLabel(f.key), value: f.cost, sub: `${f.events} calls`, right: formatUsd(f.cost) }))} />
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">No paid calls this month.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
