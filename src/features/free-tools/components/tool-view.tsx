"use client";

import { TOOL_COUNTRIES } from "../lib/countries";
import type { FreeToolSlug } from "../lib/registry";
import { BacklinkCheckerTool } from "./tools/backlink-checker";
import { CompetitorAnalysisTool } from "./tools/competitor-analysis";
import { DomainAgeCheckerTool } from "./tools/domain-age-checker";
import { CompetitorKeywordFinderTool, KeywordGeneratorTool } from "./tools/keyword-discovery";
import { SerpSimulatorTool } from "./tools/serp-simulator";
import { SpamScoreCheckerTool } from "./tools/spam-score-checker";
import { WebsiteTrafficCheckerTool } from "./tools/website-traffic-checker";

function loc(v: string | undefined): number | undefined {
  const n = Number(v);
  return TOOL_COUNTRIES.some((c) => c.code === n) ? n : undefined;
}

/** Renders one tool. `initial` = optional prefill from the URL (`?target=`, `?q=`, `?loc=` …). */
export function ToolView({ slug, initial = {} }: { slug: FreeToolSlug; initial?: Record<string, string | undefined> }) {
  const clip = (v: string | undefined, max = 300) => (v ? v.slice(0, max) : undefined);
  switch (slug) {
    case "backlink-checker":
      return <BacklinkCheckerTool initial={{ target: clip(initial.target) }} />;
    case "spam-score-checker":
      return <SpamScoreCheckerTool initial={{ target: clip(initial.target) }} />;
    case "website-traffic-checker":
      return <WebsiteTrafficCheckerTool initial={{ target: clip(initial.target), compare: clip(initial.compare), loc: loc(initial.loc) }} />;
    case "competitor-analysis":
      return <CompetitorAnalysisTool initial={{ competitor: clip(initial.competitor ?? initial.target), yours: clip(initial.yours), loc: loc(initial.loc) }} />;
    case "competitor-keyword-finder":
      return <CompetitorKeywordFinderTool initial={{ target: clip(initial.target), loc: loc(initial.loc) }} />;
    case "keyword-generator":
      return <KeywordGeneratorTool initial={{ keyword: clip(initial.keyword ?? initial.q, 100), loc: loc(initial.loc) }} />;
    case "domain-age-checker":
      return <DomainAgeCheckerTool initial={{ domains: clip(initial.domains ?? initial.target, 3000) }} />;
    case "serp-simulator":
      return <SerpSimulatorTool initial={{ title: clip(initial.title), description: clip(initial.description, 1000), url: clip(initial.url, 2000) }} />;
  }
}
