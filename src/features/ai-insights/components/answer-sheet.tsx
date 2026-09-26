"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Quote, Sparkles, Star } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { EngineIcon } from "@/components/app/engine-icon";
import { Favicon } from "@/components/app/favicon";
import { CountryFlag } from "@/components/app/misc";
import { getEngine } from "@/lib/engines";
import { cn } from "@/lib/utils";
import { getAnswerAction } from "../actions";
import { setClientParams, useClientParam } from "../lib/client-url";
import type { AnswerDetail } from "../types";
import { SafeMarkdown } from "./safe-markdown";
import { SentimentPill, YouBadge } from "./brand";

/** Opens the answer drawer (URL-synced via `?answer=`). */
export function openAnswer(answerId: string) {
  setClientParams({ answer: answerId });
}

/**
 * Drawer that shows one AI answer (prompt, engine, brands named, citations, statements).
 * Mount once per page; open with `openAnswer(id)` or a link containing `?answer=<id>`.
 */
export function AnswerSheet({ projectId }: { projectId: string }) {
  const [answerId, setAnswerId] = useClientParam("answer", "");
  const [result, setResult] = useState<{ id: string; data: AnswerDetail | null; error: string | null } | null>(null);

  useEffect(() => {
    if (!answerId || result?.id === answerId) return;
    let cancelled = false;
    getAnswerAction(projectId, answerId).then((res) => {
      if (cancelled) return;
      setResult({ id: answerId, data: res.ok ? res.data : null, error: res.ok ? null : res.error });
    });
    return () => {
      cancelled = true;
    };
  }, [answerId, result?.id, projectId]);

  const current = result?.id === answerId ? result : null;
  const data = current?.data ?? null;
  const error = current?.error ?? null;
  const open = !!answerId;
  const highlights = data?.mentions.map((m) => ({ term: m.name, own: m.isOwn })) ?? [];

  return (
    <Sheet open={open} onOpenChange={(o) => !o && setAnswerId(null)}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        <SheetHeader className="border-b p-4 pr-12 sm:p-5">
          <SheetTitle className="flex items-center gap-2 text-base">
            {data ? <EngineIcon id={data.engine} size="sm" /> : <Sparkles className="size-4" />}
            {data ? (getEngine(data.engine)?.name ?? data.engine) : "AI answer"}
          </SheetTitle>
          <SheetDescription className="text-left">
            {data ? (
              <span className="flex flex-wrap items-center gap-2">
                <CountryFlag iso={data.country} />
                <span>{new Date(`${data.date}T00:00:00Z`).toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" })}</span>
                {data.model && <span className="text-xs">· {data.model}</span>}
              </span>
            ) : (
              "Loading answer…"
            )}
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-5 p-4 sm:p-5">
          {error && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
          {!data && !error && (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-32 w-full" />
            </div>
          )}
          {data && (
            <>
              <div className="rounded-xl bg-muted/60 p-3">
                <div className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Prompt</div>
                <p className="text-sm font-medium">{data.promptText}</p>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant={data.brandMentioned ? "default" : "outline"}>{data.brandMentioned ? "You are mentioned" : "Not mentioned"}</Badge>
                {data.brandCited && <Badge className="bg-brand text-brand-foreground">Your site is cited</Badge>}
                {data.brandPosition != null && <Badge variant="outline">Position #{data.brandPosition}</Badge>}
                {data.sentiment != null && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    Sentiment <SentimentPill score={data.sentiment} />
                  </span>
                )}
              </div>

              {data.mentions.length > 0 && (
                <div>
                  <div className="mb-2 text-xs font-medium text-muted-foreground">Brands in this answer</div>
                  <div className="flex flex-wrap gap-1.5">
                    {data.mentions.map((m) => (
                      <span
                        key={`${m.name}-${m.position}`}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs",
                          m.isOwn && "border-brand/40 bg-brand-soft",
                        )}
                      >
                        <span className="text-muted-foreground tabular">#{m.position}</span>
                        <span className="font-medium">{m.name}</span>
                        {m.isOwn && <YouBadge />}
                        {m.recommended && <Star className="size-3 fill-warning text-warning" aria-label="Recommended" />}
                        {!m.isOwn && !m.competitorId && <span className="text-[10px] text-muted-foreground">untracked</span>}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-xl border p-4">
                <SafeMarkdown text={data.text || "(empty answer)"} highlights={highlights} />
              </div>

              {data.statements.length > 0 && (
                <div>
                  <div className="mb-2 text-xs font-medium text-muted-foreground">Extracted statements</div>
                  <ul className="space-y-2">
                    {data.statements.map((s, i) => (
                      <li key={i} className="flex gap-2 text-sm">
                        <Quote
                          className={cn(
                            "mt-0.5 size-3.5 shrink-0",
                            s.polarity === "praise" ? "text-success" : s.polarity === "criticism" ? "text-destructive" : "text-muted-foreground",
                          )}
                        />
                        <span>
                          <span className="font-medium">{s.brandName}</span>
                          {s.attribute && <span className="text-muted-foreground"> · {s.attribute}</span>}
                          <span className="block text-muted-foreground">“{s.quote}”</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {data.citations.length > 0 && (
                <div>
                  <div className="mb-2 text-xs font-medium text-muted-foreground">Sources cited ({data.citations.length})</div>
                  <ol className="space-y-1.5">
                    {data.citations.map((c) => (
                      <li key={`${c.sourceId}-${c.position}`} className="flex items-center gap-2 rounded-lg border px-2.5 py-2 text-sm">
                        <span className="w-4 shrink-0 text-xs text-muted-foreground tabular">{c.position}</span>
                        <Favicon domain={c.domain} />
                        <Link
                          href={`/p/${projectId}/ai/sources/${c.sourceId}`}
                          className="min-w-0 flex-1 truncate hover:underline"
                          title={c.url}
                        >
                          {c.title || c.url.replace(/^https?:\/\//, "")}
                        </Link>
                        {c.ownership === "own" && <YouBadge />}
                        {c.ownership === "competitor" && (
                          <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                            Competitor
                          </Badge>
                        )}
                        {/^https?:\/\//i.test(c.url) && (
                          <a href={c.url} target="_blank" rel="noopener noreferrer nofollow" className="text-muted-foreground hover:text-foreground" aria-label="Open source">
                            <ExternalLink className="size-3.5" />
                          </a>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
