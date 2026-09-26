import { AlertTriangle, Info, OctagonAlert, ShieldAlert, Timer } from "lucide-react";
import { cn } from "@/lib/utils";

function Banner({ tone, icon, title, children }: { tone: "error" | "warning" | "info"; icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex gap-3 rounded-2xl border px-4 py-3 text-sm",
        tone === "error" && "border-destructive/25 bg-destructive/5",
        tone === "warning" && "border-warning/30 bg-warning/8",
        tone === "info" && "border-info/25 bg-info/5",
      )}
    >
      <span className={cn("mt-0.5 shrink-0", tone === "error" ? "text-destructive" : tone === "warning" ? "text-warning" : "text-info")}>{icon}</span>
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium">{title}</p>
        {children && <div className="text-muted-foreground">{children}</div>}
      </div>
    </div>
  );
}

export function AuditBanners({
  status,
  pagesCrawled,
  maxPages,
  errorCode,
  errorDetail,
  blocked,
  rateLimitedPages,
  rateLimited,
  crawlCompleted,
  stopRequested,
}: {
  status: string;
  pagesCrawled: number;
  maxPages: number;
  errorCode: string | null;
  errorDetail: string | null;
  blocked: number;
  rateLimitedPages: number;
  rateLimited: boolean;
  crawlCompleted: boolean;
  stopRequested: boolean;
}) {
  const out: React.ReactNode[] = [];
  const allowlist = (
    <>
      Allowlist the <code className="rounded bg-muted px-1 font-mono text-xs">AutoSEO-Audit</code> user agent in your WAF / bot protection and re-run the audit. Desktop crawlers such as{" "}
      <a className="underline" href="https://github.com/PhialsBasement/LibreCrawl" target="_blank" rel="noopener noreferrer">
        LibreCrawl
      </a>{" "}
      or{" "}
      <a className="underline" href="https://www.screamingfrog.co.uk/seo-spider/" target="_blank" rel="noopener noreferrer">
        Screaming Frog
      </a>{" "}
      are an alternative when protection can&apos;t be relaxed.
    </>
  );
  if (status === "failed" && pagesCrawled === 0) {
    out.push(
      <Banner key="f0" tone="error" icon={<OctagonAlert className="size-4" />} title="Site audit couldn't crawl this website">
        {errorDetail ?? "The crawl failed before any page was fetched."} {errorCode === "instance_lost" ? "The worker stopped responding." : ""} {allowlist}
      </Banner>,
    );
  } else if (status === "failed") {
    out.push(
      <Banner key="f" tone="error" icon={<OctagonAlert className="size-4" />} title={`This audit stopped early after ${pagesCrawled.toLocaleString()} pages`}>
        The results below cover everything crawled before it stopped{errorDetail ? ` (${errorDetail})` : ""}. Run a new audit to try again.
      </Banner>,
    );
  } else if (status === "cancelled") {
    out.push(<Banner key="c" tone="info" icon={<Info className="size-4" />} title="This audit was cancelled before crawling started." />);
  } else if (status === "completed" && pagesCrawled <= 1) {
    out.push(
      <Banner key="one" tone="warning" icon={<AlertTriangle className="size-4" />} title="Site audit couldn't fully crawl this website">
        Only {pagesCrawled} page could be crawled. Bot protection, a robots.txt block or JavaScript-only navigation may have stopped the crawler. {allowlist}
      </Banner>,
    );
  }
  if (blocked > 0 && pagesCrawled > 1) {
    out.push(
      <Banner key="b" tone="warning" icon={<ShieldAlert className="size-4" />} title={`We were blocked on ${blocked.toLocaleString()} page${blocked === 1 ? "" : "s"}`}>
        {allowlist}
      </Banner>,
    );
  }
  if (rateLimited || rateLimitedPages > 0) {
    out.push(
      <Banner key="r" tone="warning" icon={<Timer className="size-4" />} title={rateLimited ? "The crawl stopped early because of the site's rate limit" : `The site rate limited us on ${rateLimitedPages} page${rateLimitedPages === 1 ? "" : "s"}`}>
        Allowlist the <code className="rounded bg-muted px-1 font-mono text-xs">AutoSEO-Audit</code> user agent in your rate-limiting rules or re-run with fewer pages.
      </Banner>,
    );
  }
  if (status === "completed" && stopRequested) {
    out.push(<Banner key="s" tone="info" icon={<Info className="size-4" />} title={`You stopped this audit after ${pagesCrawled.toLocaleString()} pages`}>Cross-page checks ran on the pages crawled so far; orphan detection was skipped.</Banner>);
  } else if (status === "completed" && !crawlCompleted && pagesCrawled >= maxPages) {
    out.push(
      <Banner key="l" tone="info" icon={<Info className="size-4" />} title={`Crawl limit reached (${maxPages.toLocaleString()} pages)`}>
        More pages were discovered than the limit allows. Orphan-page detection needs a complete crawl — raise the limit to cover the whole site.
      </Banner>,
    );
  }
  if (!out.length) return null;
  return <div className="space-y-2">{out}</div>;
}
