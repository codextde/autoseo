"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronDown, Copy, Download, FileJson, Sheet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/app/empty-state";
import { useGoogleSheetsExport } from "@/components/app/export-menu";
import { useUrlState } from "@/hooks/use-url-state";
import { cn } from "@/lib/utils";
import { SeverityIcon, SEVERITY_META, type Severity } from "./bits";

export type LhIssue = {
  category: "performance" | "accessibility" | "best-practices" | "seo";
  auditKey: string;
  title: string;
  description: string;
  score: number | null;
  displayValue: string | null;
  impactMs: number | null;
  impactBytes: number | null;
  severity: Severity;
  items: string[];
};

const CATS = [
  { key: "all", label: "All" },
  { key: "performance", label: "Performance" },
  { key: "accessibility", label: "Accessibility" },
  { key: "best-practices", label: "Best practices" },
  { key: "seo", label: "SEO" },
] as const;

/** Renders Lighthouse's inline markdown (links + `code`) without injecting HTML. */
export function InlineMarkdown({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const re = /\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(<Fragment key={i++}>{text.slice(last, m.index)}</Fragment>);
    if (m[1] && m[2]) {
      const safe = /^https?:\/\//i.test(m[2]);
      parts.push(
        safe ? (
          <a key={i++} href={m[2]} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2">
            {m[1]}
          </a>
        ) : (
          <Fragment key={i++}>{m[1]}</Fragment>
        ),
      );
    } else if (m[3]) {
      parts.push(
        <code key={i++} className="rounded bg-muted px-1 font-mono text-[0.85em]">
          {m[3]}
        </code>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<Fragment key={i++}>{text.slice(last)}</Fragment>);
  return <>{parts}</>;
}

function impact(i: LhIssue) {
  const parts: string[] = [];
  if (i.impactMs) parts.push(`${Math.round(i.impactMs).toLocaleString()} ms`);
  if (i.impactBytes) parts.push(`${Math.round(i.impactBytes / 1024).toLocaleString()} KB`);
  return parts.join(" / ") || "—";
}

const LH_HEADERS = ["Category", "Severity", "Score", "Title", "Display Value", "Description", "Impact (ms)", "Impact (bytes)", "Affected Items"];

function sheetRows(issues: LhIssue[]) {
  return issues.map((i) => [i.category, i.severity, i.score, i.title, i.displayValue, i.description, i.impactMs, i.impactBytes, i.items.join("\n")]);
}

function csv(issues: LhIssue[]) {
  const esc = (v: unknown) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ["Category", "Severity", "Score", "Title", "Display Value", "Description", "Impact (ms)", "Impact (bytes)", "Affected Items"];
  return [head.join(","), ...issues.map((i) => [i.category, i.severity, i.score, i.title, i.displayValue, i.description, i.impactMs, i.impactBytes, i.items.join("\n")].map(esc).join(","))].join("\r\n");
}

function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function LighthouseIssues({ issues, exportBase, filePrefix, hasIssueDetails }: { issues: LhIssue[]; exportBase: string; filePrefix: string; hasIssueDetails: boolean }) {
  const [category, setCategory] = useUrlState("category", "all");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const visible = useMemo(() => (category === "all" ? issues : issues.filter((i) => i.category === category)), [issues, category]);
  const counts = useMemo(() => Object.fromEntries(CATS.map((c) => [c.key, c.key === "all" ? issues.length : issues.filter((i) => i.category === c.key).length])), [issues]);
  const actionable = issues;

  const sheets = useGoogleSheetsExport();
  const toSheets = (list: LhIssue[], scope: string) =>
    void sheets.exportToSheets(`${filePrefix} — Lighthouse ${scope} — ${new Date().toISOString().slice(0, 10)}`, () => ({
      headers: LH_HEADERS,
      rows: sheetRows(list),
    }));

  const copy = async (text: string, what: string) => {
    await navigator.clipboard.writeText(text);
    toast.success(`Copied ${what}`);
  };

  if (!hasIssueDetails) {
    return <EmptyState title="No issue details stored" description="This Lighthouse run was stored before issue details were preserved. Re-run the audit to capture them." />;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="scrollbar-none -mx-1 flex max-w-full gap-1 overflow-x-auto px-1">
          {CATS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setCategory(c.key === "all" ? null : c.key)}
              className={cn(
                "shrink-0 rounded-lg px-3 py-1.5 text-xs whitespace-nowrap transition-colors",
                category === c.key ? "bg-foreground font-medium text-background" : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {c.label} <span className="tabular opacity-70">{counts[c.key]}</span>
            </button>
          ))}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Download className="size-3.5" /> Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="text-xs">Copy</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => copy(JSON.stringify(visible, null, 2), "current category issues")}>
              <Copy className="size-4" /> Current category issues
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => copy(JSON.stringify(actionable, null, 2), "all actionable issues")}>
              <Copy className="size-4" /> All actionable issues
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs">Download</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => download(`${filePrefix}-${category}-issues.csv`, csv(visible), "text/csv")}>
              <Download className="size-4" /> CSV — current category
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => download(`${filePrefix}-issues.csv`, csv(actionable), "text/csv")}>
              <Download className="size-4" /> CSV — all issues
            </DropdownMenuItem>
            {sheets.available && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs">Google Sheets</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => toSheets(visible, category === "all" ? "issues" : `${category} issues`)}>
                  <Sheet className="size-4" /> Sheet — current category
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => toSheets(actionable, "issues")}>
                  <Sheet className="size-4" /> Sheet — all issues
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem asChild>
              <a href={`${exportBase}?mode=${category === "all" ? "issues" : "category"}${category === "all" ? "" : `&category=${category}`}`}>
                <FileJson className="size-4" /> JSON — {category === "all" ? "all issues" : "current category"}
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={`${exportBase}?mode=full`}>
                <FileJson className="size-4" /> Saved Lighthouse payload
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {sheets.dialog}
      </div>

      {visible.length === 0 ? (
        <EmptyState compact title="Nothing to fix here" description="All audits in this category passed (score ≥ 90)." />
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card shadow-soft">
          <div className="hidden grid-cols-[28px_120px_minmax(0,1fr)_140px_60px] gap-3 border-b bg-muted/50 px-4 py-2 text-xs text-muted-foreground md:grid">
            <span />
            <span>Severity</span>
            <span>Audit</span>
            <span className="text-right">Impact</span>
            <span className="text-right">Score</span>
          </div>
          <ul className="divide-y">
            {visible.map((i) => {
              const key = `${i.category}:${i.auditKey}`;
              const isOpen = open.has(key);
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() =>
                      setOpen((p) => {
                        const n = new Set(p);
                        if (n.has(key)) n.delete(key);
                        else n.add(key);
                        return n;
                      })
                    }
                    className="grid w-full grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 md:grid-cols-[28px_120px_minmax(0,1fr)_140px_60px]"
                  >
                    <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
                    <span className={cn("hidden items-center gap-1.5 text-xs md:flex", SEVERITY_META[i.severity].text)}>
                      <SeverityIcon severity={i.severity} className="size-3.5" />
                      {SEVERITY_META[i.severity].label}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-sm font-medium">
                        <SeverityIcon severity={i.severity} className="size-3.5 md:hidden" />
                        <span className="truncate">{i.title}</span>
                      </span>
                      {i.displayValue && <span className="block truncate text-xs text-muted-foreground">{i.displayValue}</span>}
                    </span>
                    <span className="hidden text-right text-xs tabular md:block">{impact(i)}</span>
                    <span className="text-right text-xs font-semibold tabular">{i.score ?? "—"}</span>
                  </button>
                  {isOpen && (
                    <div className="space-y-2 border-t bg-muted/20 px-4 py-3 pl-11 text-sm">
                      <p className="text-muted-foreground">
                        <InlineMarkdown text={i.description} />
                      </p>
                      <p className="text-xs text-muted-foreground md:hidden">Impact: {impact(i)}</p>
                      {i.items.length > 0 && (
                        <details className="rounded-lg border bg-card">
                          <summary className="cursor-pointer px-3 py-2 text-xs font-medium">Affected items ({i.items.length})</summary>
                          <div className="space-y-1.5 px-3 pb-3">
                            {i.items.map((item, idx) => (
                              <pre key={idx} className="overflow-x-auto rounded bg-muted p-2 text-[11px] whitespace-pre-wrap break-all">
                                {item}
                              </pre>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
