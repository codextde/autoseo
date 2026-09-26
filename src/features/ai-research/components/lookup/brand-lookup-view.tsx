"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Globe2, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PageHeader, Panel } from "@/components/app/page";
import { EmptyState } from "@/components/app/empty-state";
import { useUrlPatch, useUrlState } from "@/hooks/use-url-state";
import { COUNTRIES } from "@/lib/countries";
import { HowWeGetDataDialog } from "../shared/info-dialog";
import { ProviderNotice } from "../shared/bits";
import { LookupHistory } from "./lookup-history";
import { useLookupPoll } from "./use-lookup-poll";
import { BrandLookupResults } from "./brand-lookup-results";
import { runBrandLookupAction } from "../../actions/lookup";
import type { BrandLookupParams, BrandLookupResult, LookupHistoryItem } from "../../types";

export type BrandLookupViewProps = {
  projectId: string;
  history: LookupHistoryItem[];
  dataforseo: boolean;
  canRun: boolean;
  defaults: { query: string; country: string };
  cost: { base: number; competitors: number };
  current: {
    id: string;
    status: "queued" | "running" | "done" | "failed";
    error: string | null;
    costUsd: number;
    createdAt: string;
    params: BrandLookupParams;
    result: BrandLookupResult | null;
  } | null;
};

function isDomainLike(v: string) {
  const t = v.trim();
  return !/\s/.test(t) && t.includes(".");
}

