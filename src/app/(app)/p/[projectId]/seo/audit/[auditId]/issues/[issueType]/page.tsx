import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, Lightbulb, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageContainer, Panel } from "@/components/app/page";
import { requireProject } from "@/server/auth/guards";
import { getAudit, getAuditIssues } from "@/server/audit-crawler/service";
import { getIssueDescriptor, ISSUE_CATEGORIES } from "@/server/audit-crawler/registry";
import { AffectedTable } from "@/features/audit/components/affected-table";
import { hostOf, SeverityBadge } from "@/features/audit/components/bits";

const PAGE_SIZE = 100;

export default async function AuditIssuePage({ params, searchParams }: PageProps<"/p/[projectId]/seo/audit/[auditId]/issues/[issueType]">) {
  const { projectId, auditId, issueType } = await params;
  const sp = await searchParams;
  await requireProject(projectId, "project.view");
  const descriptor = getIssueDescriptor(issueType);
  const audit = await getAudit(projectId, auditId);
  if (!audit || !descriptor) notFound();
  const q = typeof sp.q === "string" ? sp.q : "";
  const page = Math.max(0, Number(typeof sp.page === "string" ? sp.page : 0) || 0);
  const { issues, total } = await getAuditIssues(projectId, auditId, { issueType, search: q || null, limit: PAGE_SIZE, offset: page * PAGE_SIZE });
  const base = `/p/${projectId}/seo/audit/${auditId}`;
  let host: string | null = null;
  try {
    host = new URL(audit.startUrl).hostname;
  } catch {
    host = null;
  }
  return (
    <PageContainer>
      <div className="space-y-3">
        <Link href={base} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> {hostOf(audit.startUrl)} audit
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={descriptor.severity} />
              <span className="text-xs text-muted-foreground">{ISSUE_CATEGORIES[descriptor.category].label}</span>
            </div>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{descriptor.title}</h1>
            <p className="text-sm text-muted-foreground tabular">
              {total.toLocaleString()} affected {total === 1 ? "URL" : "URLs"}
              {q ? ` matching “${q}”` : ""}
            </p>
          </div>
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <a href={`${base}/export?kind=issues&format=csv&issueType=${issueType}`}>
              <Download className="size-3.5" /> Export CSV
            </a>
          </Button>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Why it matters" icon={<Lightbulb className="size-4 text-muted-foreground" />}>
          <p className="text-sm text-muted-foreground">{descriptor.explanation}</p>
        </Panel>
        <Panel title="How to fix" icon={<Wrench className="size-4 text-muted-foreground" />}>
          <p className="text-sm">{descriptor.howToFix}</p>
        </Panel>
      </div>
      <Panel title="Affected URLs" contentClassName="p-3 sm:p-4">
        <AffectedTable
          base={base}
          rows={issues.map((i) => ({ id: i.id, pageId: i.pageId, pageUrl: i.pageUrl, details: i.details }))}
          total={total}
          page={page}
          pageSize={PAGE_SIZE}
          q={q}
          predominantHost={host}
        />
      </Panel>
    </PageContainer>
  );
}
