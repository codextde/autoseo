"use client";

import { useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { countryLabel } from "../../lib/countries";
import type { KeywordFinderResult, KeywordGeneratorResult } from "../../lib/types";
import { CountrySelect, Field, FIELD_CLASS, ToolForm } from "../form";
import { useToolRun, useToolRunner } from "../runner";
import { DomainTitle, FeatureLink, Reveal, SaveKeywordsButton, SectionTitle, UpsellCard } from "../results";
import { KeywordIdeasTable, RankedKeywordsTable } from "../tables";

function CrossLink({ text, slug, label }: { text: string; slug: "competitor-analysis" | "competitor-keyword-finder"; label: string }) {
  const runner = useToolRunner();
  return (
    <p className="text-sm text-muted-foreground">
      {text}{" "}
      <Link href={runner.toolHref(slug)} className="font-medium text-foreground underline decoration-brand underline-offset-4">
        {label} →
      </Link>
    </p>
  );
}

export function CompetitorKeywordFinderTool({ initial }: { initial?: { target?: string; loc?: number } }) {
  const runner = useToolRunner();
  const [target, setTarget] = useState(initial?.target ?? "");
  const [locationCode, setLocationCode] = useState(initial?.loc ?? runner.defaultLocationCode);
  const { status, errorMessage, result, submit, tool } = useToolRun<KeywordFinderResult>("competitor-keyword-finder");
  const loading = status === "loading";

  return (
    <div className="space-y-5">
      <ToolForm
        slug="competitor-keyword-finder"
        status={status}
        errorMessage={errorMessage}
        submitLabel="Find keywords"
        loadingLabel="Finding…"
        costHint="1 DataForSEO call (~$0.015) · cached 24 h"
        onSubmit={(token) => submit({ target, locationCode }, token)}
      >
        <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
          <Field id="ckf-target" label="Competitor domain">
            <Input
              id="ckf-target"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              required
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="competitor.com"
              disabled={loading}
              className={FIELD_CLASS}
            />
          </Field>
          <Field id="ckf-country" label="Country">
            <CountrySelect id="ckf-country" value={locationCode} onChange={setLocationCode} disabled={loading} />
          </Field>
        </div>
      </ToolForm>
      {status !== "done" && <CrossLink text="Want their top pages and a comparison with your site?" slug="competitor-analysis" label="Try Competitor Analysis" />}

      {status === "done" && result && (
        <Reveal className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <DomainTitle domain={result.target} sub={`Top organic keywords · ${countryLabel(result.locationCode)}`} />
            <FeatureLink tool={tool} query={{ domain: result.target, loc: result.locationCode }} />
          </div>
          <section className="space-y-2">
            <SectionTitle
              sub="Up to 20 keywords, starting with those estimated to bring the most Google traffic."
              actions={<SaveKeywordsButton keywords={result.keywords} locationCode={result.locationCode} />}
            >
              Ranking keywords
            </SectionTitle>
            <RankedKeywordsTable rows={result.keywords} />
          </section>
          <UpsellCard tool={tool} query={{ domain: result.target, loc: result.locationCode }} />
        </Reveal>
      )}
    </div>
  );
}

export function KeywordGeneratorTool({ initial }: { initial?: { keyword?: string; loc?: number } }) {
  const runner = useToolRunner();
  const [keyword, setKeyword] = useState(initial?.keyword ?? "");
  const [locationCode, setLocationCode] = useState(initial?.loc ?? runner.defaultLocationCode);
  const { status, errorMessage, result, submit, tool } = useToolRun<KeywordGeneratorResult>("keyword-generator");
  const loading = status === "loading";

  return (
    <div className="space-y-5">
      <ToolForm
        slug="keyword-generator"
        status={status}
        errorMessage={errorMessage}
        submitLabel="Generate keywords"
        loadingLabel="Generating…"
        costHint="1 DataForSEO call (~$0.015) · cached 24 h"
        onSubmit={(token) => submit({ keyword, locationCode }, token)}
      >
        <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
          <Field id="kg-keyword" label="Topic or seed keyword">
            <Input
              id="kg-keyword"
              autoComplete="off"
              required
              maxLength={100}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="e.g. running shoes"
              disabled={loading}
              className={FIELD_CLASS}
            />
          </Field>
          <Field id="kg-country" label="Country">
            <CountrySelect id="kg-country" value={locationCode} onChange={setLocationCode} disabled={loading} />
          </Field>
        </div>
      </ToolForm>
      {status !== "done" && <CrossLink text="Already know a competitor in your space?" slug="competitor-keyword-finder" label="Find their ranking keywords" />}

      {status === "done" && result && (
        <Reveal className="space-y-4">
          <section className="space-y-2">
            <SectionTitle
              sub={`Ideas for “${result.keyword}” · ${countryLabel(result.locationCode)} · volume = estimated monthly Google searches`}
              actions={
                <>
                  <SaveKeywordsButton keywords={result.keywords} locationCode={result.locationCode} />
                  <FeatureLink tool={tool} query={{ q: result.keyword, loc: result.locationCode }} label="Research deeper" />
                </>
              }
            >
              Keyword ideas
            </SectionTitle>
            <KeywordIdeasTable rows={result.keywords} />
          </section>
          <UpsellCard tool={tool} query={{ q: result.keyword, loc: result.locationCode }} />
        </Reveal>
      )}
    </div>
  );
}
