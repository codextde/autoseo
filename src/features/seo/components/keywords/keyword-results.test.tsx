/**
 * SSR smoke test for the Keyword Research results view: renders the overview strip, keyword table, filters,
 * trends and SERP panel with a realistic DataForSEO-shaped payload (no provider / DB access).
 */
import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ResearchKeywordsOutput } from "@/server/seo/keywords";
import { EMPTY_KEYWORD_FILTERS } from "@/server/seo/lib/keywords";
import { KeywordResults } from "./keyword-results";
import type { KeywordUrlState } from "./params";

vi.mock("../../actions/keywords", () => ({
  getSerpAnalysisAction: vi.fn(),
  saveKeywordsAction: vi.fn(),
  researchKeywordsAction: vi.fn(),
}));

const trend = Array.from({ length: 12 }, (_, i) => ({ year: 2025 + Math.floor((i + 9) / 12), month: ((i + 9) % 12) + 1, searchVolume: 1000 + i * 50 }));

const result: ResearchKeywordsOutput = {
  rows: [
    { keyword: "solar panel", searchVolume: 18100, trend, cpc: 1.42, competition: 0.61, keywordDifficulty: 48, intent: "commercial" },
    { keyword: "solar panel price", searchVolume: 2400, trend: [], cpc: 2.1, competition: 0.9, keywordDifficulty: 22, intent: "transactional" },
    { keyword: "how do solar panels work", searchVolume: null, trend: [], cpc: null, competition: null, keywordDifficulty: null, intent: "informational" },
  ],
  source: "related",
  usedFallback: false,
  diagnostics: { requestedMode: "auto", threshold: 5, sourceAttempts: [{ source: "related", rowCount: 3, nonSeedCount: 2 }] },
  seed: "solar panel",
  locationCode: 2276,
  languageCode: "de",
  provider: "labs",
  cached: false,
  fetchedAt: "2026-09-25T10:00:00.000Z",
};

const state: KeywordUrlState = {
  keyword: "solar panel",
  loc: 2276,
  kLimit: 150,
  mode: "auto",
  cs: false,
  sort: "searchVolume",
  order: "desc",
  kw: null,
  page: 1,
  size: 50,
  filters: { ...EMPTY_KEYWORD_FILTERS },
};

function render(overrides: Partial<KeywordUrlState> = {}, res: ResearchKeywordsOutput = result) {
  // React separates adjacent text nodes with <!-- --> markers in SSR output.
  return renderToString(
    <TooltipProvider>
      <KeywordResults projectId="prj_test" canRun result={res} state={{ ...state, ...overrides }} setParams={() => undefined} />
    </TooltipProvider>,
  ).replaceAll("<!-- -->", "");
}

describe("KeywordResults", () => {
  it("renders the overview strip, table rows, trends and SERP panel", () => {
    const html = render();
    expect(html).toContain("Solar panel");
    expect(html).toContain("solar panel price");
    expect(html).toContain("18,100");
    expect(html).toContain("Showing 3 keywords");
    expect(html).toContain("Search Trends");
    expect(html).toContain("SERP Analysis: Solar panel");
  });

  it("applies URL filters client-side and reports the filtered count", () => {
    const html = render({ filters: { ...EMPTY_KEYWORD_FILTERS, intents: "transactional" } });
    expect(html).toContain("Showing 1 of 3 keywords");
    expect(html).not.toContain(">how do solar panels work<");
  });

  it("shows the approximate-match warning for manual modes without an exact seed row", () => {
    const html = render({}, {
      ...result,
      seed: "solar panels",
      diagnostics: { ...result.diagnostics, requestedMode: "suggestions" },
    });
    expect(html).toContain("No exact match for");
  });
});
