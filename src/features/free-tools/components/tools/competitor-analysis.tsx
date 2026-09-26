"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { countryLabel } from "../../lib/countries";
import type { CompetitorAnalysisResult, OrganicMetrics } from "../../lib/types";
import { CountrySelect, Field, FIELD_CLASS, ToolForm } from "../form";
import { useToolRun, useToolRunner } from "../runner";
import { DomainTitle, FeatureLink, formatCount, formatMoney, Reveal, SaveKeywordsButton, SectionTitle, UpsellCard } from "../results";
import { PagesTable, RankedKeywordsTable } from "../tables";

const ROWS: { label: string; key: keyof OrganicMetrics; format: (v: number | null) => string }[] = [
  { label: "Estimated visits / month", key: "organicTraffic", format: formatCount },
  { label: "Organic keywords", key: "organicKeywords", format: formatCount },
  { label: "Traffic value / month", key: "trafficValue", format: formatMoney },
];

function Comparison({ result }: { result: CompetitorAnalysisResult }) {
  if (!result.comparison || !result.yourDomain) return null;
  const { you, competitor } = result.comparison;
  return (
    <section className="space-y-2">
      <SectionTitle sub="Estimated from rankings — not either site's analytics.">Organic comparison</SectionTitle>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[440px] text-left text-sm">
          <thead>
            <tr className="border-b bg-muted/60 text-xs text-muted-foreground">
              <th className="px-3 py-2.5 font-medium">Metric</th>
              <th className="px-3 py-2.5 text-right font-medium break-words">
                {result.yourDomain} <span className="font-normal">(you)</span>
              </th>
              <th className="px-3 py-2.5 text-right font-medium break-words">{result.competitor}</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => {
              const a = you[r.key];
              const b = competitor[r.key];
              const ahead = a != null && b != null && a !== b ? (a > b ? 0 : 1) : null;
              return (
                <tr key={r.key} className="border-b last:border-0">
                  <th scope="row" className="px-3 py-3 font-normal text-muted-foreground">
                    {r.label}
                  </th>
                  {[a, b].map((v, i) => (
                    <td key={i} className="px-3 py-3 text-right font-semibold tabular">
                      <span className={ahead === i ? "rounded-md bg-brand-soft px-1.5 py-0.5" : undefined}>{r.format(v)}</span>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function CompetitorAnalysisTool({ initial }: { initial?: { competitor?: string; yours?: string; loc?: number } }) {
  const runner = useToolRunner();
  const [competitor, setCompetitor] = useState(initial?.competitor ?? "");
  const [yourDomain, setYourDomain] = useState(initial?.yours ?? runner.projectDomain ?? "");
  const [locationCode, setLocationCode] = useState(initial?.loc ?? runner.defaultLocationCode);
  const { status, errorMessage, result, submit, tool } = useToolRun<CompetitorAnalysisResult>("competitor-analysis");
  const loading = status === "loading";

  return (
    <div className="space-y-5">
      <ToolForm
        slug="competitor-analysis"
        status={status}
        errorMessage={errorMessage}
        submitLabel="Analyze competitor"
        loadingLabel="Analyzing…"
        costHint={yourDomain.trim() ? "5 DataForSEO calls (~$0.075) · cached 24 h" : "2 DataForSEO calls (~$0.03) · cached 24 h"}
        onSubmit={(token) => submit({ competitor, yourDomain: yourDomain.trim() || undefined, locationCode }, token)}
      >
        <div className="grid gap-3 md:grid-cols-3">
          <Field id="ca-competitor" label="Competitor domain">
            <Input
              id="ca-competitor"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              required
              value={competitor}
              onChange={(e) => setCompetitor(e.target.value)}
              placeholder="competitor.com"
              disabled={loading}
              className={FIELD_CLASS}
            />
          </Field>
          <Field id="ca-yours" label="Your domain (optional)">
            <Input
              id="ca-yours"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={yourDomain}
              onChange={(e) => setYourDomain(e.target.value)}
              placeholder="yoursite.com"
              disabled={loading}
              className={FIELD_CLASS}
            />
          </Field>
          <Field id="ca-country" label="Country">
            <CountrySelect id="ca-country" value={locationCode} onChange={setLocationCode} disabled={loading} />
          </Field>
        </div>
      </ToolForm>

      {status === "done" && result && (
        <Reveal className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <DomainTitle domain={result.competitor} sub={`Organic search · ${countryLabel(result.locationCode)}`} />
            <FeatureLink tool={tool} query={{ domain: result.competitor, loc: result.locationCode }} />
          </div>
          <Comparison result={result} />
          <section className="space-y-2">
            <SectionTitle
              sub={result.totalKeywords != null ? `Top ${result.keywords.length} of ${formatCount(result.totalKeywords)} ranking keywords, by estimated traffic` : undefined}
              actions={<SaveKeywordsButton keywords={result.keywords} locationCode={result.locationCode} />}
            >
              Their best keywords
            </SectionTitle>
            <RankedKeywordsTable rows={result.keywords} />
          </section>
          <section className="space-y-2">
            <SectionTitle sub={result.totalPages != null ? `Top ${result.pages.length} of ${formatCount(result.totalPages)} ranking pages` : undefined}>Their best pages</SectionTitle>
            <PagesTable rows={result.pages} />
          </section>
          {result.yourDomain && (
            <section className="space-y-2">
              <SectionTitle
                sub={`Keywords ${result.competitor} ranks for that ${result.yourDomain} doesn't, sorted by their traffic.`}
                actions={result.gap?.length ? <SaveKeywordsButton keywords={result.gap} locationCode={result.locationCode} label="Save gap" /> : undefined}
              >
                Keyword gap
              </SectionTitle>
              {result.gapFailed ? (
                <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-3 text-sm">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                  The keyword gap couldn&apos;t be loaded this time. The rest of the report is complete — try again in a couple of minutes.
                </div>
              ) : (
                <RankedKeywordsTable rows={result.gap ?? []} />
              )}
            </section>
          )}
          <UpsellCard tool={tool} query={{ domain: result.competitor, loc: result.locationCode }} />
        </Reveal>
      )}
    </div>
  );
}
