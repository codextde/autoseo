import { notFound } from "next/navigation";
import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageContainer, TabNav } from "@/components/app/page";
import { requireProject } from "@/server/auth/guards";
import {
  getAudit,
  getAuditHistory,
  getAuditOverview,
  getAuditPages,
  getAuditStatus,
  getIssueSamples,
  type AuditPagesFilter,
} from "@/server/audit-crawler/service";
import { AuditHeader } from "@/features/audit/components/audit-header";
import { AuditProgress } from "@/features/audit/components/audit-progress";
import { AuditBanners } from "@/features/audit/components/banners";
import { ResultsOverview } from "@/features/audit/components/results-overview";
import { IssuesView } from "@/features/audit/components/issues-view";
import { PagesTable, type PagesFilterState } from "@/features/audit/components/pages-table";
import { PerformanceTable } from "@/features/audit/components/performance-table";

const PAGE_SIZE = 50;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function AuditDetailPage({ params, searchParams }: PageProps<"/p/[projectId]/seo/audit/[auditId]">) {
  const { projectId, auditId } = await params;
  const sp = await searchParams;
  const ctx = await requireProject(projectId, "project.view");
  const canRun = ctx.permissions.has("seo.run") || ctx.isInstanceAdmin;
  const audit = await getAudit(projectId, auditId);
  if (!audit) notFound();
  const base = `/p/${projectId}/seo/audit/${auditId}`;
  const history = await getAuditHistory(projectId, 100);
  const previous = history.find((h) => h.status === "completed" && h.id !== audit.id && h.startedAt < audit.startedAt) ?? null;
  const header = (
    <AuditHeader
      projectId={projectId}
      previousId={previous?.id ?? null}
      canRun={canRun}
      showExport={audit.status !== "queued" && audit.status !== "running"}
      audit={{
        id: audit.id,
        startUrl: audit.startUrl,
        status: audit.status,
        startedAt: audit.startedAt.toISOString(),
        completedAt: audit.completedAt?.toISOString() ?? null,
        maxPages: audit.config.maxPages,
        lighthouse: audit.config.lighthouseStrategy !== "none",
        provider: audit.config.lighthouseProvider,
        trigger: audit.trigger,
      }}
    />
  );

  if (audit.status === "queued" || audit.status === "running") {
    const status = (await getAuditStatus(projectId, auditId, 40))!;
    let host: string | null = null;
    try {
      host = new URL(audit.startUrl).hostname;
    } catch {
      host = null;
    }
    return (
      <PageContainer>
        {header}
        <AuditProgress
          projectId={projectId}
          auditId={auditId}
          canRun={canRun}
          lighthouseEnabled={audit.config.lighthouseStrategy !== "none"}
          predominantHost={host}
          initial={{ ...status, feed: status.feed }}
        />
      </PageContainer>
    );
  }

  const overview = await getAuditOverview(projectId, auditId);
  const hasPerformance = overview.lighthouse.rows.length > 0;
  const requested = one(sp.tab) ?? "issues";
  const tab = requested === "performance" && !hasPerformance ? "issues" : ["issues", "pages", "performance"].includes(requested) ? requested : "issues";

  const tabHref = (t: string) => {
    const q = new URLSearchParams();
    if (t !== "issues") q.set("tab", t);
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };
  const counts = audit.issueCounts ?? {
    critical: overview.summary.filter((s) => s.severity === "critical").reduce((a, s) => a + s.count, 0),
    warning: overview.summary.filter((s) => s.severity === "warning").reduce((a, s) => a + s.count, 0),
    info: overview.summary.filter((s) => s.severity === "info").reduce((a, s) => a + s.count, 0),
    total: overview.summary.reduce((a, s) => a + s.count, 0),
    types: overview.summary.length,
  };

  let content: React.ReactNode;
  if (tab === "pages") {
    const filters: PagesFilterState = {
      q: one(sp.q) ?? "",
      status: one(sp.status) ?? "all",
      idx: one(sp.idx) ?? "all",
      alt: one(sp.alt) ?? "all",
      sort: one(sp.sort) ?? "url",
      dir: one(sp.dir) === "desc" ? "desc" : "asc",
      page: Math.max(0, Number(one(sp.page) ?? 0) || 0),
    };
    const status = ["2xx", "3xx", "4xx", "5xx", "error", "blocked"].includes(filters.status) ? (filters.status as AuditPagesFilter["status"]) : null;
    const { pages, total } = await getAuditPages(projectId, auditId, {
      search: filters.q || null,
      status,
      indexable: filters.idx === "yes" || filters.idx === "no" ? filters.idx : null,
      missingAlt: filters.alt === "missing",
      withIssues: filters.alt === "issues",
      sort: filters.sort,
      dir: filters.dir,
      limit: PAGE_SIZE,
      offset: filters.page * PAGE_SIZE,
    });
    content = <PagesTable base={base} rows={pages} total={total} pageSize={PAGE_SIZE} filters={filters} predominantHost={overview.predominantHost} />;
  } else if (tab === "performance") {
    content = <PerformanceTable base={base} rows={overview.lighthouse.rows} predominantHost={overview.predominantHost} />;
  } else {
    const samples = await getIssueSamples(projectId, auditId, 20);
    content = <IssuesView base={base} summary={overview.summary} samples={samples} predominantHost={overview.predominantHost} />;
  }

  const banners = (
    <AuditBanners
      status={audit.status}
      pagesCrawled={audit.pagesCrawled}
      maxPages={audit.config.maxPages}
      errorCode={audit.errorCode}
      errorDetail={audit.errorDetail}
      blocked={overview.pages.blocked}
      rateLimitedPages={overview.pages.rateLimited}
      rateLimited={audit.rateLimited}
      crawlCompleted={audit.crawlCompleted}
      stopRequested={audit.stopRequested}
    />
  );
  if (overview.pages.total === 0) {
    return (
      <PageContainer>
        {header}
        {banners}
        <EmptyState
          icon={SearchX}
          title="No pages were crawled"
          description="Check that the start URL loads in a browser, isn't disallowed by robots.txt for all user agents, and isn't behind bot protection — then re-run the audit."
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      {header}
      {banners}
      <ResultsOverview
        base={base}
        score={audit.score}
        counts={counts}
        pages={overview.pages}
        lighthouse={overview.lighthouse}
        categories={overview.categories}
      />
      <TabNav
        active={tab}
        tabs={[
          { key: "issues", label: `Issues (${overview.summary.length})`, href: tabHref("issues") },
          { key: "pages", label: `Pages (${overview.pages.total.toLocaleString()})`, href: tabHref("pages") },
          ...(hasPerformance ? [{ key: "performance", label: `Performance (${overview.lighthouse.rows.length})`, href: tabHref("performance") }] : []),
        ]}
      />
      {content}
    </PageContainer>
  );
}
