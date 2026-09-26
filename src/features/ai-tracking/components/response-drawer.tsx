"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { AlertTriangle, ExternalLink, Loader2, Megaphone, Quote, RefreshCw, Search, ShoppingBag, Sparkles, ThumbsDown, ThumbsUp, Trophy } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EngineIcon } from "@/components/app/engine-icon";
import { Favicon } from "@/components/app/favicon";
import { CountryFlag, StatusBadge } from "@/components/app/misc";
import { EmptyState } from "@/components/app/empty-state";
import { useCan } from "@/components/app/shell-context";
import { getEngine } from "@/lib/engines";
import { cn } from "@/lib/utils";
import { loadAnswerDetailAction, loadPromptAnswersAction, reanalyzePromptAction, runNowAction } from "../actions";
import type { AnswerDetail, AnswerListItem } from "../types";
import { MarkdownAnswer } from "./markdown-answer";

const CONTENT_TYPE_LABEL: Record<string, string> = {
  listicle: "Listicle",
  "buying-guide": "Buying guide",
  test: "Test / review",
  ugc: "UGC",
  article: "Article",
  reference: "Reference",
  video: "Video",
  retail: "Retail",
  news: "News",
  forum: "Forum",
  brand: "Brand site",
  docs: "Docs",
  other: "Other",
};

function formatDay(d: string) {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function Section({ title, icon, children, count }: { title: string; icon: React.ReactNode; children: React.ReactNode; count?: number }) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {icon}
        {title}
        {count != null && <span className="font-normal tabular">({count})</span>}
      </h3>
      {children}
    </section>
  );
}

