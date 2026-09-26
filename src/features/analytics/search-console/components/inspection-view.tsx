"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  FileSearch,
  Info,
  Loader2,
  RotateCw,
  ScanSearch,
  Smartphone,
  Sparkles,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DataTable, type Column } from "@/components/app/data-table";
import { Meter, formatNumber } from "@/components/app/metrics";
import { Panel } from "@/components/app/page";
import { TimeAgo } from "@/components/app/misc";
import { EmptyState } from "@/components/app/empty-state";
import { cn } from "@/lib/utils";
import type { InspectionVerdict, UrlInspectionResult } from "@/server/integrations/google/inspection";
import type { InspectionHistoryItem, InspectionQuota, InspectUrlResult } from "@/server/analytics/search-console/inspection";
import { inspectUrlAction } from "../actions";

/* ───────────────────────────── Labels ───────────────────────────── */

const VERDICT: Record<InspectionVerdict, { label: string; tone: string; icon: typeof CheckCircle2 }> = {
  PASS: { label: "URL is on Google", tone: "bg-success/12 text-success ring-success/25", icon: CheckCircle2 },
  PARTIAL: { label: "On Google, with issues", tone: "bg-warning/15 text-warning ring-warning/30", icon: AlertTriangle },
  FAIL: { label: "URL is not on Google", tone: "bg-destructive/10 text-destructive ring-destructive/25", icon: XCircle },
  NEUTRAL: { label: "Excluded", tone: "bg-muted text-muted-foreground ring-border", icon: CircleDashed },
  VERDICT_UNSPECIFIED: { label: "Unknown", tone: "bg-muted text-muted-foreground ring-border", icon: CircleDashed },
};

const ENUM_LABEL: Record<string, string> = {
  INDEXING_ALLOWED: "Indexing allowed",
  BLOCKED_BY_META_TAG: "Blocked by noindex meta tag",
  BLOCKED_BY_HTTP_HEADER: "Blocked by X-Robots-Tag header",
  BLOCKED_BY_ROBOTS_TXT: "Blocked by robots.txt",
  ALLOWED: "Allowed",
  DISALLOWED: "Disallowed",
  SUCCESSFUL: "Successful",
  SOFT_404: "Soft 404",
  BLOCKED_ROBOTS_TXT: "Blocked by robots.txt",
  NOT_FOUND: "Not found (404)",
  ACCESS_DENIED: "Access denied (401)",
  SERVER_ERROR: "Server error (5xx)",
  REDIRECT_ERROR: "Redirect error",
  ACCESS_FORBIDDEN: "Access forbidden (403)",
  BLOCKED_4XX: "Blocked (4xx)",
  INTERNAL_CRAWL_ERROR: "Internal crawl error",
  INVALID_URL: "Invalid URL",
  MOBILE: "Googlebot smartphone",
  DESKTOP: "Googlebot desktop",
};

function human(v: string | null | undefined): string {
  if (!v) return "—";
  if (ENUM_LABEL[v]) return ENUM_LABEL[v];
  if (/^[A-Z0-9_]+$/.test(v)) {
    const s = v.toLowerCase().replace(/_/g, " ").replace(/ state unspecified$| unspecified$/, " — not reported");
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  return v;
}

export function VerdictBadge({ verdict, className }: { verdict: string | null; className?: string }) {
  const v = VERDICT[(verdict as InspectionVerdict) ?? "VERDICT_UNSPECIFIED"] ?? VERDICT.VERDICT_UNSPECIFIED;
  const Icon = v.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset", v.tone, className)}>
      <Icon className="size-3" />
      {v.label}
    </span>
  );
}