export function BrandLookupView({ projectId, history, dataforseo, canRun, defaults, cost, current }: BrandLookupViewProps) {
  const router = useRouter();
  const [qParam] = useUrlState("q", "");
  const [cParam] = useUrlState("c", "");
  const [scopeParam] = useUrlState("scope", "subdomains");
  const [ccParam] = useUrlState("cc", "");
  const [patch] = useUrlPatch();
  const [query, setQuery] = useState(qParam || current?.params.query || defaults.query);
  const [competitors, setCompetitors] = useState(cParam || current?.params.competitors.join(", ") || "");
  const [scope, setScope] = useState<"domain" | "subdomains">(scopeParam === "domain" ? "domain" : "subdomains");
  const [country, setCountry] = useState(ccParam || current?.params.country || defaults.country);
  const [pending, start] = useTransition();
  const elapsed = useLookupPoll(projectId, current?.id ?? null, current?.status ?? null);

  const compList = competitors
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const estimate = cost.base + (compList.length ? cost.competitors : 0);

  const run = () =>
    start(async () => {
      if (compList.length > 5) return void toast.error("Add up to 5 competitors.");
      const res = await runBrandLookupAction(projectId, { query: query.trim(), competitors: compList, scope, country });
      if (!res.ok) return void toast.error(res.error);
      patch({ id: res.data.id, q: query.trim(), c: compList.join(",") || null, scope: scope === "subdomains" ? null : scope, cc: country, rt: null });
      router.refresh();
    });

  const running = current && (current.status === "queued" || current.status === "running");

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageHeader
        title="Brand Lookup"
        description="See how AI search (ChatGPT & Google AI Overview) mentions and cites any brand name or domain — with share of voice against competitors."
        actions={
          <HowWeGetDataDialog
            title="How we get this data"
            steps={[
              { title: "LLM Mentions database", body: "DataForSEO AI Optimization collects millions of ChatGPT and Google AI Overview answers with their prompts, cited sources and AI search volume." },
              { title: "Aggregates", body: "For each platform we fetch aggregated mentions & AI search volume, the most cited pages and up to 100 prompts mentioning the target." },
              { title: "Share of Voice", body: "With competitors we compare total mentions per brand (cross-aggregated metrics)." },
              { title: "Markets", body: "ChatGPT data is only available for the United States (English); Google AI Overview follows the selected market." },
            ]}
            footer={`Cost: ~$${cost.base.toFixed(2)} per lookup (6 DataForSEO requests) + ~$${cost.competitors.toFixed(2)} with competitors. Charged to your DataForSEO account.`}
          />
        }
      />

      {!dataforseo && (
        <ProviderNotice title="DataForSEO is not configured" href="/admin/data" linkLabel="Admin → Data Providers">
          Brand Lookup uses DataForSEO’s AI Optimization (LLM Mentions) API. An admin needs to add DataForSEO credentials first.
        </ProviderNotice>
      )}

      <Panel contentClassName="p-4 sm:p-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
          className="space-y-3"
        >
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_200px]">
            <div className="space-y-1">
              <Label htmlFor="bl-q">Brand name or domain</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="bl-q" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Enter a brand name or domain" maxLength={250} className="h-9 pl-8" />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Scope</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <NativeSelect value={scope} onChange={(e) => setScope(e.target.value as "domain" | "subdomains")} disabled={!isDomainLike(query)} className="w-full">
                      <NativeSelectOption value="subdomains">Domain + subdomains</NativeSelectOption>
                      <NativeSelectOption value="domain">Exact domain</NativeSelectOption>
                    </NativeSelect>
                  </span>
                </TooltipTrigger>
                {!isDomainLike(query) && <TooltipContent>Scopes apply to domain lookups</TooltipContent>}
              </Tooltip>
            </div>
            <div className="space-y-1">
              <Label className="flex items-center gap-1">
                <Globe2 className="size-3.5" /> Market (Google AI Overview)
              </Label>
              <NativeSelect value={country} onChange={(e) => setCountry(e.target.value)} className="w-full">
                {COUNTRIES.filter((c) => !c.googleAdsOnly).map((c) => (
                  <NativeSelectOption key={c.iso} value={c.iso}>
                    {c.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="bl-c">Competitors (optional)</Label>
            <Input id="bl-c" value={competitors} onChange={(e) => setCompetitors(e.target.value)} placeholder="Add competitors (comma-separated)" />
            <p className="text-xs text-muted-foreground">Add up to 5 competitor brands or domains to see your Share of Voice.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Est. <b className="text-foreground tabular">${estimate.toFixed(2)}</b>
              {!compList.length && <> · plus ~${cost.competitors.toFixed(2)} to compare competitors</>} · ChatGPT data covers US / English only
            </p>
            <Button type="submit" disabled={!canRun || !dataforseo || pending || !query.trim() || !!running}>
              {pending || running ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Look up
            </Button>
          </div>
          {!canRun && <p className="text-xs text-muted-foreground">Running paid lookups requires the “Run paid SEO research” permission.</p>}
        </form>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          {!current ? (
            <Panel>
              <EmptyState icon={Search} title="Look up a brand" description="Enter your brand, a competitor or any domain to see the AI prompts mentioning it, the sources AI cites and your share of voice." />
            </Panel>
          ) : running ? (
            <Panel>
              <div className="flex flex-col items-center gap-2 py-14 text-center">
                <Loader2 className="size-6 animate-spin text-brand" />
                <p className="text-sm font-medium">Looking up “{current.params.query}”…</p>
                <p className="text-xs text-muted-foreground">Fetching ChatGPT and Google AI Overview mentions · {elapsed}s</p>
              </div>
            </Panel>
          ) : current.status === "failed" ? (
            <Panel>
              <EmptyState icon={AlertTriangle} title="Lookup failed" description={current.error ?? "Unknown error"} />
            </Panel>
          ) : current.result ? (
            <BrandLookupResults projectId={projectId} result={current.result} params={current.params} costUsd={current.costUsd} createdAt={current.createdAt} />
          ) : null}
        </div>
        <LookupHistory
          projectId={projectId}
          items={history}
          activeId={current?.id ?? null}
          canDelete={canRun}
          title="Recent lookups"
          onSelect={(h) => {
            const p = h.params as unknown as BrandLookupParams;
            setQuery(p.query);
            setCompetitors(p.competitors?.join(", ") ?? "");
            setCountry(p.country);
            patch({ id: h.id, q: p.query, c: p.competitors?.join(",") || null, cc: p.country, rt: null });
          }}
          renderSub={(h) => {
            const p = h.params as unknown as BrandLookupParams;
            return p.competitors?.length ? <span>vs {p.competitors.length}</span> : null;
          }}
        />
      </div>
    </div>
  );
}
