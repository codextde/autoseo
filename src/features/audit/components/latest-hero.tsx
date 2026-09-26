import Link from "next/link";
import { ArrowRight, FileSearch } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { ScoreRing, Sparkline } from "@/components/app/charts";
import { Delta } from "@/components/app/metrics";
import { hostOf, scoreTone, SeverityDot } from "./bits";

export function LatestAuditHero({
  projectId,
  audit,
  trend,
}: {
  projectId: string;
  audit: {
    id: string;
    startUrl: string;
    score: number | null;
    pagesCrawled: number;
    completedAt: string | null;
    startedAt: string;
    issueCounts: { critical: number; warning: number; info: number; total: number } | null;
  };
  trend: number[];
}) {
  const delta = trend.length >= 2 ? trend[trend.length - 1]! - trend[trend.length - 2]! : null;
  const c = audit.issueCounts ?? { critical: 0, warning: 0, info: 0, total: 0 };
  return (
    <section className="grid gap-4 rounded-2xl border bg-card p-4 shadow-soft sm:p-5 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center">
      <div className="flex items-center gap-4">
        <ScoreRing value={audit.score ?? 0} size={104} stroke={9} label="health" color={scoreTone(audit.score).color} />
        <div className="min-w-0 md:hidden">
          <p className="truncate text-sm font-semibold">{hostOf(audit.startUrl)}</p>
          <p className="text-xs text-muted-foreground">{format(new Date(audit.completedAt ?? audit.startedAt), "MMM d, yyyy")}</p>
        </div>
      </div>
      <div className="min-w-0 space-y-3">
        <div className="hidden md:block">
          <p className="flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            <FileSearch className="size-3.5" /> Latest audit
          </p>
          <p className="mt-0.5 flex items-baseline gap-2 truncate text-lg font-semibold tracking-tight">
            {hostOf(audit.startUrl)}
            {delta !== null && <Delta value={delta} suffix=" pts" digits={0} />}
          </p>
          <p className="text-xs text-muted-foreground tabular">
            {format(new Date(audit.completedAt ?? audit.startedAt), "MMM d, yyyy · HH:mm")} · {audit.pagesCrawled.toLocaleString()} pages crawled
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(["critical", "warning", "info"] as const).map((s) => (
            <div key={s} className="rounded-xl bg-muted/50 px-3 py-2">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <SeverityDot severity={s} /> {s === "critical" ? "Errors" : s === "warning" ? "Warnings" : "Notices"}
              </div>
              <div className="mt-0.5 text-lg font-semibold tracking-tight tabular">{c[s].toLocaleString()}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-3 md:w-48">
        {trend.length >= 2 && (
          <div>
            <p className="mb-1 text-[11px] text-muted-foreground">Health over the last {trend.length} audits</p>
            <Sparkline values={trend} color="var(--brand)" />
          </div>
        )}
        <Button asChild className="gap-1.5">
          <Link href={`/p/${projectId}/seo/audit/${audit.id}`}>
            Open report <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>
    </section>
  );
}
