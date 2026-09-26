"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { countryLabel } from "../../lib/countries";
import { FREE_TOOLS } from "../../lib/registry";
import type { DomainTraffic, TrafficCheckResult } from "../../lib/types";
import { CountrySelect, Field, FIELD_CLASS, ToolForm } from "../form";
import { useToolRun, useToolRunner } from "../runner";
import { DomainTitle, FeatureLink, formatCount, formatMoney, MetricTiles, Reveal, SectionTitle, UpsellCard } from "../results";
import { PagesTable, RankedKeywordsTable } from "../tables";

const COMPARE_ROWS = [
  { label: "Estimated visits / month", key: "organicTraffic", format: formatCount },
  { label: "Organic keywords", key: "organicKeywords", format: formatCount },
  { label: "Traffic value / month", key: "trafficValue", format: formatMoney },
  { label: "Ranking pages", key: "totalPages", format: formatCount },
] as const;

function CompareTable({ a, b }: { a: DomainTraffic; b: DomainTraffic }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full min-w-[440px] text-left text-sm">
        <thead>
          <tr className="border-b bg-muted/60 text-xs text-muted-foreground">
            <th scope="col" className="px-3 py-2.5 font-medium">
              Metric
            </th>
            {[a, b].map((d) => (
              <th key={d.domain} scope="col" className="max-w-[220px] px-3 py-2.5 text-right font-medium break-words">
                {d.domain}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {COMPARE_ROWS.map(({ label, key, format }) => {
            const va = a[key];
            const vb = b[key];
            const winner = va != null && vb != null && va !== vb ? (va > vb ? 0 : 1) : null;
            return (
              <tr key={key} className="border-b last:border-0">
                <th scope="row" className="px-3 py-3 font-normal text-muted-foreground">
                  {label}
                </th>
                {[va, vb].map((v, i) => (
                  <td key={i} className="px-3 py-3 text-right font-semibold tabular">
                    <span className={winner === i ? "rounded-md bg-brand-soft px-1.5 py-0.5 text-foreground" : undefined}>{format(v)}</span>
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DomainReport({ data, locationCode, showMetrics }: { data: DomainTraffic; locationCode: number; showMetrics: boolean }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DomainTitle domain={data.domain} sub={`Organic search · ${countryLabel(locationCode)}`} />
        <FeatureLink tool={FREE_TOOLS["website-traffic-checker"]} query={{ domain: data.domain, loc: locationCode }} />
      </div>
      {showMetrics && (
        <MetricTiles
          items={[
            {
              label: "Organic traffic / month",
              value: formatCount(data.organicTraffic),
              accent: true,
              hint: "DataForSEO's estimated monthly organic visits, derived from the keywords this domain ranks for and their search volume. An estimate, not analytics data.",
            },
            { label: "Organic keywords", value: formatCount(data.organicKeywords), hint: "How many keywords this domain ranks for in the selected country's top 100 organic results." },
            { label: "Traffic value", value: formatMoney(data.trafficValue), hint: "What this organic traffic would cost per month to buy through Google Ads at current CPCs." },
            { label: "Ranking pages", value: formatCount(data.totalPages), hint: "How many pages on this domain rank for at least one keyword in the selected country." },
          ]}
        />
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <SectionTitle sub="Driving the most estimated traffic">Top keywords</SectionTitle>
          <RankedKeywordsTable rows={data.topKeywords} compact />
        </div>
        <div className="min-w-0 space-y-2">
          <SectionTitle sub="Earning the most estimated traffic">Top pages</SectionTitle>
          <PagesTable rows={data.topPages} />
        </div>
      </div>
    </section>
  );
}

export function WebsiteTrafficCheckerTool({ initial }: { initial?: { target?: string; compare?: string; loc?: number } }) {
  const runner = useToolRunner();
  const [target, setTarget] = useState(initial?.target ?? "");
  const [compare, setCompare] = useState(initial?.compare ?? "");
  const [locationCode, setLocationCode] = useState(initial?.loc ?? runner.defaultLocationCode);
  const { status, errorMessage, result, submit, tool } = useToolRun<TrafficCheckResult>("website-traffic-checker");
  const loading = status === "loading";

  return (
    <div className="space-y-5">
      <ToolForm
        slug="website-traffic-checker"
        status={status}
        errorMessage={errorMessage}
        submitLabel="Check traffic"
        costHint={`3 DataForSEO calls per domain (~$0.045) · cached 24 h`}
        onSubmit={(token) => submit({ target, compare: compare.trim() || undefined, locationCode }, token)}
      >
        <div className="grid gap-3 md:grid-cols-3">
          <Field id="traffic-target" label="Domain">
            <Input
              id="traffic-target"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              required
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={runner.projectDomain || "example.com"}
              disabled={loading}
              className={FIELD_CLASS}
            />
          </Field>
          <Field id="traffic-compare" label="Compare with (optional)">
            <Input
              id="traffic-compare"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={compare}
              onChange={(e) => setCompare(e.target.value)}
              placeholder="competitor.com"
              disabled={loading}
              className={FIELD_CLASS}
            />
          </Field>
          <Field id="traffic-country" label="Country">
            <CountrySelect id="traffic-country" value={locationCode} onChange={setLocationCode} disabled={loading} />
          </Field>
        </div>
      </ToolForm>

      {status === "done" && result && (
        <Reveal className="space-y-6">
          {result.comparison && (
            <section className="space-y-2">
              <SectionTitle sub="Traffic is estimated from rankings. Traffic value estimates the monthly cost of equivalent Google Ads clicks.">
                Compare domains
              </SectionTitle>
              <CompareTable a={result.primary} b={result.comparison} />
            </section>
          )}
          <DomainReport data={result.primary} locationCode={result.locationCode} showMetrics={!result.comparison} />
          {result.comparison && <DomainReport data={result.comparison} locationCode={result.locationCode} showMetrics={false} />}
          <UpsellCard tool={tool} query={{ domain: result.primary.domain, loc: result.locationCode }} />
        </Reveal>
      )}
    </div>
  );
}
