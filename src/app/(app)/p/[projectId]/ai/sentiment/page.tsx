import { PageContainer, PageHeader, TabNav } from "@/components/app/page";
import { requireProject } from "@/server/auth/guards";
import { getFilterOptions } from "@/server/ai/insights/brands";
import { filterQuery, param, parseInsightFilter } from "@/server/ai/insights/filters";
import {
  getPerception,
  getRecommendations,
  getSentimentContext,
  getSentimentOverview,
  getStatements,
} from "@/server/ai/insights/sentiment";
import { InsightFilters } from "@/features/ai-insights/components/insight-filters";
import { AnswerSheet } from "@/features/ai-insights/components/answer-sheet";
import { CompareSelect } from "@/features/ai-insights/components/sentiment/compare-select";
import { SentimentOverviewView } from "@/features/ai-insights/components/sentiment/overview";
import { PerceptionView } from "@/features/ai-insights/components/sentiment/perception";
import { StatementsView } from "@/features/ai-insights/components/sentiment/statements";
import { RecommendationsView } from "@/features/ai-insights/components/sentiment/recommendations";

export const metadata = { title: "Sentiment" };

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "perception", label: "Perception" },
  { key: "praise", label: "Praise" },
  { key: "criticism", label: "Criticism" },
  { key: "recommendations", label: "Recommendations" },
] as const;
type Tab = (typeof TABS)[number]["key"];

export default async function SentimentPage({ params, searchParams }: PageProps<"/p/[projectId]/ai/sentiment">) {
  const { projectId } = await params;
  const ctx = await requireProject(projectId);
  const sp = await searchParams;
  const f = parseInsightFilter(projectId, sp);
  const tabParam = param(sp, "tab");
  const tab: Tab = TABS.some((t) => t.key === tabParam) ? (tabParam as Tab) : "overview";
  const compareParam = param(sp, "compare");
  const [sctx, options] = await Promise.all([getSentimentContext(ctx.project, f, compareParam), getFilterOptions(ctx.project)]);
  const keep = { compare: compareParam ?? null };

  let body: React.ReactNode;
  if (tab === "perception") {
    const data = await getPerception(ctx.project, f, sctx);
    body = <PerceptionView data={data} own={sctx.own} compare={sctx.compare} brands={sctx.brands} />;
  } else if (tab === "praise" || tab === "criticism") {
    const rows = await getStatements(ctx.project, f, tab);
    body = <StatementsView key={tab} rows={rows} polarity={tab} own={sctx.own} brands={sctx.brands} />;
  } else if (tab === "recommendations") {
    const data = await getRecommendations(ctx.project, f, sctx);
    body = <RecommendationsView data={data} own={sctx.own} brands={sctx.brands} />;
  } else {
    const data = await getSentimentOverview(ctx.project, f, sctx);
    body = <SentimentOverviewView data={data} own={sctx.own} compare={sctx.compare} brands={sctx.brands} />;
  }

  return (
    <PageContainer>
      <PageHeader title="Sentiment" description="What AI engines praise and criticise about you and your competitors — and whom they recommend." />
      <TabNav
        active={tab}
        tabs={TABS.map((t) => ({ key: t.key, label: t.label, href: `/p/${projectId}/ai/sentiment${filterQuery(f, { ...keep, tab: t.key === "overview" ? null : t.key })}` }))}
      />
      <InsightFilters options={options}>
        <CompareSelect own={sctx.own} brands={sctx.brands} compare={sctx.compare} />
      </InsightFilters>
      {body}
      <AnswerSheet projectId={projectId} />
    </PageContainer>
  );
}
