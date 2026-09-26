"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, Wrench } from "lucide-react";
import { CopyButton } from "@/components/app/misc";
import { cn } from "@/lib/utils";
import { SeverityIcon } from "@/features/audit/components/bits";
import type { Finding } from "@/server/crawlability/types";

const CATEGORY_LABELS: Record<string, string> = {
  robots: "robots.txt",
  bots: "Bot access",
  llms: "llms.txt",
  meta: "Meta robots",
  rendering: "Rendering",
  sitemap: "Sitemap",
  "structured-data": "Structured data",
  canonical: "Canonical",
  performance: "Performance",
};

export function CodeBlock({ code, filename, language }: { code: string; filename?: string; language?: string }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-muted/40">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/60 px-3 py-1.5">
        <span className="font-mono text-[11px] text-muted-foreground">{filename ?? language ?? "snippet"}</span>
        <CopyButton value={code} size="icon" />
      </div>
      <pre className="max-h-80 overflow-auto p-3 font-mono text-xs leading-relaxed whitespace-pre">{code}</pre>
    </div>
  );
}

export function FindingsList({ findings, showPasses = true }: { findings: Finding[]; showPasses?: boolean }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(findings.filter((f) => f.severity === "critical").slice(0, 1).map((f) => f.id)));
  const [passes, setPasses] = useState(false);
  const issues = findings.filter((f) => f.severity !== "pass");
  const passed = findings.filter((f) => f.severity === "pass");
  const list = passes ? [...issues, ...passed] : issues;

  return (
    <div className="space-y-2">
      {issues.length === 0 && <p className="rounded-xl border bg-success/8 px-4 py-3 text-sm text-success">No problems found — AI crawlers can access and read your site.</p>}
      <ul className="divide-y overflow-hidden rounded-2xl border bg-card shadow-soft">
        {list.map((f) => {
          const isOpen = open.has(f.id);
          const expandable = Boolean(f.fix || f.snippet || f.affected?.length || f.description);
          return (
            <li key={f.id}>
              <button
                type="button"
                disabled={!expandable}
                onClick={() =>
                  setOpen((p) => {
                    const n = new Set(p);
                    if (n.has(f.id)) n.delete(f.id);
                    else n.add(f.id);
                    return n;
                  })
                }
                className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors enabled:hover:bg-muted/40 sm:px-5"
              >
                <SeverityIcon severity={f.severity} className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{f.title}</span>
                  <span className="text-xs text-muted-foreground">{CATEGORY_LABELS[f.category] ?? f.category}</span>
                </span>
                {expandable && <ChevronRight className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} />}
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="space-y-3 border-t bg-muted/20 px-4 py-3 sm:px-5 sm:pl-12">
                      <p className="text-sm text-muted-foreground">{f.description}</p>
                      {f.fix && (
                        <div className="flex gap-2 rounded-xl bg-brand-soft/50 px-3 py-2.5 text-sm">
                          <Wrench className="mt-0.5 size-4 shrink-0 text-brand" />
                          <p>{f.fix}</p>
                        </div>
                      )}
                      {f.snippet && <CodeBlock code={f.snippet.code} filename={f.snippet.filename} language={f.snippet.language} />}
                      {f.affected && f.affected.length > 0 && (
                        <ul className="max-h-56 space-y-1 overflow-y-auto rounded-xl border bg-card p-2">
                          {f.affected.map((a, i) => (
                            <li key={i} className="truncate px-1 font-mono text-[11px] text-muted-foreground" title={a}>
                              {a}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          );
        })}
      </ul>
      {showPasses && passed.length > 0 && (
        <button type="button" onClick={() => setPasses((v) => !v)} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
          {passes ? "Hide passed checks" : `Show ${passed.length} passed check${passed.length === 1 ? "" : "s"}`}
        </button>
      )}
    </div>
  );
}