export function ResponseDrawer({
  projectId,
  prompt,
  initialEngine,
  onClose,
}: {
  projectId: string;
  prompt: { id: string; text: string; country: string } | null;
  initialEngine?: string | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={!!prompt} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-3xl">
        {prompt ? (
          <DrawerInner key={`${prompt.id}:${initialEngine ?? ""}`} projectId={projectId} prompt={prompt} initialEngine={initialEngine ?? null} />
        ) : (
          <SheetTitle className="sr-only">AI responses</SheetTitle>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DrawerInner({
  projectId,
  prompt,
  initialEngine,
}: {
  projectId: string;
  prompt: { id: string; text: string; country: string };
  initialEngine: string | null;
}) {
  const can = useCan();
  const [answers, setAnswers] = useState<AnswerListItem[] | null>(null);
  const [engine, setEngine] = useState<string | null>(null);
  const [answerId, setAnswerId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, AnswerDetail>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let cancelled = false;
    loadPromptAnswersAction(projectId, prompt.id).then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        setError(res.error);
        setAnswers([]);
        return;
      }
      setAnswers(res.data);
      const engines = [...new Set(res.data.map((a) => a.engine))];
      const first = initialEngine && engines.includes(initialEngine) ? initialEngine : (engines[0] ?? null);
      setEngine(first);
      setAnswerId(res.data.find((a) => a.engine === first)?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, prompt.id, initialEngine]);

  useEffect(() => {
    if (!answerId || details[answerId]) return;
    let cancelled = false;
    loadAnswerDetailAction(projectId, answerId).then((res) => {
      if (cancelled) return;
      if (res.ok) setDetails((d) => ({ ...d, [answerId]: res.data }));
      else setError(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, answerId, details]);

  const engines = useMemo(() => [...new Set((answers ?? []).map((a) => a.engine))], [answers]);
  const history = useMemo(() => (answers ?? []).filter((a) => a.engine === engine), [answers, engine]);
  const detail = answerId ? details[answerId] : undefined;

  const reanalyze = () =>
    start(async () => {
      const res = await reanalyzePromptAction(projectId, prompt.id);
      if (res.ok) toast.success(`Re-analysis queued for ${res.data.queued} answers`);
      else toast.error(res.error);
    });
  const runNow = () =>
    start(async () => {
      const res = await runNowAction(projectId, [prompt.id]);
      if (res.ok) toast.success(res.data.tasks ? `${res.data.tasks} answers queued` : "Already running for today");
      else toast.error(res.error);
    });

  return (
    <>
      <SheetHeader className="border-b px-4 py-3 pr-12 sm:px-5">
        <SheetTitle className="flex items-start gap-2 text-left text-[15px] leading-snug">
          <CountryFlag iso={prompt.country} className="mt-0.5" />
          <span className="min-w-0">{prompt.text || detail?.promptText || "AI responses"}</span>
        </SheetTitle>
        <SheetDescription className="sr-only">AI responses for this prompt</SheetDescription>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {engines.length > 0 && (
            <div className="scrollbar-none -mx-1 flex max-w-full gap-1 overflow-x-auto px-1">
              {engines.map((e) => {
                const latest = answers?.find((a) => a.engine === e);
                const visible = latest?.status === "ok" && (latest.brandMentioned || latest.brandCited);
                return (
                  <button
                    key={e}
                    type="button"
                    onClick={() => {
                      setEngine(e);
                      setAnswerId(answers?.find((a) => a.engine === e)?.id ?? null);
                    }}
                    className={cn(
                      "flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition-colors",
                      e === engine ? "border-foreground bg-foreground text-background" : "bg-background hover:bg-muted",
                    )}
                  >
                    <EngineIcon id={e} size="xs" withTooltip={false} />
                    {getEngine(e)?.shortName ?? e}
                    <span className={cn("size-1.5 rounded-full", visible ? "bg-success" : "bg-muted-foreground/40")} />
                  </button>
                );
              })}
            </div>
          )}
          {history.length > 0 && (
            <Select value={answerId ?? undefined} onValueChange={setAnswerId}>
              <SelectTrigger size="sm" className="h-7 w-auto min-w-40 text-xs">
                <SelectValue placeholder="Date" />
              </SelectTrigger>
              <SelectContent>
                {history.map((a) => (
                  <SelectItem key={a.id} value={a.id} className="text-xs">
                    {formatDay(a.date)}
                    {a.status === "error" ? " · error" : a.brandMentioned || a.brandCited ? " · visible" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {can("prompts.manage") && (
            <div className="ml-auto flex gap-1.5">
              <Button size="sm" variant="outline" onClick={reanalyze} disabled={pending}>
                <Sparkles /> Re-analyze
              </Button>
              <Button size="sm" variant="outline" onClick={runNow} disabled={pending}>
                {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Run now
              </Button>
            </div>
          )}
        </div>
      </SheetHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
        {error && <p className="mb-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        {answers === null ? (
          <div className="space-y-3">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : answers.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No responses yet"
            description="This prompt has not been answered yet. Responses appear here after the next tracking run (or click “Run now”)."
          />
        ) : !detail ? (
          <div className="space-y-3">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <AnswerBody detail={detail} />
        )}
      </div>
    </>
  );
}

function AnswerBody({ detail }: { detail: AnswerDetail }) {
  const praise = detail.statements.filter((s) => s.polarity === "praise");
  const criticism = detail.statements.filter((s) => s.polarity === "criticism");
  if (detail.status === "error") {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
        <div className="mb-1 flex items-center gap-2 font-medium text-destructive">
          <AlertTriangle className="size-4" /> This engine could not answer on {formatDay(detail.date)}
        </div>
        <p className="text-muted-foreground">{detail.error}</p>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <StatusBadge status={detail.brandMentioned || detail.brandCited ? "success" : "offline"} label={detail.brandMentioned || detail.brandCited ? "Visible" : "Not visible"} />
        {detail.brandMentioned && <Badge variant="outline">Mentioned{detail.position ? ` · #${detail.position}` : ""}</Badge>}
        {detail.brandCited && <Badge variant="outline">Cited</Badge>}
        {detail.sentiment != null && <Badge variant="outline">Sentiment {Math.round(detail.sentiment)}</Badge>}
        <span className="ml-auto text-muted-foreground">
          {detail.model ?? detail.provider} · {detail.provider}
        </span>
      </div>
      {detail.analysisStatus !== "done" && detail.analysisError && (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          {detail.analysisStatus === "pending" ? "Analysis in progress…" : `Sentiment & statements: ${detail.analysisError}`}
        </p>
      )}

      {detail.text.trim() ? (
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-3 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="size-2.5 rounded-sm bg-brand/40" /> Your brand
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2.5 rounded-sm bg-amber-400/50" /> Competitors
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2.5 rounded-sm bg-muted ring-1 ring-border" /> Other brands
            </span>
          </div>
          <MarkdownAnswer text={detail.text} highlights={detail.highlights} />
        </div>
      ) : (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          The engine showed no AI answer for this query on {formatDay(detail.date)} — the brand is not visible.
        </p>
      )}

      {detail.mentions.length > 0 && (
        <Section title="Brands in this answer" icon={<Trophy className="size-3.5" />} count={detail.mentions.length}>
          <div className="flex flex-wrap gap-1.5">
            {detail.mentions.map((m) => (
              <span
                key={m.name}
                title={m.snippet ?? undefined}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs",
                  m.isOwn ? "border-brand/40 bg-brand/10 font-medium" : m.competitorId ? "bg-amber-400/10" : "bg-muted/50",
                )}
              >
                <span className="text-muted-foreground tabular">#{m.position}</span>
                {m.name}
                {m.occurrences > 1 && <span className="text-muted-foreground tabular">×{m.occurrences}</span>}
                {m.recommended && <Trophy className="size-3 text-amber-500" />}
                {m.sentiment != null && <span className="text-muted-foreground tabular">{Math.round(m.sentiment)}</span>}
              </span>
            ))}
          </div>
        </Section>
      )}

      <Section title="Citations" icon={<ExternalLink className="size-3.5" />} count={detail.citations.length}>
        {detail.citations.length ? (
          <ol className="divide-y rounded-xl border">
            {detail.citations.map((c) => (
              <li key={c.url} className="flex items-start gap-2.5 px-3 py-2">
                <span className="mt-0.5 w-4 shrink-0 text-xs text-muted-foreground tabular">{c.position}</span>
                <Favicon domain={c.domain} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <a href={c.url} target="_blank" rel="noopener noreferrer nofollow" className="line-clamp-1 text-sm font-medium hover:underline">
                    {c.title || c.url}
                  </a>
                  <div className="truncate text-xs text-muted-foreground">{c.domain}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center">
                  {c.ownership !== "third_party" && (
                    <Badge variant={c.ownership === "own" ? "default" : "outline"} className="h-5 text-[10px]">
                      {c.ownership === "own" ? "You" : "Competitor"}
                    </Badge>
                  )}
                  <Badge variant="secondary" className="h-5 text-[10px]">
                    {CONTENT_TYPE_LABEL[c.contentType] ?? c.contentType}
                  </Badge>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">No sources were cited in this answer.</p>
        )}
      </Section>

      {detail.fanouts.length > 0 && (
        <Section title="Fan-out queries" icon={<Search className="size-3.5" />} count={detail.fanouts.length}>
          <div className="flex flex-wrap gap-1.5">
            {detail.fanouts.map((q) => (
              <span key={q} className="rounded-full border bg-muted/40 px-2.5 py-1 text-xs">
                {q}
              </span>
            ))}
          </div>
        </Section>
      )}

      {detail.products.length > 0 && (
        <Section title="Products" icon={<ShoppingBag className="size-3.5" />} count={detail.products.length}>
          <div className="grid gap-2 sm:grid-cols-2">
            {detail.products.map((p) => (
              <div key={`${p.name}-${p.store ?? ""}`} className="flex min-w-0 gap-2.5 rounded-xl border p-2.5">
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-sm font-medium">{p.name}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    {p.brand && <span>{p.brand}</span>}
                    {p.price != null && (
                      <span className="font-medium text-foreground tabular">
                        {new Intl.NumberFormat("en-US", { style: "currency", currency: p.currency || "EUR" }).format(p.price)}
                        {p.oldPrice != null && <s className="ml-1 font-normal text-muted-foreground">{p.oldPrice}</s>}
                      </span>
                    )}
                    {p.rating != null && <span>★ {p.rating}</span>}
                    {p.store && <span>{p.store}</span>}
                  </div>
                </div>
                <Badge variant="secondary" className="h-5 shrink-0 text-[10px]">
                  {p.source === "shopping" ? "Shopping" : p.source === "both" ? "Shopping + text" : "Mentioned"}
                </Badge>
              </div>
            ))}
          </div>
        </Section>
      )}

      {detail.ads.length > 0 && (
        <Section title="Ads" icon={<Megaphone className="size-3.5" />} count={detail.ads.length}>
          <div className="space-y-2">
            {detail.ads.map((a) => (
              <div key={`${a.advertiser}-${a.headline}`} className="rounded-xl border p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="rounded bg-muted px-1 text-[10px] font-semibold tracking-wide uppercase">Sponsored</span>
                  <Favicon domain={a.advertiserDomain} />
                  {a.advertiser}
                </div>
                <div className="mt-1 text-sm font-medium">{a.headline}</div>
                {a.description && <p className="text-xs text-muted-foreground">{a.description}</p>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {(praise.length > 0 || criticism.length > 0) && (
        <Section title="Sentiment statements" icon={<Quote className="size-3.5" />} count={detail.statements.length}>
          <div className="grid gap-2 sm:grid-cols-2">
            {[...praise, ...criticism].map((s, i) => (
              <div key={i} className={cn("rounded-xl border p-3", s.polarity === "praise" ? "border-success/25 bg-success/5" : "border-destructive/20 bg-destructive/5")}>
                <div className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                  {s.polarity === "praise" ? <ThumbsUp className="size-3.5 text-success" /> : <ThumbsDown className="size-3.5 text-destructive" />}
                  <span className={cn(s.isOwn && "text-brand")}>{s.brandName}</span>
                  {s.attribute && <span className="font-normal text-muted-foreground">· {s.attribute}</span>}
                </div>
                <p className="text-xs text-muted-foreground italic">“{s.quote}”</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {detail.recommendations.length > 0 && (
        <Section title="Picks & comparisons" icon={<Trophy className="size-3.5" />} count={detail.recommendations.length}>
          <ul className="space-y-1.5 text-sm">
            {detail.recommendations.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="h-5 text-[10px]">
                  {r.kind === "best_for" ? "Best for" : "Head-to-head"}
                </Badge>
                {r.kind === "best_for" ? (
                  <span>
                    {r.label}: <strong>{r.brandName}</strong>
                  </span>
                ) : (
                  <span>
                    <strong>{r.brandName}</strong> vs {r.opponentName} — {r.winner === "brand" ? `${r.brandName} wins` : r.winner === "opponent" ? `${r.opponentName} wins` : "tie"}
                    <span className="text-muted-foreground"> · {r.label}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
