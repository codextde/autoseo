"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, ChevronRight, ExternalLink, PartyPopper, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExportMenu, fetchCsvTable } from "@/components/app/export-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FilterBar, SearchInput } from "@/components/app/filters";
import { EmptyState } from "@/components/app/empty-state";
import { useUrlState } from "@/hooks/use-url-state";
import { cn } from "@/lib/utils";
import { getIssueDescriptor, ISSUE_CATEGORIES, type IssueCategory } from "../registry";
import { formatDetails, pathOf, SEVERITY_META, SeverityDot, type Severity } from "./bits";

export type IssueSummaryRow = { issueType: string; title: string; severity: Severity; category: IssueCategory; count: number; pages: number };
export type IssueSample = { id: string; pageId: string | null; pageUrl: string; details: Record<string, unknown> | null };

const SECTIONS: Array<{ key: Severity; label: string }> = [
  { key: "critical", label: "Errors" },
  { key: "warning", label: "Warnings" },
  { key: "info", label: "Notices" },
];

export function IssuesView({
  base,
  summary,
  samples,
  predominantHost,
}: {
  base: string;
  summary: IssueSummaryRow[];
  samples: Record<string, IssueSample[]>;
  predominantHost: string | null;
}) {
  const [severity, setSeverity] = useUrlState("severity", "all");
  const [category, setCategory] = useUrlState("category", "all");
  const [q, setQ] = useUrlState("q", "");
  const [open, setOpen] = useState<Set<string>>(() => new Set(summary.length === 1 ? [summary[0]!.issueType] : []));

  const filtered = useMemo(
    () =>
      summary.filter(
        (s) =>
          (severity === "all" || s.severity === severity) &&
          (category === "all" || s.category === category) &&
          (!q || s.title.toLowerCase().includes(q.toLowerCase()) || s.issueType.includes(q.toLowerCase())),
      ),
    [summary, severity, category, q],
  );
  const activeCount = (severity !== "all" ? 1 : 0) + (category !== "all" ? 1 : 0);

  if (!summary.length) {
    return <EmptyState icon={PartyPopper} title="No issues recorded for this audit" description="Every crawled page passed all 29 checks. Nice work!" />;
  }

  const toggle = (t: string) =>
    setOpen((prev) => {
      const n = new Set(prev);
      if (n.has(t)) n.delete(t);
      else n.add(t);
      return n;
    });

  return (
    <div className="space-y-4">
      <FilterBar
        activeCount={activeCount}
        search={<SearchInput value={q} onChange={(v) => setQ(v || null)} placeholder="Search issues…" />}
        right={
          <ExportMenu
            label="Export all"
            filename="audit-issues"
            title={`Site audit issues — ${new Date().toISOString().slice(0, 10)}`}
            csvHref={`${base}/export?kind=issues&format=csv`}
            getData={() => fetchCsvTable(`${base}/export?kind=issues&format=csv`)}
          />
        }
      >
        <div className="flex gap-1 rounded-lg bg-muted p-0.5">
          {(["all", "critical", "warning", "info"] as const).map((k) => {
            const n = k === "all" ? summary.length : summary.filter((s) => s.severity === k).length;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setSeverity(k === "all" ? null : k)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors",
                  severity === k ? "bg-background font-medium shadow-xs" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {k !== "all" && <SeverityDot severity={k} />}
                {k === "all" ? "All" : k === "critical" ? "Errors" : k === "warning" ? "Warnings" : "Notices"}
                <span className="tabular opacity-60">{n}</span>
              </button>
            );
          })}
        </div>
        <Select value={category} onValueChange={(v) => setCategory(v === "all" ? null : v)}>
          <SelectTrigger size="sm" className="h-8 min-w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {(Object.keys(ISSUE_CATEGORIES) as IssueCategory[]).map((c) => (
              <SelectItem key={c} value={c}>
                {ISSUE_CATEGORIES[c].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterBar>

      {filtered.length === 0 && <EmptyState compact title="No issues match these filters" description="Try another severity or category." />}

      {SECTIONS.map((section) => {
        const rows = filtered.filter((r) => r.severity === section.key).sort((a, b) => b.count - a.count);
        if (!rows.length) return null;
        const total = rows.reduce((a, r) => a + r.count, 0);
        return (
          <section key={section.key} className="overflow-hidden rounded-2xl border bg-card shadow-soft">
            <header className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2.5 text-sm font-semibold sm:px-5">
              <SeverityDot severity={section.key} className="size-2.5" />
              {section.label}
              <span className="text-xs font-normal text-muted-foreground tabular">
                {rows.length} type{rows.length === 1 ? "" : "s"} · {total.toLocaleString()} issue{total === 1 ? "" : "s"}
              </span>
            </header>
            <ul className="divide-y">
              {rows.map((row) => {
                const d = getIssueDescriptor(row.issueType);
                const isOpen = open.has(row.issueType);
                const list = samples[row.issueType] ?? [];
                return (
                  <li key={row.issueType}>
                    <button
                      type="button"
                      onClick={() => toggle(row.issueType)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 sm:px-5"
                      aria-expanded={isOpen}
                    >
                      <SeverityDot severity={row.severity} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{row.title}</span>
                        <span className="text-xs text-muted-foreground">{ISSUE_CATEGORIES[row.category]?.label}</span>
                      </span>
                      <span className="shrink-0 text-sm tabular">
                        <strong>{row.pages.toLocaleString()}</strong> <span className="text-xs text-muted-foreground">page{row.pages === 1 ? "" : "s"}</span>
                      </span>
                      <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
                    </button>
                    <AnimatePresence initial={false}>
                      {isOpen && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                          <div className="space-y-3 border-t bg-muted/20 px-4 py-4 sm:px-5">
                            {d && <p className="text-sm text-muted-foreground">{d.explanation}</p>}
                            {d && (
                              <div className={cn("flex gap-2 rounded-xl px-3 py-2.5 text-sm", SEVERITY_META[row.severity].soft)}>
                                <Wrench className="mt-0.5 size-4 shrink-0" />
                                <p>
                                  <span className="font-medium">How to fix: </span>
                                  {d.howToFix}
                                </p>
                              </div>
                            )}
                            <ul className="max-h-80 divide-y overflow-y-auto rounded-xl border bg-card">
                              {list.map((s) => (
                                <li key={s.id} className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:items-center sm:gap-3">
                                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                                    {s.pageId ? (
                                      <Link href={`${base}/pages/${s.pageId}`} className="truncate font-mono text-xs hover:underline" title={s.pageUrl}>
                                        {pathOf(s.pageUrl, predominantHost)}
                                      </Link>
                                    ) : (
                                      <span className="truncate font-mono text-xs">{pathOf(s.pageUrl, predominantHost)}</span>
                                    )}
                                    <a href={s.pageUrl} target="_blank" rel="noopener noreferrer nofollow" className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="Open URL">
                                      <ExternalLink className="size-3" />
                                    </a>
                                  </div>
                                  {s.details && <span className="truncate text-[11px] text-muted-foreground sm:max-w-[50%]">{formatDetails(s.details)}</span>}
                                </li>
                              ))}
                            </ul>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-xs text-muted-foreground">
                                {row.count > list.length ? `Showing ${list.length} of ${row.count.toLocaleString()}` : `${row.count.toLocaleString()} affected`}
                              </span>
                              <div className="flex gap-2">
                                <ExportMenu
                                  className="h-7 gap-1"
                                  filename={`audit-issues-${row.issueType}`}
                                  title={`Site audit — ${row.title} — ${new Date().toISOString().slice(0, 10)}`}
                                  csvHref={`${base}/export?kind=issues&format=csv&issueType=${row.issueType}`}
                                  getData={() => fetchCsvTable(`${base}/export?kind=issues&format=csv&issueType=${row.issueType}`)}
                                />
                                <Button asChild variant="outline" size="sm" className="h-7 gap-1">
                                  <Link href={`${base}/issues/${row.issueType}`}>
                                    All affected URLs <ArrowRight className="size-3.5" />
                                  </Link>
                                </Button>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