function pathOf(url: string) {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}` || "/";
  } catch {
    return url;
  }
}

/* ───────────────────────────── Result card ───────────────────────────── */

function Fact({ label, value, bad }: { label: string; value: React.ReactNode; bad?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/50 px-3 py-2">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className={cn("truncate text-sm font-medium", bad && "text-destructive")}>{value}</dd>
    </div>
  );
}

function UrlList({ title, urls }: { title: string; urls: string[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? urls : urls.slice(0, 5);
  return (
    <div className="min-w-0 space-y-1.5">
      <h4 className="text-xs font-medium text-muted-foreground">
        {title} <span className="tabular">({urls.length})</span>
      </h4>
      {urls.length ? (
        <ul className="space-y-1 text-sm">
          {shown.map((u) => (
            <li key={u} className="truncate">
              <a href={u} target="_blank" rel="noreferrer noopener" className="hover:underline">
                {u}
              </a>
            </li>
          ))}
          {urls.length > 5 && (
            <li>
              <button type="button" className="text-xs text-muted-foreground underline underline-offset-2" onClick={() => setAll((v) => !v)}>
                {all ? "Show less" : `Show all ${urls.length}`}
              </button>
            </li>
          )}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">None detected</p>
      )}
    </div>
  );
}

function ResultCard({
  url,
  result,
  inspectedAt,
  cached,
  canLive,
  pending,
  onReinspect,
}: {
  url: string;
  result: UrlInspectionResult;
  inspectedAt: string;
  cached: boolean;
  canLive: boolean;
  pending: boolean;
  onReinspect: () => void;
}) {
  const indexingBad = !!result.indexingState && result.indexingState !== "INDEXING_ALLOWED" && !/UNSPECIFIED/.test(result.indexingState);
  const fetchBad = !!result.pageFetchState && result.pageFetchState !== "SUCCESSFUL" && !/UNSPECIFIED/.test(result.pageFetchState);
  const robotsBad = result.robotsTxtState === "DISALLOWED";
  const richIssues = result.richResults?.detectedItems.reduce((n, d) => n + d.items.reduce((m, i) => m + i.issues.length, 0), 0) ?? 0;

  return (
    <section className="space-y-4 rounded-2xl border bg-card p-4 shadow-soft sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <VerdictBadge verdict={result.verdict} />
            {result.coverageState && <span className="text-sm font-medium">{result.coverageState}</span>}
          </div>
          <a href={url} target="_blank" rel="noreferrer noopener" className="block truncate text-sm text-muted-foreground hover:underline" title={url}>
            {url}
          </a>
          <p className="text-xs text-muted-foreground">
            Inspected <TimeAgo date={inspectedAt} />
            {cached && " · from the last 24 h (no quota used)"}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {canLive && (
            <Button variant="outline" size="sm" onClick={onReinspect} disabled={pending}>
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />}
              Re-inspect
            </Button>
          )}
          {result.inspectionResultLink && (
            <Button asChild size="sm" variant="outline">
              <a href={result.inspectionResultLink} target="_blank" rel="noreferrer noopener">
                <ExternalLink className="size-3.5" /> Open in Search Console
              </a>
            </Button>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <Fact label="Indexing" value={human(result.indexingState)} bad={indexingBad} />
        <Fact label="robots.txt" value={human(result.robotsTxtState)} bad={robotsBad} />
        <Fact label="Page fetch" value={human(result.pageFetchState)} bad={fetchBad} />
        <Fact label="Last crawl" value={result.lastCrawlTime ? <TimeAgo date={result.lastCrawlTime} /> : "Never crawled"} />
        <Fact label="Crawled as" value={human(result.crawledAs)} />
      </dl>

      <div className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground">Canonical</h4>
        <div className="grid gap-2 sm:grid-cols-2">
          <Fact label="User-declared canonical" value={result.userCanonical ?? "None declared"} />
          <Fact label="Google-selected canonical" value={result.googleCanonical ?? "Not determined yet"} bad={result.canonicalMismatch} />
        </div>
        {result.canonicalMismatch && (
          <Alert className="border-warning/40 bg-warning/5">
            <AlertTriangle className="text-warning" />
            <AlertTitle>Google chose a different canonical</AlertTitle>
            <AlertDescription>
              Google indexes {result.googleCanonical} instead of the declared canonical. Consolidate duplicates (redirects, internal links, sitemap entries) so both point to the same URL.
            </AlertDescription>
          </Alert>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <UrlList title="Sitemaps" urls={result.sitemaps} />
        <UrlList title="Referring pages" urls={result.referringUrls} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <h4 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Smartphone className="size-3.5" /> Mobile usability
          </h4>
          {result.mobileUsability ? (
            <>
              <VerdictBadge verdict={result.mobileUsability.verdict} />
              {result.mobileUsability.issues.length ? (
                <ul className="space-y-1 text-sm">
                  {result.mobileUsability.issues.map((i, n) => (
                    <li key={n} className="flex items-start gap-1.5">
                      <AlertTriangle className={cn("mt-0.5 size-3.5 shrink-0", i.severity === "ERROR" ? "text-destructive" : "text-warning")} />
                      <span>{i.message || human(i.issueType)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No mobile usability issues.</p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Not reported for this URL.</p>
          )}
        </div>
        <div className="space-y-2">
          <h4 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Sparkles className="size-3.5" /> Rich results {richIssues > 0 && <span className="text-warning">· {richIssues} issue{richIssues === 1 ? "" : "s"}</span>}
          </h4>
          {result.richResults?.detectedItems.length ? (
            <>
              <VerdictBadge verdict={result.richResults.verdict} />
              <ul className="space-y-2 text-sm">
                {result.richResults.detectedItems.map((d, n) => (
                  <li key={n}>
                    <p className="font-medium">
                      {d.richResultType} <span className="text-xs font-normal text-muted-foreground">({d.items.length} item{d.items.length === 1 ? "" : "s"})</span>
                    </p>
                    {d.items.flatMap((it) => it.issues.map((x) => ({ item: it.name, ...x }))).map((x, k) => (
                      <p key={k} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                        <AlertTriangle className={cn("mt-0.5 size-3 shrink-0", x.severity === "ERROR" ? "text-destructive" : "text-warning")} />
                        <span>
                          {x.item}: {x.issueMessage}
                        </span>
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No structured data detected.</p>
          )}
        </div>
      </div>

      {result.amp && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs font-medium text-muted-foreground">AMP</span>
          <VerdictBadge verdict={result.amp.verdict} />
          <span className="text-muted-foreground">{human(result.amp.indexingState)}</span>
        </div>
      )}
    </section>
  );
}

/* ───────────────────────────── View ───────────────────────────── */

type Shown = { url: string; result: UrlInspectionResult; inspectedAt: string; cached: boolean };

function fromInspection(i: InspectUrlResult): Shown {
  return { url: i.url, result: i.result, inspectedAt: i.inspectedAt, cached: i.cached };
}

export function InspectionView({
  projectId,
  property,
  initialUrl,
  initial,
  history,
  quota,
  canLive,
  disabledReason,
}: {
  projectId: string;
  property: string;
  initialUrl: string;
  initial: InspectUrlResult | null;
  history: InspectionHistoryItem[];
  quota: InspectionQuota | null;
  canLive: boolean;
  /** Set when inspection is impossible (e.g. demo data). */
  disabledReason: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [url, setUrl] = useState(initialUrl);
  const [shown, setShown] = useState<Shown | null>(initial ? fromInspection(initial) : null);
  const [error, setError] = useState<string | null>(null);
  const [liveQuota, setLiveQuota] = useState<InspectionQuota | null>(quota);
  const [pending, start] = useTransition();
  const autoRan = useRef(false);

  const run = (target: string, force = false) =>
    start(async () => {
      setError(null);
      const res = await inspectUrlAction(projectId, target, force);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (res.data.status === "error") {
        setError(res.data.message);
        return;
      }
      const inspection = res.data.inspection;
      setShown(fromInspection(inspection));
      setLiveQuota(inspection.quota);
      if (params.get("url") !== inspection.url) {
        const next = new URLSearchParams(params.toString());
        next.set("tab", "inspect");
        next.set("url", inspection.url);
        router.replace(`${pathname}?${next.toString()}`, { scroll: false });
      }
      if (!inspection.cached) router.refresh();
    });

  // Deep link (?url=… from the Top Pages table) without a cached result: inspect once automatically.
  useEffect(() => {
    if (autoRan.current || initial || !initialUrl || disabledReason) return;
    autoRan.current = true;
    run(initialUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const historyColumns: Column<InspectionHistoryItem>[] = [
    {
      id: "url",
      header: "URL",
      cell: (r) => (
        <span className="block max-w-[26rem] truncate font-medium" title={r.url}>
          {pathOf(r.url)}
        </span>
      ),
    },
    {
      id: "verdict",
      header: "Verdict",
      cell: (r) => (r.error ? <span className="text-xs text-destructive">Failed</span> : <VerdictBadge verdict={r.verdict} />),
    },
    { id: "coverage", header: "Coverage", hideBelow: "md", cell: (r) => <span className="text-muted-foreground">{r.error ?? r.coverageState ?? "—"}</span> },
    { id: "at", header: "Inspected", align: "right", cell: (r) => <TimeAgo date={r.inspectedAt} className="text-muted-foreground" /> },
    { id: "by", header: "By", hideBelow: "lg", cell: (r) => <span className="text-muted-foreground">{r.inspectedBy?.name ?? r.inspectedBy?.email ?? "—"}</span> },
  ];

  return (
    <div className="space-y-4">
      <Panel
        title="URL Inspection"
        description={`Check how Google sees a page of ${property} — index status, canonical, crawl, mobile usability and rich results.`}
        icon={<ScanSearch className="size-4 text-muted-foreground" />}
        contentClassName="space-y-3 p-3 sm:p-4"
      >
        {disabledReason ? (
          <Alert>
            <Info />
            <AlertTitle>URL inspection unavailable</AlertTitle>
            <AlertDescription>{disabledReason}</AlertDescription>
          </Alert>
        ) : (
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (url.trim()) run(url.trim());
            }}
          >
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={property.startsWith("http") ? `${property.replace(/\/$/, "")}/page` : `https://${property.split(" ")[0]}/page`}
              inputMode="url"
              className="h-9 flex-1"
              aria-label="URL to inspect"
            />
            <Button type="submit" disabled={pending || !url.trim()} className="h-9">
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <ScanSearch className="size-3.5" />}
              Inspect
            </Button>
          </form>
        )}
        <div className="flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            {canLive
              ? "Results are cached for 24 hours — re-inspect to fetch a fresh result."
              : "You can view recent results. Running new inspections needs the “Run paid SEO research” permission."}
          </span>
          {liveQuota && (
            <span className="flex min-w-48 items-center gap-2">
              <Meter value={liveQuota.used} max={liveQuota.limit} className="w-24" tone={liveQuota.remaining < 100 ? "warning" : "brand"} />
              <span className="tabular">
                {formatNumber(liveQuota.used)} / {formatNumber(liveQuota.limit)} today
              </span>
            </span>
          )}
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>Inspection failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </Panel>

      {pending && !shown && (
        <div className="flex items-center justify-center gap-2 rounded-2xl border bg-card p-10 text-sm text-muted-foreground shadow-soft">
          <Loader2 className="size-4 animate-spin" /> Asking Google about this URL…
        </div>
      )}
      {shown && (
        <ResultCard
          url={shown.url}
          result={shown.result}
          inspectedAt={shown.inspectedAt}
          cached={shown.cached}
          canLive={canLive && !disabledReason}
          pending={pending}
          onReinspect={() => run(shown.url, true)}
        />
      )}

      <Panel title="Recent inspections" description="Latest URL Inspection results for this project" contentClassName="p-3 sm:p-4">
        <DataTable
          columns={historyColumns}
          data={history}
          getRowId={(r) => r.id}
          pageSize={10}
          dense
          onRowClick={(r) => {
            if (!r.result) return;
            setShown({ url: r.url, result: r.result, inspectedAt: r.inspectedAt, cached: true });
            setUrl(r.url);
            setError(null);
          }}
          empty={
            <EmptyState icon={FileSearch} compact title="No inspections yet" description="Inspect a URL above or use “Inspect” on a row of the Top Pages tab." />
          }
          mobileCard={(r) => (
            <div className="space-y-1">
              <span className="block truncate text-sm font-medium">{pathOf(r.url)}</span>
              <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                {r.error ? <span className="text-destructive">Failed</span> : <VerdictBadge verdict={r.verdict} />}
                <TimeAgo date={r.inspectedAt} />
              </span>
            </div>
          )}
        />
      </Panel>
    </div>
  );
}
