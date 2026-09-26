import Link from "next/link";
import { ArrowLeft, GitCompare } from "lucide-react";
import { format } from "date-fns";
import { PageContainer, PageHeader, Panel } from "@/components/app/page";
import { ScoreRing } from "@/components/app/charts";
import { Delta } from "@/components/app/metrics";
import { EmptyState } from "@/components/app/empty-state";
import { requireProject } from "@/server/auth/guards";
import { compareAudits, getAuditHistory } from "@/server/audit-crawler/service";
import { CompareSelectors, CompareTable, IssueDiffLists } from "@/features/audit/components/compare-view";
import { hostOf, scoreTone } from "@/features/audit/components/bits";

export default async function CompareAuditsPage({ params, searchParams }: PageProps<"/p/[projectId]/seo/audit/compare">) {
  const { projectId } = await params;
  const sp = await searchParams;
  await requireProject(projectId, "project.view");
  const history = (await getAuditHistory(projectId, 100)).filter((h) => h.status === "completed");
  const back = (
    <Link href={`/p/${projectId}/seo/audit`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-3.5" /> All audits
    </Link>
  );
  if (history.length < 2) {
    return (
      <PageContainer>
        {back}
        <EmptyState icon={GitCompare} title="Run at least two audits to compare" description="Comparisons show which issues are new, which were fixed, and how the health score moved." action={{ label: "Start an audit", href: `/p/${projectId}/seo/audit` }} />
      </PageContainer>
    );
  }
  const aId = typeof sp.a === "string" && history.some((h) => h.id === sp.a) ? sp.a : history[1]!.id;
  const bId = typeof sp.b === "string" && history.some((h) => h.id === sp.b) ? sp.b : history[0]!.id;
  const data = await compareAudits(projectId, aId, bId);
  const options = history.map((h) => ({ id: h.id, label: `${format(h.startedAt, "MMM d, yyyy HH:mm")} · ${hostOf(h.startUrl)}`, score: h.score }));
  const cA = data.base.issueCounts ?? { critical: 0, warning: 0, info: 0, total: 0 };
  const cB = data.target.issueCounts ?? { critical: 0, warning: 0, info: 0, total: 0 };
  const scoreDelta = data.base.score != null && data.target.score != null ? data.target.score - data.base.score : null;
  const tiles = [
    { label: "Pages crawled", a: data.base.pagesCrawled, b: data.target.pagesCrawled, invert: false },
    { label: "Errors", a: cA.critical, b: cB.critical, invert: true },
    { label: "Warnings", a: cA.warning, b: cB.warning, invert: true },
    { label: "Notices", a: cA.info, b: cB.info, invert: true },
  ];
  return (
    <PageContainer>
      {back}
      <PageHeader title="Compare audits" description="See how technical SEO changed between two runs." actions={<CompareSelectors options={options} a={aId} b={bId} />} />
      <section className="grid gap-4 rounded-2xl border bg-card p-4 shadow-soft sm:p-5 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center">
        <div className="flex items-center justify-center gap-4 sm:gap-6">
          <div className="flex flex-col items-center gap-1">
            <ScoreRing value={data.base.score ?? 0} size={92} stroke={8} label="before" color={scoreTone(data.base.score).color} />
            <span className="text-[11px] text-muted-foreground">{format(data.base.startedAt, "MMM d")}</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-2xl font-semibold tabular">{scoreDelta == null ? "—" : `${scoreDelta > 0 ? "+" : ""}${scoreDelta}`}</span>
            <span className="text-[11px] text-muted-foreground">points</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <ScoreRing value={data.target.score ?? 0} size={92} stroke={8} label="after" color={scoreTone(data.target.score).color} />
            <span className="text-[11px] text-muted-foreground">{format(data.target.startedAt, "MMM d")}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-xl bg-muted/50 px-3 py-2.5">
              <div className="text-[11px] text-muted-foreground">{t.label}</div>
              <div className="mt-0.5 flex items-baseline gap-2">
                <span className="text-lg font-semibold tabular">{t.b.toLocaleString()}</span>
                <Delta value={t.b - t.a} invert={t.invert} digits={0} />
              </div>
              <div className="text-[11px] text-muted-foreground tabular">was {t.a.toLocaleString()}</div>
            </div>
          ))}
        </div>
      </section>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Issues by type" contentClassName="p-3 sm:p-4">
          <CompareTable rows={data.rows} />
        </Panel>
        <Panel title="Issue changes" description="Matched by issue type and URL path" contentClassName="p-3 sm:p-4">
          <IssueDiffLists
            newIssues={data.newIssues}
            resolved={data.resolvedIssues}
            newCount={data.newCount}
            resolvedCount={data.resolvedCount}
            baseA={`/p/${projectId}/seo/audit/${aId}`}
            baseB={`/p/${projectId}/seo/audit/${bId}`}
          />
        </Panel>
      </div>
    </PageContainer>
  );
}
