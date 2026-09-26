import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, FileText, Heading, Image as ImageIcon, Link2, ListChecks, Monitor, Smartphone, Tags } from "lucide-react";
import { format } from "date-fns";
import { PageContainer, Panel } from "@/components/app/page";
import { ScoreRing } from "@/components/app/charts";
import { EmptyState } from "@/components/app/empty-state";
import { requireProject } from "@/server/auth/guards";
import { getAuditPage } from "@/server/audit-crawler/service";
import { formatDetails, formatMs, HttpStatusBadge, pathOf, scoreTone, ScorePill, SeverityBadge, SeverityIcon } from "@/features/audit/components/bits";
import { cn } from "@/lib/utils";

function Row({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b py-2.5 last:border-0 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm break-words">
        {children}
        {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
      </dd>
    </div>
  );
}

function Missing() {
  return <span className="text-muted-foreground italic">missing</span>;
}

export default async function AuditPageDetail({ params }: PageProps<"/p/[projectId]/seo/audit/[auditId]/pages/[pageId]">) {
  const { projectId, auditId, pageId } = await params;
  await requireProject(projectId, "project.view");
  const data = await getAuditPage(projectId, auditId, pageId);
  if (!data) notFound();
  const { page, issues, links, inbound, lighthouse, duplicates, audit } = data;
  const base = `/p/${projectId}/seo/audit/${auditId}`;
  const host = (() => {
    try {
      return new URL(audit.startUrl).hostname;
    } catch {
      return null;
    }
  })();
  const internal = links.filter((l) => l.i);
  const external = links.filter((l) => !l.i);
  const isContent = page.fetchClass === "ok" && (page.statusCode ?? 0) >= 200 && (page.statusCode ?? 0) < 300;
  const headingCounts = [page.h1Count, page.h2Count, page.h3Count, page.h4Count, page.h5Count, page.h6Count];

  return (
    <PageContainer>
      <div className="space-y-3">
        <Link href={`${base}?tab=pages`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> All pages
        </Link>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <HttpStatusBadge status={page.statusCode} fetchClass={page.fetchClass} />
              {!page.isIndexable && isContent && <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px]">noindex</span>}
              {page.inSitemap && <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px]">in sitemap</span>}
            </div>
            <h1 className="text-lg font-semibold tracking-tight break-all sm:text-xl">{pathOf(page.url, host)}</h1>
            <a href={page.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              {page.url} <ExternalLink className="size-3" />
            </a>
          </div>
          {page.score !== null && <ScoreRing value={page.score} size={88} stroke={8} label="page" color={scoreTone(page.score).color} />}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <Panel title={`Issues on this page (${issues.length})`} icon={<ListChecks className="size-4 text-muted-foreground" />} contentClassName="p-0">
            {issues.length === 0 ? (
              <EmptyState compact title="No issues" description="This page passed every check." />
            ) : (
              <ul className="divide-y">
                {issues.map((i) => (
                  <li key={i.id} className="flex gap-3 px-4 py-3 sm:px-5">
                    <SeverityIcon severity={i.severity} className="mt-0.5" />
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`${base}/issues/${i.issueType}`} className="text-sm font-medium hover:underline">
                          {i.descriptor?.title ?? i.issueType}
                        </Link>
                        <SeverityBadge severity={i.severity} />
                      </div>
                      {i.details && <p className="text-xs break-all text-muted-foreground">{formatDetails(i.details)}</p>}
                      {i.descriptor && <p className="text-xs">{i.descriptor.howToFix}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {isContent && (
            <Panel title="Search appearance" icon={<Tags className="size-4 text-muted-foreground" />}>
              <dl>
                <Row label="Title" hint={page.title ? `${page.title.length} characters (recommended 10–60)` : undefined}>
                  {page.title || <Missing />}
                </Row>
                <Row label="Meta description" hint={page.metaDescription ? `${page.metaDescription.length} characters (recommended 70–160)` : undefined}>
                  {page.metaDescription || <Missing />}
                </Row>
                <Row label="Canonical (HTML)">{page.canonicalUrl ? <span className="font-mono text-xs">{page.canonicalUrl}</span> : <span className="text-muted-foreground">none</span>}</Row>
                {page.headerCanonicalUrl && <Row label="Canonical (Link header)"><span className="font-mono text-xs">{page.headerCanonicalUrl}</span></Row>}
                <Row label="Robots">
                  {page.robotsMeta || page.xRobotsTag ? (
                    <span className="font-mono text-xs">
                      {page.robotsMeta && `meta: ${page.robotsMeta}`}
                      {page.robotsMeta && page.xRobotsTag && " · "}
                      {page.xRobotsTag && `X-Robots-Tag: ${page.xRobotsTag}`}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">index, follow (default)</span>
                  )}
                </Row>
                <Row label="Open Graph">
                  {page.ogTitle || page.ogDescription || page.ogImage ? (
                    <div className="space-y-0.5 text-xs">
                      {page.ogTitle && <div>{page.ogTitle}</div>}
                      {page.ogDescription && <div className="text-muted-foreground">{page.ogDescription}</div>}
                      {page.ogImage && <div className="font-mono break-all text-muted-foreground">{page.ogImage}</div>}
                    </div>
                  ) : (
                    <Missing />
                  )}
                </Row>
                <Row label="Language / hreflang">
                  {page.lang ?? "—"}
                  {page.hreflangTags.length > 0 && <span className="text-muted-foreground"> · {page.hreflangTags.join(", ")}</span>}
                </Row>
                <Row label="Structured data">{page.hasStructuredData ? page.structuredDataTypes.join(", ") || "JSON-LD present" : <span className="text-muted-foreground">none</span>}</Row>
              </dl>
            </Panel>
          )}

          {isContent && (
            <Panel title="Headings & content" icon={<Heading className="size-4 text-muted-foreground" />}>
              <div className="grid grid-cols-6 gap-1.5">
                {headingCounts.map((n, i) => (
                  <div key={i} className={cn("rounded-lg bg-muted/60 px-2 py-1.5 text-center", i === 0 && n !== 1 && "bg-warning/15")}>
                    <div className="text-[10px] text-muted-foreground">H{i + 1}</div>
                    <div className="text-sm font-semibold tabular">{n}</div>
                  </div>
                ))}
              </div>
              {page.h1s.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {page.h1s.map((h, i) => (
                    <li key={i} className="text-sm">
                      <span className="mr-1.5 rounded bg-muted px-1 text-[10px] font-semibold">H1</span>
                      {h}
                    </li>
                  ))}
                </ul>
              )}
              {page.headingOrder.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {page.headingOrder.slice(0, 80).map((l, i) => {
                    const skip = i > 0 && l > page.headingOrder[i - 1]! + 1;
                    return (
                      <span key={i} className={cn("rounded px-1 font-mono text-[10px]", skip ? "bg-info/15 text-info" : "bg-muted")} title={skip ? "Heading level skipped" : undefined}>
                        H{l}
                      </span>
                    );
                  })}
                </div>
              )}
              <dl className="mt-3">
                <Row label="Words">{page.wordCount.toLocaleString()}</Row>
                <Row label="Duplicate content">
                  {duplicates.length ? (
                    <span className="space-x-2">
                      {duplicates.map((d) => (
                        <Link key={d.id} href={`${base}/pages/${d.id}`} className="font-mono text-xs underline">
                          {pathOf(d.url, host)}
                        </Link>
                      ))}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">unique</span>
                  )}
                </Row>
              </dl>
            </Panel>
          )}

          {page.images.length > 0 && (
            <Panel title={`Images (${page.imagesTotal})`} description={page.imagesMissingAlt ? `${page.imagesMissingAlt} without alt attribute` : "All images have an alt attribute"} icon={<ImageIcon className="size-4 text-muted-foreground" />} contentClassName="p-0">
              <ul className="max-h-80 divide-y overflow-y-auto">
                {page.images.slice(0, 100).map((img, i) => (
                  <li key={i} className="flex items-center gap-3 px-4 py-2 sm:px-5">
                    <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium", img.alt === null ? "bg-warning/15 text-warning" : img.alt === "" ? "bg-muted text-muted-foreground" : "bg-success/12 text-success")}>
                      {img.alt === null ? "no alt" : img.alt === "" ? "decorative" : "alt"}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs" title={img.src ?? ""}>
                      {img.src ?? "—"}
                    </span>
                    {img.alt && <span className="hidden max-w-[40%] truncate text-xs text-muted-foreground sm:block">{img.alt}</span>}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel title={`Outgoing links (${links.length})`} description={`${internal.length} internal · ${external.length} external`} icon={<Link2 className="size-4 text-muted-foreground" />} contentClassName="p-0">
            {links.length === 0 ? (
              <EmptyState compact title="No links" description="This page has no outgoing links in its HTML." />
            ) : (
              <ul className="max-h-96 divide-y overflow-y-auto">
                {links.slice(0, 300).map((l) => (
                  <li key={l.u} className="flex items-center gap-3 px-4 py-2 sm:px-5">
                    <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px]", l.i ? "bg-muted" : "bg-info/12 text-info")}>{l.i ? "int" : "ext"}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs" title={l.u}>
                      {pathOf(l.u, host)}
                    </span>
                    {l.n && <span className="shrink-0 text-[10px] text-muted-foreground">nofollow</span>}
                    {l.a && <span className="hidden max-w-[35%] truncate text-xs text-muted-foreground sm:block">{l.a}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="min-w-0 space-y-4">
          <Panel title="Page facts" icon={<FileText className="size-4 text-muted-foreground" />}>
            <dl>
              <Row label="Status">
                <HttpStatusBadge status={page.statusCode} fetchClass={page.fetchClass} />
                {page.redirectUrl && <span className="ml-2 font-mono text-xs">→ {pathOf(page.redirectUrl, host)}</span>}
              </Row>
              <Row label="Response time">{formatMs(page.responseTimeMs)}</Row>
              <Row label="HTML size">{page.htmlBytes ? `${Math.round(page.htmlBytes / 1024).toLocaleString()} KB` : "—"}</Row>
              <Row label="Content type">{page.contentType ?? "—"}</Row>
              <Row label="Indexable">{page.isIndexable ? "Yes" : "No"}</Row>
              <Row label="Click depth">{page.crawlDepth ?? <span className="text-muted-foreground">sitemap only</span>}</Row>
              <Row label="Inlinks">{page.inlinkCount ?? "—"}</Row>
              <Row label="Crawled">{format(page.crawledAt, "MMM d, yyyy · HH:mm:ss")}</Row>
            </dl>
          </Panel>

          {lighthouse.length > 0 && (
            <Panel title="Lighthouse" contentClassName="space-y-2">
              {lighthouse.map((r) => (
                <Link key={r.id} href={`${base}/lighthouse/${r.id}`} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted/40">
                  {r.strategy === "mobile" ? <Smartphone className="size-4 text-muted-foreground" /> : <Monitor className="size-4 text-muted-foreground" />}
                  <span className="flex-1 capitalize">{r.strategy}</span>
                  <ScorePill score={r.performanceScore} />
                  <ScorePill score={r.seoScore} />
                </Link>
              ))}
            </Panel>
          )}

          <Panel title={`Linked from (${inbound.length}${inbound.length >= 200 ? "+" : ""})`} contentClassName="p-0">
            {inbound.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted-foreground sm:px-5">No other crawled page links here.</p>
            ) : (
              <ul className="max-h-96 divide-y overflow-y-auto">
                {inbound.map((p) => (
                  <li key={p.id} className="px-4 py-2 sm:px-5">
                    <Link href={`${base}/pages/${p.id}`} className="block truncate font-mono text-xs hover:underline">
                      {pathOf(p.url, host)}
                    </Link>
                    {p.anchor && <span className="block truncate text-[11px] text-muted-foreground">“{p.anchor}”</span>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </PageContainer>
  );
}
