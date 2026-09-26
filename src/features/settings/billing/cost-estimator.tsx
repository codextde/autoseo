"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Briefcase, Calculator, Info, Store } from "lucide-react";
import { Panel } from "@/components/app/page";
import { formatNumber } from "@/components/app/metrics";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formatUsd } from "../usage/labels";
import { Segmented } from "../account/segmented";
import {
  CHECK_FREQUENCIES,
  ESTIMATOR_PRESETS,
  estimateMonthlyCost,
  sanitizeInput,
  type ChecksPerWeek,
  type EstimatorInput,
} from "./estimator";

type PresetKey = keyof typeof ESTIMATOR_PRESETS | "custom";

const FIELDS: { key: Exclude<keyof EstimatorInput, "checksPerWeek">; label: string; hint: string; max: number }[] = [
  { key: "sites", label: "Websites", hint: "Projects with rank tracking", max: 10_000 },
  { key: "keywordsPerSite", label: "Tracked keywords per site", hint: "Checked on every scheduled run", max: 100_000 },
  { key: "keywordRuns", label: "Keyword research searches", hint: "Per month", max: 1_000_000 },
  { key: "localSerps", label: "Local SERPs", hint: "Maps / Local Finder checks per month", max: 1_000_000 },
  { key: "backlinks", label: "Backlink profiles", hint: "Domains analysed per month", max: 1_000_000 },
  { key: "aiScans", label: "AI citation scans", hint: "Per AI platform, via DataForSEO", max: 1_000_000 },
];

function NumberField({ id, label, hint, value, onChange, max }: { id: string; label: string; hint: string; value: number; onChange: (n: number) => void; max: number }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
        className="h-9 tabular"
      />
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

/**
 * Monthly cost estimator (open-seo pricing logic) — raw DataForSEO prices, optionally with the agency
 * markup from Admin → Limits & Budgets for client quotes.
 */
export function CostEstimator({ markupPercent, recentSpend }: { markupPercent: number; recentSpend: number | null }) {
  const [preset, setPreset] = useState<PresetKey>("business");
  const [input, setInput] = useState<EstimatorInput>(ESTIMATOR_PRESETS.business.input);
  const estimate = useMemo(() => estimateMonthlyCost(input, markupPercent), [input, markupPercent]);
  const showMarkup = markupPercent > 0;

  const update = (patch: Partial<EstimatorInput>) => {
    setPreset("custom");
    setInput((cur) => sanitizeInput({ ...cur, ...patch }));
  };

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Calculator className="size-4 text-muted-foreground" /> Cost estimator
        </span>
      }
      description="Estimate monthly provider costs before you scale up — raw DataForSEO list prices, no markup."
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="min-w-0 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(ESTIMATOR_PRESETS) as (keyof typeof ESTIMATOR_PRESETS)[]).map((key) => {
              const p = ESTIMATOR_PRESETS[key];
              const Icon = key === "business" ? Store : Briefcase;
              const active = preset === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setPreset(key);
                    setInput(p.input);
                  }}
                  className={cn(
                    "flex min-w-0 flex-col items-start gap-1 rounded-xl border p-3 text-left transition-all",
                    active ? "border-foreground bg-card shadow-soft ring-1 ring-foreground" : "bg-background/50 hover:bg-muted/40",
                  )}
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <Icon className="size-4" /> {p.label}
                  </span>
                  <span className="line-clamp-2 text-[11px] text-muted-foreground">{p.description}</span>
                </button>
              );
            })}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Rank checks</Label>
            <Segmented<"0" | "1" | "7">
              size="sm"
              value={String(input.checksPerWeek) as "0" | "1" | "7"}
              onChange={(v) => update({ checksPerWeek: Number(v) as ChecksPerWeek })}
              options={CHECK_FREQUENCIES.map((f) => ({ value: String(f.value) as "0" | "1" | "7", label: f.label }))}
              className="w-full"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {FIELDS.map((f) => (
              <NumberField
                key={f.key}
                id={`est-${f.key}`}
                label={f.label}
                hint={f.hint}
                max={f.max}
                value={input[f.key]}
                onChange={(n) => update({ [f.key]: n } as Partial<EstimatorInput>)}
              />
            ))}
          </div>
        </div>

        <div className="min-w-0 space-y-3">
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Item</th>
                  <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Volume</th>
                  <th className="px-3 py-2 text-right font-medium">Raw cost</th>
                  {showMarkup && <th className="px-3 py-2 text-right font-medium">+{markupPercent}%</th>}
                </tr>
              </thead>
              <tbody>
                {estimate.lines.map((l) => (
                  <tr key={l.key} className={cn("border-b last:border-0", l.rawCost === 0 && "text-muted-foreground")}>
                    <td className="px-3 py-2">
                      <div className="font-medium">{l.label}</div>
                      <div className="text-[11px] text-muted-foreground tabular">
                        <span className="sm:hidden">{formatNumber(Math.round(l.quantity))} {l.unit} · </span>
                        {formatUsd(l.unitCost)} each
                      </div>
                    </td>
                    <td className="hidden px-3 py-2 text-right text-xs text-muted-foreground tabular sm:table-cell">
                      {formatNumber(Math.round(l.quantity))} {l.unit}
                    </td>
                    <td className="px-3 py-2 text-right tabular">{formatUsd(l.rawCost)}</td>
                    {showMarkup && <td className="px-3 py-2 text-right tabular">{formatUsd(l.rawCost * (1 + markupPercent / 100))}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={cn("grid gap-2", showMarkup ? "grid-cols-2" : "grid-cols-1")}>
            <div className="rounded-xl bg-foreground p-4 text-background">
              <div className="text-xs opacity-70">Estimated provider cost / month</div>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={estimate.rawTotal.toFixed(2)}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="text-3xl font-semibold tracking-tight tabular"
                >
                  {formatUsd(estimate.rawTotal)}
                </motion.div>
              </AnimatePresence>
            </div>
            {showMarkup && (
              <div className="rounded-xl border bg-card p-4">
                <div className="text-xs text-muted-foreground">Client price (+{markupPercent}% markup)</div>
                <div className="text-3xl font-semibold tracking-tight tabular">{formatUsd(estimate.withMarkup)}</div>
              </div>
            )}
          </div>

          <div className="space-y-1.5 text-[11px] leading-relaxed text-muted-foreground">
            <p className="flex items-start gap-1.5">
              <Info className="mt-px size-3 shrink-0" />
              <span>
                {input.checksPerWeek > 0
                  ? `${formatNumber(Number(estimate.scheduledRunsPerMonth.toFixed(1)))} scheduled rank runs / month (${input.sites} site${input.sites === 1 ? "" : "s"} × ${input.checksPerWeek}/week × 4.345 weeks). `
                  : "Manual rank checks are billed when you run them. "}
                Prices: rank check {formatUsd(estimate.lines[0]!.unitCost)} per keyword (depth 40), keyword search $0.039, local SERP $0.0035,
                backlink profile {formatUsd(estimate.lines[3]!.unitCost)}, AI citation $0.85 per platform. AI visibility tracking via local agents
                is free (uses your Claude Code / Codex subscription).
              </span>
            </p>
            <p>
              A hosted tool with a 28% markup would charge ≈ {formatUsd(estimate.hostedUsd)} for the same usage
              {recentSpend != null && <> · your actual spend in the last 30 days: {formatUsd(recentSpend)}</>}.
            </p>
            {!showMarkup && <p>Agencies can add a resale markup in Admin → Limits & Budgets to quote clients.</p>}
          </div>
        </div>
      </div>
    </Panel>
  );
}
