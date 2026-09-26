"use client";

import { Workflow } from "lucide-react";
import { Panel } from "@/components/app/page";
import { SankeyChart } from "@/components/app/sankey";
import { SearchInput } from "@/components/app/filters";
import { EmptyState } from "@/components/app/empty-state";
import { formatNumber } from "@/components/app/metrics";
import { useUrlPatch } from "@/hooks/use-url-state";
import { cn } from "@/lib/utils";
import type { FlowMetric, FlowResult } from "@/server/analytics/traffic/flow";

const METRICS: { key: FlowMetric; label: string }[] = [
  { key: "sessions", label: "Sessions" },
  { key: "conversions", label: "Conversions" },
  { key: "conversion_rate", label: "Conversion Rate" },
  { key: "intent", label: "User Intent" },
];

const DESCRIPTIONS: Record<FlowMetric, string> = {
  sessions: "How AI-referred sessions flow from each AI model to landing pages and what they lead to.",
  conversions: "Conversions per AI model and landing page, split into revenue and other conversions.",
  conversion_rate: "Landing pages with the highest conversion rate for AI visitors (flows sized by sessions).",
  intent: "AI sessions grouped by the intent of the landing page (product, pricing, blog, comparison…).",
};

export function FlowPanel({ flow, metric, url }: { flow: FlowResult; metric: FlowMetric; url: string }) {
  const [patch] = useUrlPatch();
  return (
    <Panel
      title="AI Model → Page → Outcome Flow"
      description={DESCRIPTIONS[metric]}
      actions={
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <div className="scrollbar-none flex max-w-full overflow-x-auto rounded-lg bg-muted p-0.5">
            {METRICS.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => patch({ flow: m.key === "sessions" ? null : m.key })}
                className={cn(
                  "shrink-0 rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors",
                  metric === m.key ? "bg-background shadow-xs" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
          <SearchInput value={url} onChange={(v) => patch({ url: v || null })} placeholder="Filter URLs…" className="w-full sm:w-44" />
        </div>
      }
    >
      {flow.links.length === 0 ? (
        <EmptyState
          compact
          icon={Workflow}
          title={url ? "No pages match this filter" : "No flow data for this period"}
          description={url ? "Try a different URL fragment." : "The flow appears once AI platforms send visitors to your pages."}
        />
      ) : (
        <div className="space-y-3">
          <div className="-mx-2 overflow-x-auto px-2">
            <div className="min-w-[640px]">
              <SankeyChart nodes={flow.nodes} links={flow.links} height={Math.max(320, Math.min(560, flow.nodes.length * 26))} />
            </div>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
            <span>
              <b className="font-semibold text-foreground tabular">{formatNumber(flow.totals.sessions, { maximumFractionDigits: 0 })}</b> sessions
            </span>
            <span>
              <b className="font-semibold text-foreground tabular">{formatNumber(flow.totals.conversions, { maximumFractionDigits: 0 })}</b> conversions
            </span>
            {metric !== "intent" && flow.middleCount > 8 && <span>Top 8 of {flow.middleCount} pages shown, the rest are grouped as “Other pages”.</span>}
          </div>
        </div>
      )}
    </Panel>
  );
}
