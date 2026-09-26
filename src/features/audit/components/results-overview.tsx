import Link from "next/link";
import { Ban, Clock3, FileText, Gauge, Hourglass, Link2Off, ShieldAlert } from "lucide-react";
import { ScoreRing } from "@/components/app/charts";
import { KpiStrip, type KpiItem } from "@/components/app/metrics";
import { cn } from "@/lib/utils";
import { formatMs, scoreTone, SeverityDot } from "./bits";

type Category = { key: string; label: string; description: string; issues: number; critical: number; warning: number; info: number; types: number };

export function ResultsOverview({
  base,
  score,
  counts,
  pages,
  lighthouse,
  categories,
}: {
  base: string;
  score: number | null;
  counts: { critical: number; warning: number; info: number; total: number };
  pages: { total: number; ok: number; redirects: number; broken: number; blocked: number; rateLimited: number; indexable: number; avgResponseMs: number | null; avgWords: number | null };
  lighthouse: { tests: number; failures: number; avgPerformance: number | null; avgAccessibility: number | null; avgSeo: number | null; avgBestPractices: number | null };
  categories: Category[];
}) {
  const kpis: KpiItem[] = [
    { key: "pages", label: "Pages crawled", value: pages.total.toLocaleString(), sub: `${pages.ok.toLocaleString()} OK · ${pages.redirects} redirects` },
    { key: "indexable", label: "Indexable", value: pages.indexable.toLocaleString(), sub: pages.ok ? `${Math.round((pages.indexable / Math.max(1, pages.ok)) * 100)}% of 2xx pages` : undefined },
    { key: "broken", label: "Errors (4xx/5xx)", value: <span className={pages.broken ? "text-destructive" : undefined}>{pages.broken}</span> },
    { key: "resp", label: "Avg response", value: formatMs(pages.avgResponseMs) },
    { key: "words", label: "Avg words", value: pages.avgWords?.toLocaleString() ?? "—" },
  ];
  if (lighthouse.tests > 0) {
    kpis.push(
      { key: "lhp", label: "Lighthouse perf", value: <span className={scoreTone(lighthouse.avgPerformance).text}>{lighthouse.avgPerformance ?? "—"}</span>, sub: `${lighthouse.tests} tests${lighthouse.failures ? ` · ${lighthouse.failures} failed` : ""}` },
      { key: "lhs", label: "Lighthouse SEO", value: <span className={scoreTone(lighthouse.avgSeo).text}>{lighthouse.avgSeo ?? "—"}</span> },
      { key: "lha", label: "Accessibility", value: <span className={scoreTone(lighthouse.avgAccessibility).text}>{lighthouse.avgAccessibility ?? "—"}</span> },
    );
  }
  const totalSev = Math.max(1, counts.critical + counts.warning + counts.info);
  const icons: Record<string, React.ReactNode> = {
    "crawl-access": <ShieldAlert className="size-4" />,
    "http-status": <Ban className="size-4" />,
    links: <Link2Off className="size-4" />,
    performance: <Clock3 className="size-4" />,
    content: <FileText className="size-4" />,
    indexability: <Hourglass className="size-4" />,
  };
  return (
    <div className="space-y-4">
      <section className="grid gap-4 rounded-2xl border bg-card p-4 shadow-soft sm:p-5 lg:grid-cols-[auto_minmax(0,1fr)]">
        <div className="flex items-center gap-5">
          {score == null ? (
            <div className="flex size-32 shrink-0 flex-col items-center justify-center rounded-full border-[10px] border-muted text-center">
              <span className="text-2xl font-semibold text-muted-foreground">—</span>
              <span className="text-[10px] text-muted-foreground uppercase">no score</span>
            </div>
          ) : (
            <ScoreRing value={score} size={128} stroke={10} label="site health" color={scoreTone(score).color} />
          )}
          <div className="space-y-2.5 lg:hidden">
            <SeverityLegend counts={counts} />
          </div>
        </div>
        <div className="min-w-0 space-y-4">
          <div className="hidden items-end justify-between gap-4 lg:flex">
            <div>
              <p className="text-sm font-semibold">{counts.total.toLocaleString()} issues found</p>
              <p className="text-xs text-muted-foreground">Every page starts at 100: −30 per error type, −10 per warning type, −2 per notice; the site score is the average.</p>
            </div>
            <SeverityLegend counts={counts} inline />
          </div>
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="bg-destructive" style={{ width: `${(counts.critical / totalSev) * 100}%` }} />
            <div className="bg-warning" style={{ width: `${(counts.warning / totalSev) * 100}%` }} />
            <div className="bg-info" style={{ width: `${(counts.info / totalSev) * 100}%` }} />
          </div>
          <KpiStrip items={kpis} />
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Gauge className="size-4 text-muted-foreground" /> Issue categories
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {categories.map((c) => (
            <Link
              key={c.key}
              href={`${base}?tab=issues&category=${c.key}`}
              scroll={false}
              className={cn(
                "group rounded-xl border bg-card p-3 transition-colors hover:border-foreground/20 hover:bg-muted/40",
                c.issues === 0 && "opacity-70",
              )}
            >
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="truncate">{c.label}</span>
                {icons[c.key]}
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-xl font-semibold tracking-tight tabular">{c.issues.toLocaleString()}</span>
                {c.issues === 0 && <span className="text-xs text-success">All good</span>}
              </div>
              <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground tabular">
                {c.critical > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <SeverityDot severity="critical" />
                    {c.critical}
                  </span>
                )}
                {c.warning > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <SeverityDot severity="warning" />
                    {c.warning}
                  </span>
                )}
                {c.info > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <SeverityDot severity="info" />
                    {c.info}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function SeverityLegend({ counts, inline }: { counts: { critical: number; warning: number; info: number }; inline?: boolean }) {
  const items = [
    { k: "critical" as const, label: "Errors", v: counts.critical },
    { k: "warning" as const, label: "Warnings", v: counts.warning },
    { k: "info" as const, label: "Notices", v: counts.info },
  ];
  return (
    <div className={cn("gap-4", inline ? "flex" : "grid")}>
      {items.map((i) => (
        <div key={i.k} className="flex items-center gap-2">
          <SeverityDot severity={i.k} />
          <span className="text-xs text-muted-foreground">{i.label}</span>
          <span className="text-sm font-semibold tabular">{i.v.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}
