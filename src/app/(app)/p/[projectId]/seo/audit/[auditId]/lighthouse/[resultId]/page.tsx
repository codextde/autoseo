import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, Monitor, Smartphone } from "lucide-react";
import { format } from "date-fns";
import { PageContainer, Panel } from "@/components/app/page";
import { EmptyState } from "@/components/app/empty-state";
import { requireProject } from "@/server/auth/guards";
import { getLighthouseResult } from "@/server/audit-crawler/service";
import { LighthouseIssues } from "@/features/audit/components/lighthouse-view";
import { ScoreGauge, SeverityBadge } from "@/features/audit/components/bits";

const METRICS = [
  ["firstContentfulPaint", "FCP", "First Contentful Paint"],
  ["largestContentfulPaint", "LCP", "Largest Contentful Paint"],
  ["totalBlockingTime", "TBT", "Total Blocking Time"],
  ["speedIndex", "SI", "Speed Index"],
  ["timeToInteractive", "TTI", "Time to Interactive"],
  ["cumulativeLayoutShift", "CLS", "Cumulative Layout Shift"],
  ["interactionToNextPaint", "INP", "Interaction to Next Paint"],
  ["serverResponseTime", "TTFB", "Server response time"],
] as const;

export default async function LighthouseResultPage({ params }: PageProps<"/p/[projectId]/seo/audit/[auditId]/lighthouse/[resultId]">) {
  const { projectId, auditId, resultId } = await params;
  await requireProject(projectId, "project.view");
  const data = await getLighthouseResult(projectId, auditId, resultId, "all");
  if (!data) notFound();
  const { payload, result, audit } = data;
  const base = `/p/${projectId}/seo/audit/${auditId}`;
  const sev = { critical: 0, warning: 0, info: 0 };
  for (const i of data.allIssues) sev[i.severity] += 1;

  return (
    <PageContainer>
      <div className="space-y-3">
        <Link href={`${base}?tab=performance`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Site Audit
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-1">
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
              {result.strategy === "mobile" ? <Smartphone className="size-5 text-muted-foreground" /> : <Monitor className="size-5 text-muted-foreground" />}
              Lighthouse Issues
            </h1>
            <a
              href={/^https?:\/\//i.test(data.finalUrl) ? data.finalUrl : result.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex max-w-full items-center gap-1 truncate text-sm text-muted-foreground hover:text-foreground"
            >
              <span className="truncate">{data.finalUrl}</span> <ExternalLink className="size-3 shrink-0" />
            </a>
            <p className="text-xs text-muted-foreground">
              Scanned {format(audit.startedAt, "MMM d, yyyy")} · {result.provider === "dataforseo" ? "DataForSEO Lighthouse" : "PageSpeed Insights"}
              {payload?.metadata.lighthouseVersion ? ` · Lighthouse ${payload.metadata.lighthouseVersion}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(["critical", "warning", "info"] as const).map((s) => (
              <SeverityBadge key={s} severity={s}>
                {sev[s]} {s === "critical" ? "critical" : s === "warning" ? "warnings" : "info"}
              </SeverityBadge>
            ))}
          </div>
        </div>
      </div>

      {!payload ? (
        <EmptyState title="Lighthouse failed for this page" description={result.errorMessage ?? "No report was stored."} />
      ) : (
        <>
          <Panel>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <ScoreGauge score={payload.scores.performance} label="Performance" />
              <ScoreGauge score={payload.scores.accessibility} label="Accessibility" />
              <ScoreGauge score={payload.scores["best-practices"]} label="Best Practices" />
              <ScoreGauge score={payload.scores.seo} label="SEO" />
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {METRICS.map(([key, short, label]) => {
                const m = payload.metrics[key];
                const tone = m.score == null ? "" : m.score >= 90 ? "text-success" : m.score >= 50 ? "text-warning" : "text-destructive";
                return (
                  <div key={key} className="rounded-xl bg-muted/50 px-3 py-2" title={label}>
                    <div className="text-[11px] text-muted-foreground">{short}</div>
                    <div className={`text-base font-semibold tabular ${tone}`}>{m.displayValue ?? "—"}</div>
                  </div>
                );
              })}
            </div>
          </Panel>
          <LighthouseIssues
            issues={data.allIssues}
            hasIssueDetails={data.hasIssueDetails}
            exportBase={`${base}/lighthouse/${resultId}/export`}
            filePrefix={`lighthouse-${result.strategy}-${audit.startedAt.toISOString().slice(0, 10)}`}
          />
        </>
      )}
    </PageContainer>
  );
}
